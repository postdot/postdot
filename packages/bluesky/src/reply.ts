import {
    AppBskyFeedPost,
    ComAtprotoRepoStrongRef,
    type ComAtprotoRepoCreateRecord,
} from '@atproto/api'
import { TID } from '@atproto/common-web'

import { BLUESKY_PUBLIC_API_ORIGIN } from './analytics'
import {
    BLUESKY_MAX_GRAPHEMES,
    BLUESKY_MAX_TEXT_LENGTH,
    type BlueskyFetcher,
    type BlueskyPublishOutcome,
} from './contract'

export interface BlueskyReplyReference {
    readonly uri: string
    readonly cid: string
}
export interface BlueskyReplyContext {
    readonly root: BlueskyReplyReference
    readonly parent: BlueskyReplyReference
}
export interface BlueskyReplyInput extends BlueskyReplyContext {
    readonly text: string
    readonly recordKey: string
    readonly createdAt: number
}
export interface BlueskyReplyAgent {
    readonly did: string | undefined
    createRecord(
        input: ComAtprotoRepoCreateRecord.InputSchema,
        options?: ComAtprotoRepoCreateRecord.CallOptions
    ): Promise<{ data: { uri: string; cid: string } }>
}
export function blueskyReplyTextValid(text: string): boolean {
    return (
        text.trim().length > 0 &&
        text.length <= BLUESKY_MAX_TEXT_LENGTH &&
        [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length <=
            BLUESKY_MAX_GRAPHEMES
    )
}
export function blueskyPostDid(uri: string): string | null {
    return /^at:\/\/(did:[^/\s]+)\/app\.bsky\.feed\.post\/[^/\s]+$/.exec(uri)?.[1] ?? null
}
function validReference(value: unknown): value is BlueskyReplyReference & Record<string, unknown> {
    return (
        record(value) &&
        typeof value.uri === 'string' &&
        blueskyPostDid(value.uri) !== null &&
        ComAtprotoRepoStrongRef.validateMain(value).success
    )
}
/** Resolve live strong references from the fixed public AppView, without sending credentials. */
export async function resolveBlueskyReplyContext(input: {
    rootUri: string
    parentUri: string
    fetcher?: BlueskyFetcher
    signal?: AbortSignal
}): Promise<BlueskyReplyContext | null> {
    if (blueskyPostDid(input.rootUri) === null || blueskyPostDid(input.parentUri) === null)
        return null
    const url = new URL('/xrpc/app.bsky.feed.getPosts', BLUESKY_PUBLIC_API_ORIGIN)
    for (const uri of new Set([input.rootUri, input.parentUri]))
        url.searchParams.append('uris', uri)
    const response = await (input.fetcher ?? fetch)(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: input.signal ?? AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!record(body) || !Array.isArray(body.posts)) return null
    const root = body.posts.find(value => record(value) && value.uri === input.rootUri)
    const parent = body.posts.find(value => record(value) && value.uri === input.parentUri)
    if (!validReference(root) || !validReference(parent) || !record(parent.record)) return null
    if (input.rootUri === input.parentUri)
        return {
            root: { uri: root.uri, cid: root.cid },
            parent: { uri: parent.uri, cid: parent.cid },
        }
    const reply = parent.record.reply
    if (!record(reply) || !validReference(reply.root) || reply.root.uri !== input.rootUri)
        return null
    return {
        root: { uri: reply.root.uri, cid: reply.root.cid },
        parent: { uri: parent.uri, cid: parent.cid },
    }
}

/** The caller persists the record key and fences the effect before invoking this primitive. */
export function createBlueskyReplyPublisher(agent: BlueskyReplyAgent) {
    return {
        async publish(
            input: BlueskyReplyInput,
            signal?: AbortSignal
        ): Promise<BlueskyPublishOutcome> {
            if (
                !blueskyReplyTextValid(input.text) ||
                !agent.did ||
                !/^did:[^/\s]+$/.test(agent.did) ||
                !/^[a-zA-Z0-9._~:-]{1,512}$/.test(input.recordKey) ||
                ['.', '..'].includes(input.recordKey) ||
                !validReference(input.root) ||
                !validReference(input.parent) ||
                !Number.isSafeInteger(input.createdAt) ||
                input.createdAt < 0 ||
                input.createdAt > 8_640_000_000_000_000
            )
                return invalid('Invalid Bluesky reply')
            const record: AppBskyFeedPost.Record = {
                $type: 'app.bsky.feed.post',
                text: input.text,
                createdAt: new Date(input.createdAt).toISOString(),
                reply: { root: { ...input.root }, parent: { ...input.parent } },
            }
            if (!AppBskyFeedPost.validateRecord(record).success)
                return invalid('Invalid Bluesky reply record')
            if (signal?.aborted) return invalid('The reply was cancelled before dispatch')
            const expectedUri = `at://${agent.did}/app.bsky.feed.post/${input.recordKey}`
            try {
                const response = await agent.createRecord(
                    {
                        repo: agent.did,
                        collection: 'app.bsky.feed.post',
                        rkey: input.recordKey,
                        record,
                        validate: true,
                    },
                    { signal }
                )
                if (response.data.uri !== expectedUri || !validReference(response.data))
                    return {
                        type: 'ambiguous',
                        code: 'unexpected_response',
                        errorMessage: 'Bluesky returned an unexpected reply identity',
                    }
                return {
                    type: 'published',
                    externalId: expectedUri,
                    externalUrl: `https://bsky.app/profile/${encodeURIComponent(agent.did)}/post/${encodeURIComponent(input.recordKey)}`,
                }
            } catch (error) {
                const status = recordErrorStatus(error)
                if (status === 429)
                    return {
                        type: 'retryable_failure',
                        effectOccurred: false,
                        code: 'rate_limited',
                        errorMessage: 'Bluesky rate limited the reply',
                    }
                if (status === 401 || status === 403)
                    return {
                        type: 'permanent_failure',
                        effectOccurred: false,
                        code: status === 401 ? 'authentication_required' : 'forbidden',
                        errorMessage: 'Bluesky rejected the reply permission',
                    }
                // A key collision can refer to an earlier accepted request. Do not claim no effect.
                return {
                    type: 'ambiguous',
                    code: 'provider_failure',
                    errorMessage: 'Bluesky did not confirm whether the reply was sent',
                }
            }
        },
    }
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function recordErrorStatus(error: unknown): number | null {
    return record(error) && typeof error.status === 'number' ? error.status : null
}
function invalid(errorMessage: string): BlueskyPublishOutcome {
    return { type: 'permanent_failure', effectOccurred: false, code: 'invalid_input', errorMessage }
}

export function createBlueskyReplyRecordKey(): string {
    return TID.nextStr()
}
