import { DomainInvariantError } from '@postdot/core'

import { BLUESKY_PUBLIC_API_ORIGIN } from './analytics'
import type { BlueskyFetcher } from './contract'

export const BLUESKY_THREAD_DEFAULT_DEPTH = 6
export const BLUESKY_THREAD_MAX_DEPTH = 6
export const BLUESKY_THREAD_MAX_NODES = 100
export const BLUESKY_THREAD_TIMEOUT_MS = 10_000
export const BLUESKY_THREAD_MAX_TIMEOUT_MS = 60_000

export type BlueskyThreadUnavailableAvailability =
    | 'blocked'
    | 'disabled'
    | 'invalid_response'
    | 'not_authorized'
    | 'not_found'
    | 'not_supported'
    | 'partial_response'
    | 'rate_limited'
    | 'temporarily_unavailable'

export type BlueskyThreadNodeUnavailableAvailability = 'blocked' | 'invalid_response' | 'not_found'

export interface BlueskyThreadPost {
    readonly kind: 'post'
    readonly uri: string
    readonly parentUri: string | null
    readonly authorDid: string
    readonly authorHandle: string
    readonly text: string
    readonly createdAt: number
    readonly externalUrl: string | null
    readonly replies: readonly BlueskyThreadNode[]
}

export interface BlueskyThreadUnavailableNode {
    readonly kind: 'unavailable'
    readonly uri: string | null
    readonly availability: BlueskyThreadNodeUnavailableAvailability
}

export type BlueskyThreadNode = BlueskyThreadPost | BlueskyThreadUnavailableNode

export type BlueskyThreadRead =
    | {
          readonly kind: 'available'
          readonly requestedUri: string
          readonly root: BlueskyThreadPost
          /** Local traversal limits only; this never establishes complete reply coverage. */
          readonly truncated: boolean
      }
    | {
          readonly kind: 'unavailable'
          readonly requestedUri: string
          readonly availability: BlueskyThreadUnavailableAvailability
      }

export interface BlueskyThreadReader {
    getPostThread(
        uri: string,
        options?: {
            readonly depth?: number
        }
    ): Promise<BlueskyThreadRead>
}

export function createBlueskyThreadReader(
    options: {
        readonly fetcher?: BlueskyFetcher
        readonly timeoutMs?: number
    } = {}
): BlueskyThreadReader {
    const fetcher = options.fetcher ?? globalThis.fetch
    const timeoutMs = normalizeTimeout(options.timeoutMs)

    return {
        async getPostThread(uri, readOptions = {}) {
            const requestedUri = uri.trim()
            if (!isBlueskyPostUri(requestedUri)) {
                return {
                    kind: 'unavailable',
                    requestedUri,
                    availability: 'invalid_response',
                }
            }
            const depth = normalizeDepth(readOptions.depth)

            const url = new URL('/xrpc/app.bsky.feed.getPostThread', BLUESKY_PUBLIC_API_ORIGIN)
            url.searchParams.set('uri', requestedUri)
            url.searchParams.set('depth', String(depth))
            url.searchParams.set('parentHeight', '0')

            const response = await fetchThread(fetcher, url, timeoutMs)
            if ('availability' in response) {
                return {
                    kind: 'unavailable',
                    requestedUri,
                    availability: response.availability,
                }
            }

            return readThread(response.payload, requestedUri, depth)
        },
    }
}

function readThread(payload: unknown, requestedUri: string, depth: number): BlueskyThreadRead {
    if (!isRecord(payload) || !('thread' in payload)) {
        return unavailable(requestedUri, 'invalid_response')
    }

    const context: ReadContext = {
        depth,
        remainingNodes: BLUESKY_THREAD_MAX_NODES,
        truncated: false,
    }
    const root = readNode(payload.thread, null, 0, context)
    if (root === null || root.kind === 'unavailable') {
        if (
            root?.kind === 'unavailable' &&
            root.uri === requestedUri &&
            root.availability !== 'invalid_response'
        ) {
            return unavailable(requestedUri, root.availability)
        }
        return unavailable(requestedUri, 'invalid_response')
    }
    if (root.uri !== requestedUri) {
        return unavailable(requestedUri, 'invalid_response')
    }

    return {
        kind: 'available',
        requestedUri,
        root,
        truncated: context.truncated,
    }
}

interface ReadContext {
    readonly depth: number
    remainingNodes: number
    truncated: boolean
}

function readNode(
    raw: unknown,
    structuralParentUri: string | null,
    level: number,
    context: ReadContext
): BlueskyThreadNode | null {
    if (context.remainingNodes <= 0) {
        context.truncated = true
        return null
    }
    context.remainingNodes -= 1

    if (!isRecord(raw)) {
        return unavailableNode(null, 'invalid_response')
    }

    const type = typeof raw.$type === 'string' ? raw.$type : null
    if (raw.blocked === true || type === 'app.bsky.feed.defs#blockedPost') {
        const uri = readPostUri(raw.uri)
        return uri === null
            ? unavailableNode(readNodeUri(raw), 'invalid_response')
            : unavailableNode(uri, 'blocked')
    }
    if (raw.notFound === true || type === 'app.bsky.feed.defs#notFoundPost') {
        const uri = readPostUri(raw.uri)
        return uri === null
            ? unavailableNode(readNodeUri(raw), 'invalid_response')
            : unavailableNode(uri, 'not_found')
    }
    if (type !== null && type !== 'app.bsky.feed.defs#threadViewPost') {
        return unavailableNode(readNodeUri(raw), 'invalid_response')
    }

    return readPostNode(raw, structuralParentUri, level, context)
}

