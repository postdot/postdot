import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ProviderAnalyticsAvailability,
    type ProviderAnalyticsObservationInput,
} from '@postdot/core'

import { BLUESKY_PROVIDER, type BlueskyFetcher } from './contract'

export const BLUESKY_PUBLIC_API_ORIGIN = 'https://public.api.bsky.app'
export const BLUESKY_ANALYTICS_PROVENANCE = 'bluesky.public-api.v1'
export const BLUESKY_ANALYTICS_MAX_CONTENTS = 25
export const BLUESKY_ANALYTICS_TIMEOUT_MS = 10_000
export const BLUESKY_ANALYTICS_MAX_TIMEOUT_MS = 60_000

export const blueskyAccountMetricNames = ['followersCount', 'followsCount', 'postsCount'] as const
export type BlueskyAccountMetricName = (typeof blueskyAccountMetricNames)[number]

export const blueskyContentMetricNames = [
    'likeCount',
    'replyCount',
    'repostCount',
    'quoteCount',
    'bookmarkCount',
] as const
export type BlueskyContentMetricName = (typeof blueskyContentMetricNames)[number]

type BlueskyUnavailableAvailability = Exclude<
    ProviderAnalyticsAvailability,
    'measured' | 'not_reported'
>

export type BlueskyAnalyticsCoverageState = 'complete' | 'partial' | 'unavailable'

export interface BlueskyAnalyticsCoverageGap {
    readonly subjectType: 'account' | 'content'
    readonly providerSubjectId: string
    readonly postbotEntityId: string
    readonly metricNames: readonly string[]
    readonly availability: Exclude<ProviderAnalyticsAvailability, 'measured'>
}

export interface BlueskyAnalyticsCoverage {
    readonly state: BlueskyAnalyticsCoverageState
    readonly complete: boolean
    readonly requestedAccountMetricCount: number
    readonly measuredAccountMetricCount: number
    readonly requestedContentCount: number
    readonly returnedContentCount: number
    readonly requestedContentMetricCount: number
    readonly measuredContentMetricCount: number
    readonly notReportedMetricCount: number
    readonly unavailableMetricCount: number
    readonly gaps: readonly BlueskyAnalyticsCoverageGap[]
}

interface BlueskyCounterSnapshot {
    readonly [metric: string]: number | undefined
}

export type BlueskyAnalyticsProfileRead =
    | {
          readonly kind: 'available'
          readonly did: string
          readonly handle: string
          readonly observedAt: number | null
          readonly counters: Readonly<BlueskyCounterSnapshot>
      }
    | {
          readonly kind: 'unavailable'
          readonly availability: BlueskyUnavailableAvailability
      }

export type BlueskyAnalyticsPostRead =
    | {
          readonly kind: 'available'
          readonly uri: string
          readonly cid: string
          readonly authorHandle: string
          readonly observedAt: number | null
          readonly counters: Readonly<BlueskyCounterSnapshot>
      }
    | {
          readonly kind: 'unavailable'
          readonly uri: string
          readonly availability: BlueskyUnavailableAvailability
      }

export interface BlueskyAnalyticsReader {
    getProfile(actor: string): Promise<BlueskyAnalyticsProfileRead>
    getPosts(uris: readonly string[]): Promise<readonly BlueskyAnalyticsPostRead[]>
}

export interface BlueskyAnalyticsAccountTarget {
    readonly providerSubjectId: string
    readonly providerSubjectLabel?: string | null
    readonly postbotEntityId: string
}

export interface BlueskyAnalyticsContentTarget {
    readonly providerSubjectId: string
    readonly postbotEntityId: string
}

export interface CollectBlueskyAnalyticsInput {
    readonly reader: BlueskyAnalyticsReader
    readonly projectId: string
    readonly account: BlueskyAnalyticsAccountTarget
    readonly contents?: readonly BlueskyAnalyticsContentTarget[]
    readonly fetchedAt: number
}

export interface CollectBlueskyAnalyticsResult {
    readonly projectId: string
    readonly provider: typeof BLUESKY_PROVIDER
    readonly fetchedAt: number
    readonly coverage: BlueskyAnalyticsCoverage
    readonly observations: readonly ProviderAnalyticsObservationInput[]
}

interface ProviderResponseFailure {
    readonly availability: BlueskyUnavailableAvailability
}

