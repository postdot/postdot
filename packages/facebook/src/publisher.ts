import type { ExternalEffectOutcome } from '@postdot/core'

export const FACEBOOK_GRAPH_VERSION = 'v26.0'
export const FACEBOOK_MAX_PHOTO_BYTES = 10_000_000
export const FACEBOOK_PUBLISH_PERMISSIONS = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
] as const

export type FacebookFailureCode =
    | 'invalid_input'
    | 'authentication_required'
    | 'permission_denied'
    | 'rate_limited'
    | 'request_rejected'
    | 'unavailable'
    | 'unknown_result'
export type FacebookFailure = Exclude<ExternalEffectOutcome, { readonly type: 'published' }> & {
    readonly code: FacebookFailureCode
}
export type FacebookResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly outcome: FacebookFailure }
export type FacebookPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly mediaId?: string
      })
    | FacebookFailure
export interface FacebookPage {
    readonly id: string
    readonly name: string
    /** Server-side connection setup only. Never expose this object through a public API. */
    readonly accessToken: string
    readonly tasks: readonly string[]
    readonly hasPublishTask: boolean
}
export interface FacebookPageBatch {
    readonly pages: readonly FacebookPage[]
    /** Opaque cursor, not a URL. Null means there is no next page. */
    readonly nextCursor: string | null
}
export interface FacebookPageSelection {
    readonly page: FacebookPage
    readonly grantedPermissions: readonly string[]
}
export interface FacebookPhoto {
    /** Inspected bytes from project-owned storage, not an arbitrary remote URL. */
    readonly blob: Blob
    readonly accessibilityText?: string
}
export interface FacebookSendInput {
    readonly pageToken: string
    readonly pageId: string
    readonly text: string
    readonly link?: string
    readonly photo?: FacebookPhoto
}
export type FacebookFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>