function readPostNode(
    raw: Record<string, unknown>,
    structuralParentUri: string | null,
    level: number,
    context: ReadContext
): BlueskyThreadNode {
    const post = raw.post
    if (!isRecord(post)) {
        return unavailableNode(readNodeUri(raw), 'invalid_response')
    }

    const uri = readPostUri(post.uri)
    const record = post.record
    const author = post.author
    if (uri === null || !isRecord(record) || !isRecord(author)) {
        return unavailableNode(uri, 'invalid_response')
    }

    const authorDid = readBlueskyDid(author.did)
    const authorHandle = readNonBlankString(author.handle)
    const text = typeof record.text === 'string' ? record.text : null
    const createdAt = readCreatedAt(record.createdAt)
    if (authorDid === null || authorHandle === null || text === null || createdAt === null) {
        return unavailableNode(uri, 'invalid_response')
    }
    if (raw.replies !== undefined && !Array.isArray(raw.replies)) {
        return unavailableNode(uri, 'invalid_response')
    }

    const parentUri = readReplyParentUri(record.reply) ?? structuralParentUri
    const externalUrl = `https://bsky.app/profile/${encodeURIComponent(authorDid)}/post/${encodeURIComponent(uri.slice(uri.lastIndexOf('/') + 1))}`
    const replies: BlueskyThreadNode[] = []
    if (Array.isArray(raw.replies)) {
        for (const child of raw.replies) {
            if (level >= context.depth) {
                context.truncated = true
                break
            }
            const childNode = readNode(child, uri, level + 1, context)
            if (childNode === null) break
            replies.push(childNode)
        }
    }

    return {
        kind: 'post',
        uri,
        parentUri,
        authorDid,
        authorHandle,
        text,
        createdAt,
        externalUrl,
        replies,
    }
}

function unavailable(
    requestedUri: string,
    availability: BlueskyThreadUnavailableAvailability
): BlueskyThreadRead {
    return { kind: 'unavailable', requestedUri, availability }
}

function unavailableNode(
    uri: string | null,
    availability: BlueskyThreadNodeUnavailableAvailability
): BlueskyThreadUnavailableNode {
    return { kind: 'unavailable', uri, availability }
}

function readNodeUri(raw: Record<string, unknown>): string | null {
    const directUri = readPostUri(raw.uri)
    if (directUri !== null) return directUri
    const post = raw.post
    return isRecord(post) ? readPostUri(post.uri) : null
}

function readReplyParentUri(value: unknown): string | null {
    if (!isRecord(value)) return null
    const parent = value.parent
    if (!isRecord(parent)) return null
    return readPostUri(parent.uri)
}

type ThreadFetchResult =
    | {
          readonly payload: unknown
          readonly status: number
      }
    | {
          readonly availability: BlueskyThreadUnavailableAvailability
      }

async function fetchThread(
    fetcher: BlueskyFetcher,
    url: URL,
    timeoutMs: number
): Promise<ThreadFetchResult> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
        const result = await Promise.race([
            (async () => {
                const response = await fetcher(url, {
                    headers: { accept: 'application/json' },
                    credentials: 'omit',
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
                        payload = null
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
): BlueskyThreadUnavailableAvailability {
    if (status === 401 || status === 403) return 'not_authorized'
    if (status === 404) return 'not_found'
    if (status === 410) return 'disabled'
    if (status === 429) return 'rate_limited'
    if (status >= 500) return 'temporarily_unavailable'
    if (/blocked/i.test(providerError ?? '')) return 'blocked'
    if (/unsupported|not.?supported/i.test(providerError ?? '')) return 'not_supported'
    if (/partial|incomplete|truncated/i.test(providerError ?? '')) return 'partial_response'
    if (/not.?found/i.test(providerError ?? '')) return 'not_found'
    if (/(?:deactivate|deactivated|deactivation|takedown|suspend)/i.test(providerError ?? ''))
        return 'disabled'
    return 'invalid_response'
}

function providerErrorCode(payload: Record<string, unknown>): string | null {
    if (typeof payload.error === 'string') return payload.error
    return typeof payload.message === 'string' ? payload.message : null
}

function readCreatedAt(value: unknown): number | null {
    if (typeof value !== 'string') return null
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null
}

function readPostUri(value: unknown): string | null {
    const uri = readNonBlankString(value)
    return uri !== null && isBlueskyPostUri(uri) ? uri : null
}

function readBlueskyDid(value: unknown): string | null {
    const did = readNonBlankString(value)
    return did !== null && /^did:[^\s:]+:[^\s]+$/.test(did) ? did : null
}

function readNonBlankString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized.length === 0 ? null : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBlueskyPostUri(value: string): boolean {
    return /^at:\/\/did:[^/\s]+\/app\.bsky\.feed\.post\/[^/\s]+$/.test(value)
}

function normalizeDepth(value: number | undefined): number {
    if (value === undefined) return BLUESKY_THREAD_DEFAULT_DEPTH
    if (!Number.isSafeInteger(value) || value < 0 || value > BLUESKY_THREAD_MAX_DEPTH) {
        throw new DomainInvariantError(
            'invalid_input',
            `depth must be between 0 and ${BLUESKY_THREAD_MAX_DEPTH}`
        )
    }
    return value
}

function normalizeTimeout(value: number | undefined): number {
    if (value === undefined) return BLUESKY_THREAD_TIMEOUT_MS
    if (!Number.isSafeInteger(value) || value < 1 || value > BLUESKY_THREAD_MAX_TIMEOUT_MS) {
        throw new DomainInvariantError(
            'invalid_input',
            `timeoutMs must be between 1 and ${BLUESKY_THREAD_MAX_TIMEOUT_MS}`
        )
    }
    return value
}