export function createBlueskyAnalyticsReader(
    options: {
        readonly fetcher?: BlueskyFetcher
        readonly baseUrl?: string | URL
        readonly timeoutMs?: number
    } = {}
): BlueskyAnalyticsReader {
    const fetcher = options.fetcher ?? globalThis.fetch
    const baseUrl = new URL(options.baseUrl ?? BLUESKY_PUBLIC_API_ORIGIN)
    const timeoutMs = normalizeTimeout(options.timeoutMs)

    return {
        async getProfile(actor) {
            const normalizedActor = actor.trim()
            if (!isBlueskyActor(normalizedActor)) {
                return { kind: 'unavailable', availability: 'invalid_response' }
            }

            const url = new URL('/xrpc/app.bsky.actor.getProfile', baseUrl)
            url.searchParams.set('actor', normalizedActor)
            const response = await fetchJson(fetcher, url, timeoutMs)
            if ('availability' in response) {
                return {
                    kind: 'unavailable',
                    availability: response.availability,
                }
            }

            if (!isRecord(response.payload)) {
                return { kind: 'unavailable', availability: 'invalid_response' }
            }
            const providerError = providerErrorCode(response.payload)
            if (providerError !== null) {
                return {
                    kind: 'unavailable',
                    availability: classifyProviderError(response.status, providerError),
                }
            }

            const did = readNonBlankString(response.payload.did)
            const handle = readRequiredString(response.payload.handle)
            const observedAt = readOptionalProviderTimestamp(response.payload.indexedAt)
            const counters = readCounters(response.payload, blueskyAccountMetricNames)
            if (
                did === null ||
                !isBlueskyDid(did) ||
                handle === null ||
                observedAt === invalidTimestamp ||
                counters === null
            ) {
                return { kind: 'unavailable', availability: 'invalid_response' }
            }

            return {
                kind: 'available',
                did,
                handle,
                observedAt,
                counters,
            }
        },

        async getPosts(uris) {
            const normalizedUris = normalizePostUris(uris)
            if (normalizedUris.length > BLUESKY_ANALYTICS_MAX_CONTENTS) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'at most ' +
                        BLUESKY_ANALYTICS_MAX_CONTENTS +
                        ' Bluesky posts may be read at once'
                )
            }
            const results: BlueskyAnalyticsPostRead[] = []
            const validUris: string[] = []
            for (const uri of normalizedUris) {
                if (!isBlueskyPostUri(uri)) {
                    results.push({
                        kind: 'unavailable',
                        uri,
                        availability: 'invalid_response',
                    })
                } else {
                    validUris.push(uri)
                }
            }
            if (validUris.length === 0) return results

            const url = new URL('/xrpc/app.bsky.feed.getPosts', baseUrl)
            for (const uri of validUris) url.searchParams.append('uris', uri)
            const response = await fetchJson(fetcher, url, timeoutMs)
            if ('availability' in response) {
                return [
                    ...results,
                    ...validUris.map(uri => ({
                        kind: 'unavailable' as const,
                        uri,
                        availability: response.availability,
                    })),
                ]
            }

            if (!isRecord(response.payload) || !Array.isArray(response.payload.posts)) {
                return [
                    ...results,
                    ...validUris.map(uri => ({
                        kind: 'unavailable' as const,
                        uri,
                        availability: 'invalid_response' as const,
                    })),
                ]
            }

            const requested = new Set(validUris)
            const byUri = new Map<string, BlueskyAnalyticsPostRead>()
            let malformedItem = false
            for (const item of response.payload.posts) {
                if (!isRecord(item)) {
                    malformedItem = true
                    continue
                }
                const uri = readNonBlankString(item.uri)
                if (uri === null) {
                    malformedItem = true
                    continue
                }
                if (!requested.has(uri) || byUri.has(uri)) continue

                if (isBlockedPost(item)) {
                    byUri.set(uri, {
                        kind: 'unavailable',
                        uri,
                        availability: 'blocked',
                    })
                    continue
                }
                if (isNotFoundPost(item)) {
                    byUri.set(uri, {
                        kind: 'unavailable',
                        uri,
                        availability: 'not_found',
                    })
                    continue
                }

                const cid = readRequiredString(item.cid)
                const authorHandle = readAuthorHandle(item.author)
                const observedAt = readRequiredProviderTimestamp(item.indexedAt)
                const counters = readCounters(item, blueskyContentMetricNames)
                const hasRecord = Object.prototype.hasOwnProperty.call(item, 'record')
                if (
                    cid === null ||
                    authorHandle === null ||
                    observedAt === invalidTimestamp ||
                    !hasRecord ||
                    counters === null
                ) {
                    byUri.set(uri, {
                        kind: 'unavailable',
                        uri,
                        availability: 'invalid_response',
                    })
                    continue
                }

                byUri.set(uri, {
                    kind: 'available',
                    uri,
                    cid,
                    authorHandle,
                    observedAt,
                    counters,
                })
            }

            return [
                ...results,
                ...validUris.map(
                    uri =>
                        byUri.get(uri) ?? {
                            kind: 'unavailable' as const,
                            uri,
                            availability: malformedItem
                                ? ('invalid_response' as const)
                                : ('partial_response' as const),
                        }
                ),
            ]
        },
    }
}

