import type { MastodonFetcher } from './contract'
import type { MastodonStatusReference, MastodonThreadFailure } from './thread-reader'
import { resolveMastodonStatusReference } from './thread-reader'

export type MastodonAnalyticsMetricName = 'favourites_count' | 'reblogs_count' | 'replies_count'

/** One status-local counter snapshot with an explicit reporting state. */
export type MastodonAnalyticsMetric = {
    readonly value: number | null
    readonly availability: 'measured' | 'not_reported' | 'invalid_response'
}

export type MastodonAnalyticsRead =
    | {
          readonly kind: 'available'
          readonly requestedUri: string
          readonly metrics: Readonly<Record<MastodonAnalyticsMetricName, MastodonAnalyticsMetric>>
      }
    | {
          readonly kind: 'unavailable'
          readonly requestedUri: string
          readonly availability: MastodonThreadFailure
      }

export interface MastodonAnalyticsReader {
    getStatusMetrics(reference: MastodonStatusReference): Promise<MastodonAnalyticsRead>
}

interface CanonicalTarget {
    readonly origin: string
    readonly statusId: string
    readonly rootUri: string
}

/**
 * Anonymous only. The application must supply its network-controlled fetcher.
 * Reads the engagement counters of one status on its own instance: no account
 * statistics, reach, rate, quote or comment payloads are requested.
 */
export function createMastodonAnalyticsReader(options: {
    readonly fetcher: MastodonFetcher
    readonly timeoutMs?: number
}): MastodonAnalyticsReader {
    const timeoutMs = options.timeoutMs ?? 10_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
        throw new RangeError('Invalid Mastodon analytics timeout')
    return {
        async getStatusMetrics(reference) {
            const requestedUri = typeof reference?.rootUri === 'string' ? reference.rootUri : ''
            const unavailable = (availability: MastodonThreadFailure): MastodonAnalyticsRead => ({
                kind: 'unavailable',
                requestedUri,
                availability,
            })
            const target = canonicalTarget(reference)
            if (!target) return unavailable('invalid_response')
            const { origin, statusId, rootUri } = target
            const controller = new AbortController()
            let timer: ReturnType<typeof setTimeout> | undefined
            // Enforce the deadline even when an injected transport ignores AbortSignal.
            const deadline = new Promise<MastodonAnalyticsRead>(resolve => {
                timer = setTimeout(() => {
                    controller.abort()
                    resolve(unavailable('temporarily_unavailable'))
                }, timeoutMs)
            })
            async function read(): Promise<MastodonAnalyticsRead> {
                const response = await options.fetcher(rootUri, {
                    method: 'GET',
                    headers: { accept: 'application/json' },
                    credentials: 'omit',
                    redirect: 'error',
                    signal: controller.signal,
                })
                if (!response.ok) {
                    const availability: MastodonThreadFailure =
                        response.status === 401 || response.status === 403
                            ? 'not_authorized'
                            : response.status === 404 || response.status === 410
                              ? 'not_found'
                              : response.status === 429
                                ? 'rate_limited'
                                : 'temporarily_unavailable'
                    return unavailable(availability)
                }
                const body: unknown = await response.json().catch(() => null)
                if (!record(body) || body.id !== statusId) return unavailable('invalid_response')
                // A boost wraps another status; its counters are not the requested status.
                if (body.reblog !== undefined && body.reblog !== null)
                    return unavailable('invalid_response')
                // Never expose a status the instance does not publish publicly.
                if (!publicVisibility(body.visibility)) return unavailable('not_found')
                // Status identifiers are local to an instance: reject any foreign identity.
                if (
                    !sameInstanceUri(body.uri, origin, statusId) ||
                    !sameInstanceUri(body.url, origin, statusId) ||
                    !sameInstanceAccount(body.account, origin)
                )
                    return unavailable('invalid_response')
                return {
                    kind: 'available',
                    requestedUri: rootUri,
                    metrics: {
                        favourites_count: readMetric(body.favourites_count),
                        reblogs_count: readMetric(body.reblogs_count),
                        replies_count: readMetric(body.replies_count),
                    },
                }
            }
            try {
                return await Promise.race([read(), deadline])
            } catch {
                return unavailable('temporarily_unavailable')
            } finally {
                clearTimeout(timer)
            }
        },
    }
}

/**
 * The shared reference validator only accepts a permalink, so the canonical
 * origin and the local identifier are re-derived from it instead of trusting
 * the caller's URI. Only a reference that addresses the original instance
 * exactly survives.
 */
function canonicalTarget(reference: MastodonStatusReference): CanonicalTarget | null {
    if (typeof reference?.origin !== 'string' || typeof reference.statusId !== 'string') return null
    if (!/^\d+$/.test(reference.statusId)) return null
    const canonical = resolveMastodonStatusReference(
        reference.statusId,
        `${reference.origin}/@status/${reference.statusId}`
    )
    if (!canonical || canonical.rootUri !== reference.rootUri) return null
    return { origin: canonical.origin, statusId: canonical.statusId, rootUri: canonical.rootUri }
}

/** The URI and the permalink must address the same status on the same instance. */
function sameInstanceUri(value: unknown, origin: string, statusId: string): boolean {
    if (typeof value !== 'string' || value.length === 0) return false
    try {
        const url = new URL(value)
        if (url.username || url.password) return false
        if (url.origin !== origin) return false
        return url.pathname.endsWith(`/${statusId}`)
    } catch {
        return false
    }
}

/** The author identity, when the instance reports one, must belong to the same instance. */
function sameInstanceAccount(value: unknown, origin: string): boolean {
    if (value === undefined || value === null) return true
    if (!record(value)) return false
    const url = value.url
    if (url === undefined || url === null) return true
    if (typeof url !== 'string' || url.length === 0) return false
    try {
        const parsed = new URL(url)
        if (parsed.username || parsed.password) return false
        return parsed.origin === origin
    } catch {
        return false
    }
}

function readMetric(value: unknown): MastodonAnalyticsMetric {
    if (value === undefined || value === null) return { value: null, availability: 'not_reported' }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        return { value: null, availability: 'invalid_response' }
    return { value: value === 0 ? 0 : value, availability: 'measured' }
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function publicVisibility(value: unknown): boolean {
    return value === 'public' || value === 'unlisted'
}
