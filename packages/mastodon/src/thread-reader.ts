import { decodeHTML } from 'entities'

import type { MastodonFetcher } from './contract'
import { normalizeMastodonInstanceOrigin } from './publisher'

export type MastodonThreadFailure =
    | 'invalid_response'
    | 'not_authorized'
    | 'not_found'
    | 'not_supported'
    | 'rate_limited'
    | 'temporarily_unavailable'

export interface MastodonStatusReference {
    readonly origin: string
    readonly statusId: string
    readonly rootUri: string
}

export interface MastodonThreadComment {
    readonly uri: string
    readonly parentUri: string
    readonly depth: number
    readonly authorHandle: string
    readonly text: string
    readonly createdAt: number
    readonly externalUrl: string
}

export type MastodonThreadRead =
    | {
          readonly kind: 'available'
          readonly requestedUri: string
          readonly comments: readonly MastodonThreadComment[]
          readonly truncated: boolean
      }
    | {
          readonly kind: 'unavailable'
          readonly requestedUri: string
          readonly availability: MastodonThreadFailure
      }

/** Only a retained permalink with the exact local status ID identifies its original instance. */
export function resolveMastodonStatusReference(
    statusId: string | null,
    permalink: string | null
): MastodonStatusReference | null {
    if (statusId === null || !/^\d+$/.test(statusId) || permalink === null) return null
    try {
        const url = new URL(permalink)
        if (url.username || url.password || url.search || url.hash) return null
        const origin = normalizeMastodonInstanceOrigin(url.origin)
        if (
            !new RegExp(`^/(?:@[^/]+/${statusId}|users/[^/]+/statuses/${statusId})$`).test(
                url.pathname
            )
        )
            return null
        return { origin, statusId, rootUri: `${origin}/api/v1/statuses/${statusId}` }
    } catch {
        return null
    }
}

export interface MastodonThreadReader {
    getPostThread(reference: MastodonStatusReference): Promise<MastodonThreadRead>
}