export async function collectBlueskyAnalytics(
    input: CollectBlueskyAnalyticsInput
): Promise<CollectBlueskyAnalyticsResult> {
    const projectId = requireNonBlank(input.projectId, 'projectId')
    const fetchedAt = requireTimestamp(input.fetchedAt, 'fetchedAt')
    const accountId = requireNonBlank(input.account.providerSubjectId, 'account providerSubjectId')
    const accountEntityId = requireNonBlank(
        input.account.postbotEntityId,
        'account postbotEntityId'
    )
    const contents = normalizeContentTargets(input.contents)
    if (contents.length > BLUESKY_ANALYTICS_MAX_CONTENTS) {
        throw new DomainInvariantError(
            'invalid_input',
            'at most ' + BLUESKY_ANALYTICS_MAX_CONTENTS + ' Bluesky posts may be collected at once'
        )
    }

    const profile = await input.reader.getProfile(accountId)
    const observations: ProviderAnalyticsObservationInput[] = []
    if (profile.kind === 'available') {
        observations.push(
            ...mapAvailableCounters({
                projectId,
                subjectType: 'account',
                providerSubjectId: profile.did,
                providerSubjectLabel: profile.handle,
                providerContentRevisionId: null,
                postbotEntityType: 'channel',
                postbotEntityId: accountEntityId,
                counters: profile.counters,
                metricNames: blueskyAccountMetricNames,
                observedAt: profile.observedAt,
                fetchedAt,
            })
        )
    } else {
        observations.push(
            ...mapUnavailableCounters({
                projectId,
                subjectType: 'account',
                providerSubjectId: accountId,
                providerSubjectLabel: input.account.providerSubjectLabel ?? null,
                providerContentRevisionId: null,
                postbotEntityType: 'channel',
                postbotEntityId: accountEntityId,
                metricNames: blueskyAccountMetricNames,
                availability: profile.availability,
                observedAt: null,
                fetchedAt,
            })
        )
    }

    let returnedContentCount = 0
    if (contents.length > 0) {
        const posts = await input.reader.getPosts(
            contents.map(content => content.providerSubjectId)
        )
        const postsByUri = new Map(posts.map(post => [post.uri, post]))
        for (const content of contents) {
            const providerSubjectId = requireNonBlank(
                content.providerSubjectId,
                'content providerSubjectId'
            )
            const postbotEntityId = requireNonBlank(
                content.postbotEntityId,
                'content postbotEntityId'
            )
            const post = postsByUri.get(providerSubjectId)
            if (post?.kind === 'available') {
                returnedContentCount += 1
                observations.push(
                    ...mapAvailableCounters({
                        projectId,
                        subjectType: 'content',
                        providerSubjectId: post.uri,
                        providerSubjectLabel: post.authorHandle,
                        providerContentRevisionId: post.cid,
                        postbotEntityType: 'publication',
                        postbotEntityId,
                        counters: post.counters,
                        metricNames: blueskyContentMetricNames,
                        observedAt: post.observedAt,
                        fetchedAt,
                    })
                )
            } else {
                observations.push(
                    ...mapUnavailableCounters({
                        projectId,
                        subjectType: 'content',
                        providerSubjectId,
                        providerSubjectLabel: null,
                        providerContentRevisionId: null,
                        postbotEntityType: 'publication',
                        postbotEntityId,
                        metricNames: blueskyContentMetricNames,
                        availability:
                            post?.kind === 'unavailable' ? post.availability : 'invalid_response',
                        observedAt: null,
                        fetchedAt,
                    })
                )
            }
        }
    }

    return {
        projectId,
        provider: BLUESKY_PROVIDER,
        fetchedAt,
        coverage: summarizeCoverage({
            observations,
            requestedContentCount: contents.length,
            returnedContentCount,
            profileAvailable: profile.kind === 'available',
        }),
        observations,
    }
}

