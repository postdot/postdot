import type { ExternalEffectOutcome } from '@postdot/core'

/** Direct Instagram Login uses its own Graph host, not the Facebook host. */
export const INSTAGRAM_GRAPH_ORIGIN = 'https://graph.instagram.com'
export const INSTAGRAM_GRAPH_VERSION = 'v26.0'
/** Scopes the direct-login publishing flow requires. Connection setup is not part of this package. */
export const INSTAGRAM_PUBLISH_PERMISSIONS = [
    'instagram_business_basic',
    'instagram_business_content_publish',
] as const
/** Conservative application envelope below the documented 8 MB provider ceiling. */
export const INSTAGRAM_MAX_IMAGE_BYTES = 8_000_000
export const INSTAGRAM_MAX_CAPTION_LENGTH = 2200
export const INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH = 1000

export type InstagramFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'permission_denied'
    | 'rate_limited'
    | 'request_rejected'
    | 'unavailable'
    | 'cancelled'
    | 'unknown_result'
export type InstagramFailure = Exclude<ExternalEffectOutcome, { readonly type: 'published' }> & {
    readonly code: InstagramFailureCode
}
export type InstagramResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly outcome: InstagramFailure }

/** A prepared container. It is not a publication and its identity is not a media receipt. */
export interface InstagramContainer {
    readonly containerId: string
}

export type InstagramContainerStatus =
    | 'in_progress'
    | 'finished'
    | 'error'
    | 'expired'
    | 'published'

export interface InstagramContainerState {
    readonly containerId: string
    readonly status: InstagramContainerStatus
}

export type InstagramPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
      })
    | InstagramFailure

export interface InstagramCreateContainerInput {
    readonly accountId: string
    readonly accessToken: string
    /**
     * Public HTTPS URL of inspected Postdot-owned media. Signed query strings
     * are sent verbatim; this package never fetches the image.
     */
    readonly imageUrl: string
    readonly caption?: string
    readonly accessibilityText?: string
}

export interface InstagramReadContainerInput {
    readonly accessToken: string
    readonly containerId: string
}

export interface InstagramPublishContainerInput {
    readonly accountId: string
    readonly accessToken: string
    readonly containerId: string
}

export type InstagramFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>

export interface InstagramPublisherOptions {
    readonly fetcher?: InstagramFetcher
    readonly timeoutMs?: number
    /** Caller cancellation. A cancelled write stays unknown, never published. */
    readonly signal?: AbortSignal
}

const containerStatuses = new Map<string, InstagramContainerStatus>([
    ['IN_PROGRESS', 'in_progress'],
    ['FINISHED', 'finished'],
    ['ERROR', 'error'],
    ['EXPIRED', 'expired'],
    ['PUBLISHED', 'published'],
])

