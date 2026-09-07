import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ProviderAnalyticsAvailability,
    type ProviderAnalyticsObservationInput,
} from '@herald/core'

import { BLUESKY_PROVIDER, type BlueskyFetcher } from './contract'

export const BLUESKY_PUBLIC_API_ORIGIN = 'https://public.api.bsky.app'
export const BLUESKY_ANALYTICS_PROVENANCE = 'bluesky.public-api.v1'
export const BLUESKY_ANALYTICS_MAX_CONTENTS = 25

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

interface BlueskyCounterSnapshot {
    readonly [metric: string]: number | undefined
}

export type BlueskyAnalyticsProfileRead =
    | {
          readonly kind: 'available'
          readonly did: string
          readonly handle: string | null
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
          readonly cid: string | null
          readonly authorHandle: string | null
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
    readonly heraldEntityId: string
}

export interface BlueskyAnalyticsContentTarget {
    readonly providerSubjectId: string
    readonly heraldEntityId: string
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
    readonly observations: readonly ProviderAnalyticsObservationInput[]
}

interface ProviderResponseFailure {
    readonly availability: BlueskyUnavailableAvailability
}

export function createBlueskyAnalyticsReader(
    options: {
        readonly fetcher?: BlueskyFetcher
        readonly baseUrl?: string | URL
    } = {}
): BlueskyAnalyticsReader {
    const fetcher = options.fetcher ?? globalThis.fetch
    const baseUrl = new URL(options.baseUrl ?? BLUESKY_PUBLIC_API_ORIGIN)

    return {
        async getProfile(actor) {
            const normalizedActor = actor.trim()
            if (!isBlueskyActor(normalizedActor)) {
                return { kind: 'unavailable', availability: 'invalid_response' }
            }

            const url = new URL('/xrpc/app.bsky.actor.getProfile', baseUrl)
            url.searchParams.set('actor', normalizedActor)
            const response = await fetchJson(fetcher, url)
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
            const handle = readOptionalString(response.payload.handle)
            const counters = readCounters(response.payload, blueskyAccountMetricNames)
            if (
                did === null ||
                !isBlueskyDid(did) ||
                handle === invalidString ||
                counters === null
            ) {
                return { kind: 'unavailable', availability: 'invalid_response' }
            }

            return {
                kind: 'available',
                did,
                handle: handle ?? null,
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
            const response = await fetchJson(fetcher, url)
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

                const cid = readOptionalString(item.cid)
                const authorHandle = readAuthorHandle(item.author)
                const counters = readCounters(item, blueskyContentMetricNames)
                if (cid === invalidString || authorHandle === invalidString || counters === null) {
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
                    cid: cid ?? null,
                    authorHandle: authorHandle ?? null,
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
                                : ('not_found' as const),
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
    const accountEntityId = requireNonBlank(input.account.heraldEntityId, 'account heraldEntityId')
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
                heraldEntityType: 'channel',
                heraldEntityId: accountEntityId,
                counters: profile.counters,
                metricNames: blueskyAccountMetricNames,
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
                heraldEntityType: 'channel',
                heraldEntityId: accountEntityId,
                metricNames: blueskyAccountMetricNames,
                availability: profile.availability,
                fetchedAt,
            })
        )
    }

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
            const heraldEntityId = requireNonBlank(content.heraldEntityId, 'content heraldEntityId')
            const post = postsByUri.get(providerSubjectId)
            if (post?.kind === 'available') {
                observations.push(
                    ...mapAvailableCounters({
                        projectId,
                        subjectType: 'content',
                        providerSubjectId: post.uri,
                        providerSubjectLabel: post.authorHandle,
                        providerContentRevisionId: post.cid,
                        heraldEntityType: 'publication',
                        heraldEntityId,
                        counters: post.counters,
                        metricNames: blueskyContentMetricNames,
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
                        heraldEntityType: 'publication',
                        heraldEntityId,
                        metricNames: blueskyContentMetricNames,
                        availability:
                            post?.kind === 'unavailable' ? post.availability : 'invalid_response',
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
        observations,
    }
}

function mapAvailableCounters(input: {
    readonly projectId: string
    readonly subjectType: 'account' | 'content'
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
    readonly providerContentRevisionId: string | null
    readonly heraldEntityType: 'channel' | 'publication'
    readonly heraldEntityId: string
    readonly counters: Readonly<BlueskyCounterSnapshot>
    readonly metricNames: readonly string[]
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
            heraldEntityType: input.heraldEntityType,
            heraldEntityId: input.heraldEntityId,
            metricName,
            value: value === undefined ? null : value,
            availability: value === undefined ? 'not_reported' : 'measured',
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
    readonly heraldEntityType: 'channel' | 'publication'
    readonly heraldEntityId: string
    readonly metricNames: readonly string[]
    readonly availability: BlueskyUnavailableAvailability
    readonly fetchedAt: number
}): ProviderAnalyticsObservationInput[] {
    return input.metricNames.map(metricName =>
        createObservation({
            projectId: input.projectId,
            subjectType: input.subjectType,
            providerSubjectId: input.providerSubjectId,
            providerSubjectLabel: input.providerSubjectLabel,
            providerContentRevisionId: input.providerContentRevisionId,
            heraldEntityType: input.heraldEntityType,
            heraldEntityId: input.heraldEntityId,
            metricName,
            value: null,
            availability: input.availability,
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
    readonly heraldEntityType: 'channel' | 'publication'
    readonly heraldEntityId: string
    readonly metricName: string
    readonly value: number | null
    readonly availability: ProviderAnalyticsAvailability
    readonly fetchedAt: number
}): ProviderAnalyticsObservationInput {
    return {
        projectId: input.projectId,
        provider: BLUESKY_PROVIDER,
        subjectType: input.subjectType,
        providerSubjectId: input.providerSubjectId,
        providerSubjectLabel: input.providerSubjectLabel,
        providerContentRevisionId: input.providerContentRevisionId,
        heraldEntityType: input.heraldEntityType,
        heraldEntityId: input.heraldEntityId,
        metricName: input.metricName,
        value: input.value,
        unit: 'count',
        aggregation: 'cumulative_snapshot',
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
        observedAt: null,
        fetchedAt: input.fetchedAt,
        availability: input.availability,
        freshness: 'unknown',
        provenance: BLUESKY_ANALYTICS_PROVENANCE,
    }
}

async function fetchJson(
    fetcher: BlueskyFetcher,
    url: URL
): Promise<{ readonly payload: unknown; readonly status: number } | ProviderResponseFailure> {
    let response: Response
    try {
        response = await fetcher(url, {
            headers: { accept: 'application/json' },
        })
    } catch {
        return { availability: 'temporarily_unavailable' }
    }

    if (!response.ok) {
        let payload: unknown = null
        try {
            payload = await response.json()
        } catch {
            // The status itself is enough to classify the failure.
        }
        const providerError = isRecord(payload) ? providerErrorCode(payload) : null
        return { availability: classifyProviderError(response.status, providerError) }
    }

    try {
        return { payload: await response.json(), status: response.status }
    } catch {
        return { availability: 'invalid_response' }
    }
}

function classifyProviderError(
    status: number,
    providerError: string | null
): BlueskyUnavailableAvailability {
    if (status === 401 || status === 403) return 'not_authorized'
    if (
        status === 404 ||
        /not.?found|actor.?not.?found|profile.?not.?found/i.test(providerError ?? '')
    ) {
        return 'not_found'
    }
    if (/blocked/i.test(providerError ?? '')) return 'blocked'
    if (status === 410 || /deactivat|takedown|suspend/i.test(providerError ?? '')) {
        return 'disabled'
    }
    if (status === 429) return 'rate_limited'
    if (status >= 500) return 'temporarily_unavailable'
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

function readNonBlankString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized.length === 0 ? null : normalized
}

function readAuthorHandle(value: unknown): string | null | typeof invalidString {
    if (value === undefined) return null
    if (!isRecord(value)) return invalidString
    return readOptionalString(value.handle)
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
        const heraldEntityId = requireNonBlank(target.heraldEntityId, 'content heraldEntityId')
        if (seen.has(providerSubjectId)) continue
        seen.add(providerSubjectId)
        normalized.push({ providerSubjectId, heraldEntityId })
    }
    return normalized
}