export function createFacebookPublisher(
    options: { readonly fetcher?: FacebookFetcher; readonly timeoutMs?: number } = {}
) {
    const fetcher = options.fetcher ?? fetch
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
        throw new Error('Facebook timeout must be between 1 and 300000 milliseconds')

    async function call(
        token: string,
        path: string,
        query: URLSearchParams,
        body?: URLSearchParams | FormData
    ): Promise<FacebookResult<unknown>> {
        const writing = body !== undefined
        const url = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${path}`)
        url.search = query.toString()
        try {
            const response = await fetcher(url, {
                method: writing ? 'POST' : 'GET',
                redirect: 'error',
                signal: AbortSignal.timeout(timeoutMs),
                headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
                ...(body === undefined ? {} : { body }),
            })
            const envelope: unknown = await response.json().catch(() => null)
            if (response.ok && record(envelope) && !Object.hasOwn(envelope, 'error'))
                return { ok: true, value: envelope }
            // Only a structured rejection on a 4xx response proves a write did not occur.
            if (
                response.status >= 400 &&
                response.status < 500 &&
                record(envelope) &&
                record(envelope.error) &&
                Number.isSafeInteger(envelope.error.code) &&
                (envelope.error.code as number) > 0
            ) {
                const code = envelope.error.code
                if (code === 190)
                    return failed(
                        'The Facebook connection must be renewed',
                        'authentication_required'
                    )
                if (code === 10 || code === 200 || code === 283)
                    return failed(
                        'The Facebook Page does not grant publishing access',
                        'permission_denied'
                    )
                if (response.status === 429 || [4, 17, 32, 613].includes(code as number)) {
                    const delay = response.headers.get('retry-after')
                    if (
                        delay &&
                        /^\d+$/.test(delay) &&
                        Number(delay) > 0 &&
                        Number(delay) <= 86_400
                    )
                        return {
                            ok: false,
                            outcome: {
                                type: 'deferred',
                                effectOccurred: false,
                                code: 'rate_limited',
                                errorMessage: 'Facebook temporarily limited publishing',
                                resumeAfterMs: Number(delay) * 1000,
                            },
                        }
                    if (delay !== null)
                        return failed(
                            'Facebook returned an unsupported retry delay; inspect before retrying',
                            'rate_limited'
                        )
                    return retryable('Facebook temporarily limited publishing', 'rate_limited')
                }
                if (envelope.error.is_transient === true)
                    return retryable('Facebook rejected the request temporarily', 'unavailable')
                return failed('Facebook rejected the request', 'request_rejected')
            }
            return writing
                ? unknownWrite()
                : retryable('Facebook discovery is unavailable', 'unavailable')
        } catch {
            return writing
                ? unknownWrite()
                : retryable('Facebook discovery is unavailable', 'unavailable')
        }
    }

    async function listPages(input: {
        readonly userToken: string
        readonly after?: string
    }): Promise<FacebookResult<FacebookPageBatch>> {
        if (
            !validToken(input.userToken) ||
            (input.after !== undefined && !validCursor(input.after, input.userToken))
        )
            return failed('Facebook discovery input is invalid', 'invalid_input')
        const query = new URLSearchParams({
            fields: 'id,name,access_token,tasks',
            limit: '100',
        })
        if (input.after !== undefined) query.set('after', input.after)
        const result = await call(input.userToken, 'me/accounts', query)
        if (!result.ok) return result
        if (!record(result.value) || !Array.isArray(result.value.data))
            return retryable('Facebook returned an invalid Page list', 'unavailable')
        const pages: FacebookPage[] = []
        const seen = new Set<string>()
        for (const page of result.value.data) {
            if (
                !record(page) ||
                !numericId(page.id) ||
                typeof page.name !== 'string' ||
                !page.name.trim() ||
                page.name.includes(input.userToken) ||
                !validToken(page.access_token) ||
                !Array.isArray(page.tasks) ||
                !page.tasks.every(
                    task =>
                        typeof task === 'string' &&
                        task.length <= 128 &&
                        !task.includes(input.userToken)
                ) ||
                seen.has(page.id)
            )
                return retryable('Facebook returned an invalid Page list', 'unavailable')
            seen.add(page.id)
            pages.push({
                id: page.id,
                name: page.name,
                accessToken: page.access_token,
                tasks: page.tasks,
                hasPublishTask: page.tasks.some(
                    task => task === 'CREATE_CONTENT' || task === 'PROFILE_PLUS_CREATE_CONTENT'
                ),
            })
        }
        let nextCursor: string | null = null
        if (result.value.paging !== undefined) {
            const paging = result.value.paging
            if (!record(paging))
                return retryable('Facebook returned invalid pagination', 'unavailable')
            if (paging.next !== undefined && paging.next !== null) {
                if (!record(paging.cursors) || !validCursor(paging.cursors.after, input.userToken))
                    return retryable('Facebook returned invalid pagination', 'unavailable')
                nextCursor = paging.cursors.after
            }
        }
        return { ok: true, value: { pages, nextCursor } }
    }

    async function getGrantedPermissions(
        userToken: string
    ): Promise<FacebookResult<readonly string[]>> {
        if (!validToken(userToken))
            return failed('Facebook permission input is invalid', 'invalid_input')
        const result = await call(
            userToken,
            'me/permissions',
            new URLSearchParams({ limit: '100' })
        )
        if (!result.ok) return result
        if (
            !record(result.value) ||
            !Array.isArray(result.value.data) ||
            (result.value.paging !== undefined &&
                (!record(result.value.paging) || result.value.paging.next != null))
        )
            return retryable('Facebook returned an incomplete permission list', 'unavailable')
        const seen = new Set<string>()
        const granted: string[] = []
        for (const permission of result.value.data) {
            if (
                !record(permission) ||
                typeof permission.permission !== 'string' ||
                !/^[a-z][a-z0-9_]{0,127}$/.test(permission.permission) ||
                typeof permission.status !== 'string' ||
                !['granted', 'declined', 'expired'].includes(permission.status) ||
                seen.has(permission.permission)
            )
                return retryable('Facebook returned an invalid permission list', 'unavailable')
            seen.add(permission.permission)
            if (permission.status === 'granted') granted.push(permission.permission)
        }
        return { ok: true, value: granted.sort() }
    }

    return {
        /** Reads one batch; the caller chooses a Page. Tokens stay on the server. */
        listPages,
        getGrantedPermissions,
        /** Requires a user token from a validated, installation-bound OAuth callback. */
        async selectPage(input: {
            readonly userToken: string
            readonly pageId: string
            readonly after?: string
        }): Promise<FacebookResult<FacebookPageSelection>> {
            if (
                !numericId(input.pageId) ||
                !validToken(input.userToken) ||
                (input.after !== undefined && !validCursor(input.after, input.userToken))
            )
                return failed('Facebook Page selection is invalid', 'invalid_input')
            const permissions = await getGrantedPermissions(input.userToken)
            if (!permissions.ok) return permissions
            if (
                !FACEBOOK_PUBLISH_PERMISSIONS.every(permission =>
                    permissions.value.includes(permission)
                )
            )
                return failed(
                    'Facebook publishing permissions were not granted',
                    'permission_denied'
                )
            const pages = await listPages(input)
            if (!pages.ok) return pages
            const page = pages.value.pages.find(candidate => candidate.id === input.pageId)
            if (!page || !page.hasPublishTask)
                return failed(
                    'The selected Facebook Page is unavailable for publishing',
                    'permission_denied'
                )
            return { ok: true, value: { page, grantedPermissions: permissions.value } }
        },

        async send(input: FacebookSendInput): Promise<FacebookPublishOutcome> {
            const link = input.link === '' ? undefined : input.link
            if (
                !validToken(input.pageToken) ||
                !numericId(input.pageId) ||
                typeof input.text !== 'string' ||
                (link !== undefined && !isFacebookLink(link)) ||
                (input.photo !== undefined && link !== undefined) ||
                (!input.text.trim() && link === undefined && input.photo === undefined)
            )
                return failed('Facebook publication input is invalid', 'invalid_input').outcome
            let body: URLSearchParams | FormData
            if (input.photo !== undefined) {
                const photo = input.photo
                if (
                    !record(photo) ||
                    !(photo.blob instanceof Blob) ||
                    !['image/jpeg', 'image/png'].includes(photo.blob.type) ||
                    photo.blob.size < 1 ||
                    photo.blob.size > FACEBOOK_MAX_PHOTO_BYTES ||
                    (photo.accessibilityText !== undefined &&
                        typeof photo.accessibilityText !== 'string')
                )
                    return failed(
                        'Facebook photo is invalid or exceeds its limits',
                        'invalid_input'
                    ).outcome
                body = new FormData()
                body.set(
                    'source',
                    photo.blob,
                    photo.blob.type === 'image/png' ? 'photo.png' : 'photo.jpg'
                )
                body.set('caption', input.text)
                body.set('published', 'true')
                if (photo.accessibilityText !== undefined)
                    body.set('alt_text_custom', photo.accessibilityText)
            } else {
                body = new URLSearchParams({ message: input.text, published: 'true' })
                if (link !== undefined) body.set('link', link)
            }
            const result = await call(
                input.pageToken,
                `${input.pageId}/${input.photo ? 'photos' : 'feed'}`,
                new URLSearchParams(),
                body
            )
            if (!result.ok) return result.outcome
            const value = result.value
            const postId = record(value) ? (input.photo ? value.post_id : value.id) : null
            if (
                !postIdentity(postId, input.pageId) ||
                postId.includes(input.pageToken) ||
                (input.photo &&
                    (!record(value) || !numericId(value.id) || value.id.includes(input.pageToken)))
            )
                return unknownWrite().outcome
            return {
                type: 'published',
                externalId: postId,
                externalUrl: `https://www.facebook.com/${postId}`,
                ...(input.photo && record(value) ? { mediaId: value.id as string } : {}),
            }
        },
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function numericId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9]\d{0,63}$/.test(value)
}
function postIdentity(value: unknown, pageId: string): value is string {
    return (
        numericId(value) ||
        (typeof value === 'string' &&
            value.startsWith(`${pageId}_`) &&
            numericId(value.slice(pageId.length + 1)))
    )
}
function validToken(value: unknown): value is string {
    return typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value)
}
function validCursor(value: unknown, token: string): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 2048 &&
        Array.from(value).every(
            character => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127
        ) &&
        !value.includes(token)
    )
}
export function isFacebookLink(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return false
    try {
        const url = new URL(value)
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    } catch {
        return false
    }
}
function failed(
    message: string,
    code: FacebookFailureCode
): { readonly ok: false; readonly outcome: FacebookFailure } {
    return {
        ok: false,
        outcome: { type: 'permanent_failure', effectOccurred: false, code, errorMessage: message },
    }
}
function retryable(
    message: string,
    code: FacebookFailureCode
): { readonly ok: false; readonly outcome: FacebookFailure } {
    return {
        ok: false,
        outcome: { type: 'retryable_failure', effectOccurred: false, code, errorMessage: message },
    }
}
function unknownWrite(): { readonly ok: false; readonly outcome: FacebookFailure } {
    return {
        ok: false,
        outcome: {
            type: 'ambiguous',
            code: 'unknown_result',
            errorMessage: 'The Facebook publication outcome is unknown; inspect it before retrying',
        },
    }
}
