import type { MastodonFetcher } from './contract'
import { normalizeMastodonInstanceOrigin } from './publisher'
import { mastodonReplyStatusId } from './reply'

/**
 * Resolve the reply target of a prepared first comment on its own root status.
 *
 * The root status is the parent target, so no descendant or context lookup applies. The root
 * status is read anonymously and the token only authenticates the account verification.
 */
export async function resolveMastodonFirstCommentContext(input: {
    origin: string
    rootUri: string
    accountId: string
    accessToken: string
    fetcher: MastodonFetcher
    signal: AbortSignal
}): Promise<{ parentId: string; visibility: 'public' | 'unlisted' } | null> {
    const origin = normalizedOrigin(input.origin)
    if (origin === null || origin !== input.origin) return null
    // A first comment replies to the root status itself, so the root status is the parent.
    const rootId = mastodonReplyStatusId(input.rootUri, origin)
    if (rootId === null || !/^\d+$/.test(input.accountId)) return null
    if (input.signal.aborted) return null
    async function read(path: string, authenticated: boolean): Promise<unknown> {
        if (input.signal.aborted) return null
        try {
            const response = await input.fetcher(`${origin}/api/v1/${path}`, {
                method: 'GET',
                credentials: 'omit',
                redirect: 'error',
                signal: input.signal,
                headers: {
                    accept: 'application/json',
                    ...(authenticated ? { authorization: `Bearer ${input.accessToken}` } : {}),
                },
            })
            if (!response.ok) return null
            return await response.json()
        } catch {
            // An unanswered identity check never authorizes a comment.
            return null
        }
    }
    const account = await read('accounts/verify_credentials', true)
    if (!record(account) || account.id !== input.accountId) return null
    const root = await read(`statuses/${rootId}`, false)
    if (
        !record(root) ||
        root.id !== rootId ||
        !publicVisibility(root.visibility) ||
        !record(root.account) ||
        root.account.id !== input.accountId
    )
        return null
    return { parentId: rootId, visibility: root.visibility }
}
function normalizedOrigin(value: string): string | null {
    try {
        return normalizeMastodonInstanceOrigin(value)
    } catch {
        return null
    }
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function publicVisibility(value: unknown): value is 'public' | 'unlisted' {
    return value === 'public' || value === 'unlisted'
}