function mapAvailableCounters(input: {
    readonly projectId: string
    readonly subjectType: 'account' | 'content'
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
    readonly providerContentRevisionId: string | null
    readonly postbotEntityType: 'channel' | 'publication'
    readonly postbotEntityId: string
    readonly counters: Readonly<BlueskyCounterSnapshot>
    readonly metricNames: readonly string[]
    readonly observedAt: number | null
    readonly fetchedAt: number
}): ProviderAnalyticsObservationInput[] {
    return input.metricNames.map(metricName => {
        const value = input.counters[metricName]
        return createObservation({
            projectId: input.projectId,
            subjectType: input.subjectType,
            providerSubjectId: input.providerSubjectId,
            providerSubjectLabel: input.providerSubjectLabel,
            providerContentRevisionId: input.providerContentRevisionId,
            postbotEntityType: input.postbotEntityType,
            postbotEntityId: input.postbotEntityId,
            metricName,
            value: value === undefined ? null : value,
            availability: value === undefined ? 'not_reported' : 'measured',
            observedAt: input.observedAt,
            fetchedAt: input.fetchedAt,
        })
    })
}

function mapUnavailableCounters(input: {
    readonly projectId: string
    readonly subjectType: 'account' | 'content'
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
    readonly providerContentRevisionId: string | null
    readonly postbotEntityType: 'channel' | 'publication'
    readonly postbotEntityId: string
    readonly metricNames: readonly string[]
    readonly availability: BlueskyUnavailableAvailability
    readonly observedAt: number | null
    readonly fetchedAt: number
}): ProviderAnalyticsObservationInput[] {
    return input.metricNames.map(metricName =>
        createObservation({
            projectId: input.projectId,
            subjectType: input.subjectType,
            providerSubjectId: input.providerSubjectId,
            providerSubjectLabel: input.providerSubjectLabel,
            providerContentRevisionId: input.providerContentRevisionId,
            postbotEntityType: input.postbotEntityType,
            postbotEntityId: input.postbotEntityId,
            metricName,
            value: null,
            availability: input.availability,
            observedAt: input.observedAt,
            fetchedAt: input.fetchedAt,
        })
    )
}

function createObservation(input: {
    readonly projectId: string
    readonly subjectType: 'account' | 'content'
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
    readonly providerContentRevisionId: string | null
    readonly postbotEntityType: 'channel' | 'publication'
    readonly postbotEntityId: string
    readonly metricName: string
    readonly value: number | null
    readonly availability: ProviderAnalyticsAvailability
    readonly observedAt: number | null
    readonly fetchedAt: number
}): ProviderAnalyticsObservationInput {
    return {
        projectId: input.projectId,
        provider: BLUESKY_PROVIDER,
        subjectType: input.subjectType,
        providerSubjectId: input.providerSubjectId,
        providerSubjectLabel: input.providerSubjectLabel,
        providerContentRevisionId: input.providerContentRevisionId,
        postbotEntityType: input.postbotEntityType,
        postbotEntityId: input.postbotEntityId,
        metricName: input.metricName,
        value: input.value,
        unit: 'count',
        aggregation: 'cumulative_snapshot',
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
        observedAt: input.observedAt,
        fetchedAt: input.fetchedAt,
        availability: input.availability,
        freshness: 'unknown',
        provenance: BLUESKY_ANALYTICS_PROVENANCE,
    }
}