export function createInstagramPublisher(options: InstagramPublisherOptions = {}) {
    const fetcher = options.fetcher ?? fetch
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
        throw new Error('Instagram timeout must be between 1 and 300000 milliseconds')

    async function call(input: {
        readonly token: string
        readonly method: 'GET' | 'POST'
        readonly path: string
        readonly query?: URLSearchParams
        readonly body?: URLSearchParams
        readonly writing: boolean
        readonly signal?: AbortSignal
    }): Promise<InstagramResult<unknown>> {
        const caller = input.signal
        if (caller?.aborted)
            return {
                ok: false,
                outcome: permanent(
                    'cancelled',
                    'The Instagram request was cancelled before it was sent'
                ),
            }

        const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/${INSTAGRAM_GRAPH_VERSION}/${input.path}`)
        if (input.query !== undefined) url.search = input.query.toString()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const onCallerAbort = () => controller.abort()
        caller?.addEventListener('abort', onCallerAbort, { once: true })
        try {
            let response: Response
            try {
                response = await fetcher(url, {
                    method: input.method,
                    redirect: 'error',
                    credentials: 'omit',
                    signal: controller.signal,
                    headers: {
                        authorization: `Bearer ${input.token}`,
                        accept: 'application/json',
                    },
                    ...(input.body === undefined ? {} : { body: input.body }),
                })
            } catch {
                if (caller?.aborted)
                    return {
                        ok: false,
                        outcome: input.writing
                            ? ambiguous(
                                  'cancelled',
                                  'The Instagram request was cancelled; the write outcome is unknown'
                              )
                            : retryable(
                                  'cancelled',
                                  'The Instagram request was cancelled before it completed'
                              ),
                    }
                return input.writing
                    ? {
                          ok: false,
                          outcome: ambiguous(
                              'unknown_result',
                              'The Instagram write outcome is unknown; inspect it before retrying'
                          ),
                      }
                    : { ok: false, outcome: retryable('unavailable', 'Instagram is unavailable') }
            }

            const envelope: unknown = await response.json().catch(() => null)
            if (response.ok && record(envelope) && !Object.hasOwn(envelope, 'error'))
                return { ok: true, value: envelope }

            // Only a structured rejection on a 4xx response proves that a write did not occur.
            const errorCode = graphErrorCode(envelope)
            if (response.status >= 400 && response.status < 500 && errorCode !== null) {
                if (errorCode === 190)
                    return {
                        ok: false,
                        outcome: permanent(
                            'authentication_required',
                            'The Instagram connection must be renewed'
                        ),
                    }
                if (errorCode === 10 || errorCode === 200 || errorCode === 283)
                    return {
                        ok: false,
                        outcome: permanent(
                            'permission_denied',
                            'The Instagram account does not grant publishing access'
                        ),
                    }
                if (response.status === 429 || [4, 17, 32, 613].includes(errorCode)) {
                    const delay = response.headers.get('retry-after')
                    if (
                        delay !== null &&
                        /^\d+$/.test(delay) &&
                        Number(delay) > 0 &&
                        Number(delay) <= 86_400
                    ) {
                        if (!input.writing)
                            return {
                                ok: false,
                                outcome: retryable(
                                    'rate_limited',
                                    'Instagram temporarily limited the request'
                                ),
                            }
                        return {
                            ok: false,
                            outcome: {
                                type: 'deferred',
                                effectOccurred: false,
                                code: 'rate_limited',
                                errorMessage: 'Instagram temporarily limited publishing',
                                resumeAfterMs: Number(delay) * 1000,
                            },
                        }
                    }
                    if (delay !== null)
                        return {
                            ok: false,
                            outcome: permanent(
                                'rate_limited',
                                'Instagram returned an unsupported retry delay; inspect before retrying'
                            ),
                        }
                    return {
                        ok: false,
                        outcome: retryable(
                            'rate_limited',
                            'Instagram temporarily limited publishing'
                        ),
                    }
                }
                if (graphErrorIsTransient(envelope))
                    return {
                        ok: false,
                        outcome: retryable(
                            'unavailable',
                            'Instagram rejected the request temporarily'
                        ),
                    }
                return {
                    ok: false,
                    outcome: permanent('request_rejected', 'Instagram rejected the request'),
                }
            }
            return input.writing
                ? {
                      ok: false,
                      outcome: ambiguous(
                          'unknown_result',
                          'The Instagram write outcome is unknown; inspect it before retrying'
                      ),
                  }
                : { ok: false, outcome: retryable('unavailable', 'Instagram is unavailable') }
        } finally {
            clearTimeout(timer)
            caller?.removeEventListener('abort', onCallerAbort)
        }
    }

    return {
        /**
         * Prepares a media container. Creating one is not a publication: the
         * container identity is returned so the caller can persist it, poll it
         * separately and publish it explicitly.
         */
        async createContainer(
            input: InstagramCreateContainerInput
        ): Promise<InstagramResult<InstagramContainer>> {
            if (
                !numericId(input.accountId) ||
                !validToken(input.accessToken) ||
                !isInstagramImageUrl(input.imageUrl) ||
                (input.caption !== undefined &&
                    (typeof input.caption !== 'string' ||
                        codePointLength(input.caption) > INSTAGRAM_MAX_CAPTION_LENGTH)) ||
                (input.accessibilityText !== undefined &&
                    (typeof input.accessibilityText !== 'string' ||
                        codePointLength(input.accessibilityText) >
                            INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH))
            )
                return {
                    ok: false,
                    outcome: permanent('invalid_input', 'Instagram publication input is invalid'),
                }
            const body = new URLSearchParams({ image_url: input.imageUrl })
            if (input.caption !== undefined && input.caption !== '')
                body.set('caption', input.caption)
            if (input.accessibilityText !== undefined && input.accessibilityText !== '')
                body.set('alt_text', input.accessibilityText)
            const result = await call({
                token: input.accessToken,
                method: 'POST',
                path: `${input.accountId}/media`,
                body,
                writing: true,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            })
            if (!result.ok) return result
            const containerId = record(result.value) ? result.value.id : null
            if (!numericId(containerId) || containerId.includes(input.accessToken))
                return {
                    ok: false,
                    outcome: ambiguous(
                        'unknown_result',
                        'The Instagram container identity is unknown; inspect it before retrying'
                    ),
                }
            return { ok: true, value: { containerId } }
        },

        /** Reads one container status. It never polls and never publishes. */
        async readContainerStatus(
            input: InstagramReadContainerInput
        ): Promise<InstagramResult<InstagramContainerState>> {
            if (!validToken(input.accessToken) || !numericId(input.containerId))
                return {
                    ok: false,
                    outcome: permanent('invalid_input', 'Instagram container input is invalid'),
                }
            const result = await call({
                token: input.accessToken,
                method: 'GET',
                path: input.containerId,
                query: new URLSearchParams({ fields: 'status_code' }),
                writing: false,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            })
            if (!result.ok) return result
            const value = result.value
            if (!record(value))
                return {
                    ok: false,
                    outcome: retryable(
                        'unavailable',
                        'Instagram returned an unreadable container status'
                    ),
                }
            if (value.id !== undefined && value.id !== input.containerId)
                return {
                    ok: false,
                    outcome: retryable(
                        'unavailable',
                        'Instagram returned an unexpected container status'
                    ),
                }
            const status = containerStatuses.get(String(value.status_code))
            if (status === undefined)
                return {
                    ok: false,
                    outcome: retryable(
                        'unavailable',
                        'Instagram returned an unknown container status'
                    ),
                }
            return { ok: true, value: { containerId: input.containerId, status } }
        },

        /**
         * Publishes a prepared container. Only the provider's own published
         * media identity proves a publication; a container identity never does.
         */
        async publishContainer(
            input: InstagramPublishContainerInput
        ): Promise<InstagramPublishOutcome> {
            if (
                !numericId(input.accountId) ||
                !validToken(input.accessToken) ||
                !numericId(input.containerId)
            )
                return permanent('invalid_input', 'Instagram publication input is invalid')
            const result = await call({
                token: input.accessToken,
                method: 'POST',
                path: `${input.accountId}/media_publish`,
                body: new URLSearchParams({ creation_id: input.containerId }),
                writing: true,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            })
            if (!result.ok) return result.outcome
            const mediaId = record(result.value) ? result.value.id : null
            if (
                !numericId(mediaId) ||
                mediaId === input.containerId ||
                mediaId.includes(input.accessToken)
            )
                return ambiguous(
                    'unknown_result',
                    'The Instagram publication outcome is unknown; inspect it before retrying'
                )
            return { type: 'published', externalId: mediaId }
        },
    }
}

/**
 * Requires HTTPS and rejects known local hosts and literal private addresses.
 * Postdot mints these URLs from inspected project-owned media; this check does
 * not resolve DNS or prove public reachability. Signed query strings stay intact,
 * and this package never dereferences the image.
 */
export function isInstagramImageUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false
    if (value.length === 0 || value.length > 4096) return false
    if (value !== value.trim()) return false
    if (containsUnsafeCharacter(value)) return false
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return false
    }
    if (url.protocol !== 'https:') return false
    if (url.username !== '' || url.password !== '') return false
    if (url.hash !== '') return false
    return isPublicHost(url.hostname)
}

function containsUnsafeCharacter(value: string): boolean {
    for (const character of value) {
        const code = character.codePointAt(0) ?? 0
        if (code <= 0x20 || code === 0x7f) return true
        if (character.trim().length === 0) return true
    }
    return false
}

function isPublicHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '')
    if (host === '') return false
    if (host === 'localhost' || host.endsWith('.localhost')) return false
    if (host.endsWith('.local') || host.endsWith('.internal')) return false
    if (host.startsWith('[')) return !isPrivateIpv6(host)
    if (isIpv4Literal(host)) return !isPrivateIpv4(host)
    return true
}

function isIpv4Literal(host: string): boolean {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

function isPrivateIpv4(host: string): boolean {
    const octets = host.split('.').map(part => Number(part))
    const first = octets[0]
    const second = octets[1]
    if (first === undefined || second === undefined) return true
    if (first === 0 || first === 10 || first === 127) return true
    if (first === 100 && second >= 64 && second <= 127) return true
    if (first === 169 && second === 254) return true
    if (first === 172 && second >= 16 && second <= 31) return true
    if (first === 192 && (second === 0 || second === 168)) return true
    if (first === 198 && (second === 18 || second === 19)) return true
    if (first >= 224) return true
    return false
}

function isPrivateIpv6(host: string): boolean {
    const address = (
        host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
    ).toLowerCase()
    if (address === '::' || address === '::1') return true
    const first = firstIpv6Group(address)
    if (first === null) return true
    if ((first & 0xfe00) === 0xfc00) return true
    if ((first & 0xffc0) === 0xfe80) return true
    if ((first & 0xff00) === 0xff00) return true
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
    if (mapped && isPrivateIpv4(mapped[1]!)) return true
    return false
}

function firstIpv6Group(address: string): number | null {
    const head = address.split('::')[0] ?? ''
    const group = head.split(':')[0] ?? ''
    if (group === '') return null
    const value = Number.parseInt(group, 16)
    return Number.isInteger(value) ? value : null
}

function graphErrorCode(envelope: unknown): number | null {
    if (!record(envelope)) return null
    const error = envelope.error
    if (!record(error)) return null
    const code = error.code
    if (typeof code !== 'number' || !Number.isSafeInteger(code) || code <= 0) return null
    return code
}

function graphErrorIsTransient(envelope: unknown): boolean {
    if (!record(envelope)) return false
    const error = envelope.error
    return record(error) && error.is_transient === true
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function numericId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9]\d{0,63}$/.test(value)
}
function validToken(value: unknown): value is string {
    return typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value)
}
function codePointLength(value: string): number {
    return Array.from(value).length
}
function permanent(code: InstagramFailureCode, errorMessage: string): InstagramFailure {
    return { type: 'permanent_failure', effectOccurred: false, code, errorMessage }
}
function retryable(code: InstagramFailureCode, errorMessage: string): InstagramFailure {
    return { type: 'retryable_failure', effectOccurred: false, code, errorMessage }
}
function ambiguous(code: InstagramFailureCode, errorMessage: string): InstagramFailure {
    return { type: 'ambiguous', code, errorMessage }
}