/** Anonymous only. The application must supply its network-controlled fetcher. */
export function createMastodonThreadReader(options: {
    readonly fetcher: MastodonFetcher
    readonly timeoutMs?: number
}): MastodonThreadReader {
    const timeoutMs = options.timeoutMs ?? 10_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
        throw new RangeError('Invalid Mastodon thread timeout')
    return {
        async getPostThread(reference) {
            const { origin, statusId, rootUri } = reference
            const unavailable = (availability: MastodonThreadFailure): MastodonThreadRead => ({
                kind: 'unavailable',
                requestedUri: rootUri,
                availability,
            })
            if (
                !/^\d+$/.test(statusId) ||
                !validOrigin(origin) ||
                rootUri !== `${origin}/api/v1/statuses/${statusId}`
            )
                return unavailable('invalid_response')
            const controller = new AbortController()
            let timer: ReturnType<typeof setTimeout> | undefined
            // Enforce the deadline even when an injected transport ignores AbortSignal.
            const deadline = new Promise<MastodonThreadRead>(resolve => {
                timer = setTimeout(() => {
                    controller.abort()
                    resolve(unavailable('temporarily_unavailable'))
                }, timeoutMs)
            })
            async function request(
                path: string
            ): Promise<{ failure: MastodonThreadFailure } | { body: unknown }> {
                const response = await options.fetcher(`${rootUri}${path}`, {
                    method: 'GET',
                    headers: { accept: 'application/json' },
                    credentials: 'omit',
                    redirect: 'error',
                    signal: controller.signal,
                })
                if (!response.ok) {
                    const failure: MastodonThreadFailure =
                        response.status === 404 || response.status === 410
                            ? 'not_found'
                            : response.status === 401 || response.status === 403
                              ? 'not_authorized'
                              : response.status === 429
                                ? 'rate_limited'
                                : 'temporarily_unavailable'
                    return { failure } as const
                }
                const body: unknown = await response.json().catch(() => null)
                return { body } as const
            }
            async function read(): Promise<MastodonThreadRead> {
                const root = await request('')
                if ('failure' in root) return unavailable(root.failure)
                if (!record(root.body) || root.body.id !== statusId)
                    return unavailable('invalid_response')
                // Never import restricted content even from a misconfigured instance.
                if (!publicVisibility(root.body.visibility)) return unavailable('not_found')
                if (controller.signal.aborted) return unavailable('temporarily_unavailable')
                const context = await request('/context')
                if ('failure' in context) return unavailable(context.failure)
                if (!record(context.body) || !Array.isArray(context.body.descendants))
                    return unavailable('invalid_response')
                const descendants = context.body.descendants
                const byParent = new Map<string, Record<string, unknown>[]>()
                const seen = new Set([statusId])
                // Public Mastodon context is capped at 60 descendants. Bound work even for other servers.
                let truncated = descendants.length >= 60
                for (const value of descendants.slice(0, 60)) {
                    if (
                        !record(value) ||
                        typeof value.id !== 'string' ||
                        !/^\d+$/.test(value.id) ||
                        typeof value.in_reply_to_id !== 'string' ||
                        !/^\d+$/.test(value.in_reply_to_id) ||
                        seen.has(value.id)
                    )
                        return unavailable('invalid_response')
                    seen.add(value.id)
                    const siblings = byParent.get(value.in_reply_to_id) ?? []
                    siblings.push(value)
                    byParent.set(value.in_reply_to_id, siblings)
                }
                const comments: MastodonThreadComment[] = []
                let visited = 0
                async function append(parentId: string, depth: number): Promise<boolean> {
                    const children = byParent.get(parentId) ?? []
                    if (depth > 6) {
                        if (children.length) truncated = true
                        return true
                    }
                    for (const value of children) {
                        visited++
                        if (!publicVisibility(value.visibility)) {
                            // A restricted node and its descendants stay outside the public snapshot.
                            truncated = true
                            continue
                        }
                        if (
                            !record(value.account) ||
                            typeof value.account.acct !== 'string' ||
                            !value.account.acct.trim() ||
                            typeof value.content !== 'string' ||
                            value.content.length > 100_000 ||
                            typeof value.created_at !== 'string'
                        )
                            return false
                        const createdAt = Date.parse(value.created_at)
                        if (!Number.isSafeInteger(createdAt) || createdAt < 0) return false
                        const id = value.id as string
                        const acct = value.account.acct
                        const content = await plainText(value.content)
                        const warning =
                            typeof value.spoiler_text === 'string' ? value.spoiler_text : ''
                        comments.push({
                            uri: `${origin}/api/v1/statuses/${id}`,
                            parentUri: `${origin}/api/v1/statuses/${parentId}`,
                            depth,
                            authorHandle: acct.includes('@')
                                ? acct
                                : `${acct}@${new URL(origin).host}`,
                            text: warning ? `${warning}\n\n${content}` : content,
                            createdAt,
                            // Link through the original instance, never a provider-supplied remote URL.
                            externalUrl: `${origin}/web/statuses/${id}`,
                        })
                        if (!(await append(id, depth + 1))) return false
                    }
                    return true
                }
                if (!(await append(statusId, 0))) return unavailable('invalid_response')
                if (visited < Math.min(descendants.length, 60)) truncated = true
                return { kind: 'available', requestedUri: rootUri, comments, truncated }
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

function validOrigin(origin: string): boolean {
    try {
        return normalizeMastodonInstanceOrigin(origin) === origin
    } catch {
        return false
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function publicVisibility(value: unknown) {
    return value === 'public' || value === 'unlisted'
}

async function plainText(html: string): Promise<string> {
    const response = new HTMLRewriter()
        .on('*', {
            element(element) {
                if (['script', 'style'].includes(element.tagName)) element.remove()
                else if (element.tagName === 'br') element.replace('\n')
                else {
                    if (['p', 'div', 'li', 'blockquote'].includes(element.tagName))
                        element.append('\n')
                    element.removeAndKeepContent()
                }
            },
            comments(comment) {
                comment.remove()
            },
        })
        .onDocument({
            comments(comment) {
                comment.remove()
            },
        })
        .transform(new Response(html))
    return decodeHTML(await response.text()).trim()
}
