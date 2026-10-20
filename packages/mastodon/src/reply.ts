import type { MastodonFetcher } from './contract'
import { normalizeMastodonInstanceOrigin } from './publisher'

export function mastodonReplyTextValid(text: string): boolean {
    return text.trim().length > 0 && text.length <= 500
}

/** Snapshot identifiers are local to the publishing instance, never remote account permalinks. */
export function mastodonReplyStatusId(uri: string, origin: string): string | null {
    const prefix = `${origin}/api/v1/statuses/`
    const id = uri.startsWith(prefix) ? uri.slice(prefix.length) : ''
    return /^\d+$/.test(id) ? id : null
}

/** Resolve public ancestry without credentials; only account verification receives the token. */
export async function resolveMastodonReplyContext(input: {
    origin: string
    rootUri: string
    parentUri: string
    accountId: string
    accessToken: string
    fetcher: MastodonFetcher
    signal: AbortSignal
}): Promise<{ parentId: string; visibility: 'public' | 'unlisted' } | null> {
    if (normalizeMastodonInstanceOrigin(input.origin) !== input.origin) return null
    const rootId = mastodonReplyStatusId(input.rootUri, input.origin)
    const parentId = mastodonReplyStatusId(input.parentUri, input.origin)
    if (!rootId || !parentId || rootId === parentId || !/^\d+$/.test(input.accountId)) return null
    async function read(path: string, authenticated = false): Promise<unknown> {
        if (input.signal.aborted) return null
        const response = await input.fetcher(`${input.origin}/api/v1/${path}`, {
            method: 'GET',
            credentials: 'omit',
            redirect: 'error',
            signal: input.signal,
            headers: {
                accept: 'application/json',
                ...(authenticated ? { authorization: `Bearer ${input.accessToken}` } : {}),
            },
        })
        return response.ok ? response.json() : null
    }
    const account = await read('accounts/verify_credentials', true)
    if (!record(account) || account.id !== input.accountId) return null
    const root = await read(`statuses/${rootId}`)
    if (
        !record(root) ||
        root.id !== rootId ||
        !publicVisibility(root.visibility) ||
        !record(root.account) ||
        root.account.id !== input.accountId
    )
        return null
    const parent = await read(`statuses/${parentId}`)
    if (!record(parent) || parent.id !== parentId || !publicVisibility(parent.visibility))
        return null
    const context = await read(`statuses/${parentId}/context`)
    if (
        !record(context) ||
        !Array.isArray(context.ancestors) ||
        !context.ancestors.some(value => record(value) && value.id === rootId)
    )
        return null
    return {
        parentId,
        visibility:
            root.visibility === 'unlisted' || parent.visibility === 'unlisted'
                ? 'unlisted'
                : 'public',
    }
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function publicVisibility(value: unknown): value is 'public' | 'unlisted' {
    return value === 'public' || value === 'unlisted'
}