function summarizeCoverage(input: {
    readonly observations: readonly ProviderAnalyticsObservationInput[]
    readonly requestedContentCount: number
    readonly returnedContentCount: number
    readonly profileAvailable: boolean
}): BlueskyAnalyticsCoverage {
    const accountObservations = input.observations.filter(
        observation => observation.subjectType === 'account'
    )
    const contentObservations = input.observations.filter(
        observation => observation.subjectType === 'content'
    )
    const gaps = new Map<string, BlueskyAnalyticsCoverageGap>()
    for (const observation of input.observations) {
        if (observation.availability === 'measured') continue
        const postbotEntityId = observation.postbotEntityId ?? ''
        const key = [
            observation.subjectType,
            observation.providerSubjectId,
            postbotEntityId,
            observation.availability,
        ].join('\u0000')
        const existing = gaps.get(key)
        if (existing === undefined) {
            gaps.set(key, {
                subjectType: observation.subjectType,
                providerSubjectId: observation.providerSubjectId,
                postbotEntityId,
                metricNames: [observation.metricName],
                availability: observation.availability,
            })
        } else if (!existing.metricNames.includes(observation.metricName)) {
            gaps.set(key, {
                ...existing,
                metricNames: [...existing.metricNames, observation.metricName],
            })
        }
    }

    const gapList = [...gaps.values()]
    const notReportedMetricCount = input.observations.filter(
        observation => observation.availability === 'not_reported'
    ).length
    const unavailableMetricCount = input.observations.filter(
        observation =>
            observation.availability !== 'measured' && observation.availability !== 'not_reported'
    ).length
    const hasProviderSuccess = input.profileAvailable || input.returnedContentCount > 0
    const state: BlueskyAnalyticsCoverageState =
        gapList.length === 0 ? 'complete' : hasProviderSuccess ? 'partial' : 'unavailable'

    return {
        state,
        complete: state === 'complete',
        requestedAccountMetricCount: blueskyAccountMetricNames.length,
        measuredAccountMetricCount: accountObservations.filter(
            observation => observation.availability === 'measured'
        ).length,
        requestedContentCount: input.requestedContentCount,
        returnedContentCount: input.returnedContentCount,
        requestedContentMetricCount: input.requestedContentCount * blueskyContentMetricNames.length,
        measuredContentMetricCount: contentObservations.filter(
            observation => observation.availability === 'measured'
        ).length,
        notReportedMetricCount,
        unavailableMetricCount,
        gaps: gapList,
    }
}

async function fetchJson(
    fetcher: BlueskyFetcher,
    url: URL,
    timeoutMs: number
): Promise<{ readonly payload: unknown; readonly status: number } | ProviderResponseFailure> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
        const result = await Promise.race([
            (async () => {
                const response = await fetcher(url, {
                    headers: { accept: 'application/json' },
                    signal: controller.signal,
                })
                if (response.status === 206) {
                    return {
                        kind: 'result' as const,
                        result: { availability: 'partial_response' as const },
                    }
                }
                if (!response.ok) {
                    let payload: unknown = null
                    try {
                        payload = await response.json()
                    } catch {
                        // The status itself is enough to classify the failure.
                    }
                    const providerError = isRecord(payload) ? providerErrorCode(payload) : null
                    return {
                        kind: 'result' as const,
                        result: {
                            availability: classifyProviderError(response.status, providerError),
                        },
                    }
                }

                try {
                    return {
                        kind: 'result' as const,
                        result: { payload: await response.json(), status: response.status },
                    }
                } catch {
                    return {
                        kind: 'result' as const,
                        result: { availability: 'invalid_response' as const },
                    }
                }
            })(),
            new Promise<{ readonly kind: 'timeout' }>(resolve => {
                timeout = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
            }),
        ])
        if (result.kind === 'timeout') {
            controller.abort()
            return { availability: 'temporarily_unavailable' }
        }
        return result.result
    } catch {
        return { availability: 'temporarily_unavailable' }
    } finally {
        if (timeout !== undefined) clearTimeout(timeout)
    }
}

function classifyProviderError(
    status: number,
    providerError: string | null
): BlueskyUnavailableAvailability {
    if (status === 401 || status === 403) return 'not_authorized'
    if (status === 429) return 'rate_limited'
    if (status === 404) return 'not_found'
    if (status === 410) return 'disabled'
    if (status >= 500) return 'temporarily_unavailable'
    if (/blocked/i.test(providerError ?? '')) return 'blocked'
    if (/unsupported|not.?supported/i.test(providerError ?? '')) return 'not_supported'
    if (/partial|incomplete|truncated/i.test(providerError ?? '')) return 'partial_response'
    if (/not.?found|actor.?not.?found|profile.?not.?found/i.test(providerError ?? '')) {
        return 'not_found'
    }
    if (/(?:deactivate|deactivated|deactivation|takedown|suspend)/i.test(providerError ?? '')) {
        return 'disabled'
    }
    return 'invalid_response'
}

function providerErrorCode(payload: Record<string, unknown>): string | null {
    if (typeof payload.error === 'string') return payload.error
    return typeof payload.message === 'string' ? payload.message : null
}

function readCounters(
    payload: Record<string, unknown>,
    metricNames: readonly string[]
): BlueskyCounterSnapshot | null {
    const counters: Record<string, number | undefined> = {}
    for (const metricName of metricNames) {
        const value = payload[metricName]
        if (value === undefined) {
            counters[metricName] = undefined
            continue
        }
        if (!Number.isSafeInteger(value) || (value as number) < 0) return null
        counters[metricName] = value as number
    }
    return counters
}

const invalidString = Symbol('invalid-string')

function readOptionalString(value: unknown): string | null | typeof invalidString {
    if (value === undefined) return null
    if (typeof value !== 'string') return invalidString
    const normalized = value.trim()
    return normalized.length === 0 ? invalidString : normalized
}

function readRequiredString(value: unknown): string | null {
    const result = readOptionalString(value)
    return result === null || result === invalidString ? null : result
}

function readNonBlankString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized.length === 0 ? null : normalized
}

function readAuthorHandle(value: unknown): string | null {
    if (!isRecord(value)) return null
    const did = readNonBlankString(value.did)
    const handle = readRequiredString(value.handle)
    return did === null || !isBlueskyDid(did) ? null : handle
}

const invalidTimestamp = Symbol('invalid-timestamp')

function readOptionalProviderTimestamp(value: unknown): number | null | typeof invalidTimestamp {
    if (value === undefined) return null
    if (typeof value !== 'string') return invalidTimestamp
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : invalidTimestamp
}

function readRequiredProviderTimestamp(value: unknown): number | typeof invalidTimestamp {
    const timestamp = readOptionalProviderTimestamp(value)
    return timestamp === null ? invalidTimestamp : timestamp
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBlueskyActor(value: string): boolean {
    return (
        value.length > 0 &&
        value.length <= 300 &&
        !/\s/.test(value) &&
        (isBlueskyDid(value) || /^[a-z0-9][a-z0-9.-]*$/i.test(value.replace(/^@/, '')))
    )
}

function isBlueskyDid(value: string): boolean {
    return /^did:[^\s:]+:[^\s]+$/.test(value)
}

function isBlueskyPostUri(value: string): boolean {
    return /^at:\/\/did:[^/\s]+\/app\.bsky\.feed\.post\/[^/\s]+$/.test(value)
}

function isBlockedPost(value: Record<string, unknown>): boolean {
    return (
        value.blocked === true || (typeof value.$type === 'string' && /blocked/i.test(value.$type))
    )
}

function isNotFoundPost(value: Record<string, unknown>): boolean {
    return (
        value.notFound === true ||
        (typeof value.$type === 'string' && /not.?found/i.test(value.$type))
    )
}

function normalizePostUris(uris: readonly string[]): string[] {
    return [...new Set(uris.map(uri => requireNonBlank(uri, 'post URI')))]
}

function normalizeTimeout(value: number | undefined): number {
    if (value === undefined) return BLUESKY_ANALYTICS_TIMEOUT_MS
    if (!Number.isSafeInteger(value) || value < 1 || value > BLUESKY_ANALYTICS_MAX_TIMEOUT_MS) {
        throw new DomainInvariantError(
            'invalid_input',
            `timeoutMs must be between 1 and ${BLUESKY_ANALYTICS_MAX_TIMEOUT_MS}`
        )
    }
    return value
}

function normalizeContentTargets(
    targets: readonly BlueskyAnalyticsContentTarget[] | undefined
): BlueskyAnalyticsContentTarget[] {
    if (targets === undefined) return []
    const seen = new Set<string>()
    const normalized: BlueskyAnalyticsContentTarget[] = []
    for (const target of targets) {
        const providerSubjectId = requireNonBlank(
            target.providerSubjectId,
            'content providerSubjectId'
        )
        const postbotEntityId = requireNonBlank(target.postbotEntityId, 'content postbotEntityId')
        if (seen.has(providerSubjectId)) continue
        seen.add(providerSubjectId)
        normalized.push({ providerSubjectId, postbotEntityId })
    }
    return normalized
}
