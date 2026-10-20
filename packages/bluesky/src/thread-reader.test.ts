import { describe, expect, it } from 'bun:test'

import {
    BLUESKY_THREAD_MAX_NODES,
    createBlueskyThreadReader,
    type BlueskyThreadNode,
} from './index'

const rootUri = 'at://did:plc:thread-root/app.bsky.feed.post/root'
const replyUri = 'at://did:plc:reply-author/app.bsky.feed.post/reply'
const nestedReplyUri = 'at://did:plc:thread-root/app.bsky.feed.post/nested'
const blockedUri = 'at://did:plc:blocked-author/app.bsky.feed.post/blocked'
const rootDid = 'did:plc:thread-root'
const rootHandle = 'thread-root.test'
const replyDid = 'did:plc:reply-author'
const replyHandle = 'reply-author.test'
const rootCreatedAt = '2026-10-20T08:00:00.000Z'
const replyCreatedAt = '2026-10-20T08:01:00.000Z'
const nestedCreatedAt = '2026-10-20T08:02:00.000Z'
// cspell:disable-next-line
const cid = 'bafyreibluesky-thread-cid'

function postView(input: {
    readonly uri: string
    readonly did: string
    readonly handle: string
    readonly text: string
    readonly createdAt: string
    readonly replyTo?: {
        readonly root: string
        readonly parent: string
    }
    readonly embed?: unknown
}): Record<string, unknown> {
    return {
        uri: input.uri,
        cid,
        author: {
            did: input.did,
            handle: input.handle,
            displayName: 'Profile extras must not escape',
            avatar: 'https://cdn.example.test/avatar.jpg',
        },
        record: {
            $type: 'app.bsky.feed.post',
            text: input.text,
            createdAt: input.createdAt,
            ...(input.replyTo === undefined
                ? {}
                : {
                      reply: {
                          root: { uri: input.replyTo.root, cid },
                          parent: { uri: input.replyTo.parent, cid },
                      },
                  }),
            ...(input.embed === undefined ? {} : { embed: input.embed }),
        },
        indexedAt: input.createdAt,
        viewer: { replyDisabled: true },
    }
}

function threadView(
    post: Record<string, unknown>,
    replies?: readonly unknown[]
): Record<string, unknown> {
    return {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post,
        ...(replies === undefined ? {} : { replies }),
    }
}

function countNodes(node: BlueskyThreadNode): number {
    if (node.kind !== 'post') return 1
    return 1 + node.replies.reduce((total, reply) => total + countNodes(reply), 0)
}

describe('Bluesky public thread reader', () => {
    it('reads an anonymous bounded thread with normalized identities, parent links, and external links', async () => {
        const calls: {
            readonly url: string
            readonly authorization: string | null
            readonly credentials: RequestInit['credentials']
        }[] = []
        const reader = createBlueskyThreadReader({
            fetcher: async (input, init) => {
                const request =
                    typeof input === 'string'
                        ? new Request(input, init)
                        : input instanceof URL
                          ? new Request(input.href, init)
                          : new Request(input, init)
                calls.push({
                    url: request.url,
                    authorization: request.headers.get('authorization'),
                    credentials: init?.credentials,
                })
                return Response.json({
                    thread: threadView(
                        postView({
                            uri: rootUri,
                            did: rootDid,
                            handle: rootHandle,
                            text: 'Root post',
                            createdAt: rootCreatedAt,
                            embed: {
                                $type: 'app.bsky.embed.external',
                                external: {
                                    uri: 'https://example.test/story',
                                    title: 'Story',
                                    description: 'Story description',
                                },
                            },
                        }),
                        [
                            threadView(
                                postView({
                                    uri: replyUri,
                                    did: replyDid,
                                    handle: replyHandle,
                                    text: 'First reply',
                                    createdAt: replyCreatedAt,
                                    replyTo: { root: rootUri, parent: rootUri },
                                    embed: {
                                        $type: 'app.bsky.embed.external',
                                        external: {
                                            uri: 'javascript:alert(1)',
                                            title: 'Not a link',
                                            description: 'Rejected scheme',
                                        },
                                    },
                                }),
                                [
                                    threadView(
                                        postView({
                                            uri: nestedReplyUri,
                                            did: rootDid,
                                            handle: rootHandle,
                                            text: 'Nested reply',
                                            createdAt: nestedCreatedAt,
                                            replyTo: { root: rootUri, parent: replyUri },
                                        })
                                    ),
                                ]
                            ),
                            {
                                $type: 'app.bsky.feed.defs#blockedPost',
                                uri: blockedUri,
                                blocked: true,
                                author: { did: 'did:plc:blocked-author' },
                            },
                        ]
                    ),
                })
            },
        })

        const result = await reader.getPostThread(rootUri)

        expect(calls).toEqual([
            {
                url:
                    'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=' +
                    encodeURIComponent(rootUri) +
                    '&depth=6&parentHeight=0',
                authorization: null,
                credentials: 'omit',
            },
        ])
        expect(result).toEqual({
            kind: 'available',
            requestedUri: rootUri,
            truncated: false,
            root: {
                kind: 'post',
                uri: rootUri,
                parentUri: null,
                authorDid: rootDid,
                authorHandle: rootHandle,
                text: 'Root post',
                createdAt: Date.parse(rootCreatedAt),
                externalUrl: 'https://bsky.app/profile/did%3Aplc%3Athread-root/post/root',
                replies: [
                    {
                        kind: 'post',
                        uri: replyUri,
                        parentUri: rootUri,
                        authorDid: replyDid,
                        authorHandle: replyHandle,
                        text: 'First reply',
                        createdAt: Date.parse(replyCreatedAt),
                        externalUrl: 'https://bsky.app/profile/did%3Aplc%3Areply-author/post/reply',
                        replies: [
                            {
                                kind: 'post',
                                uri: nestedReplyUri,
                                parentUri: replyUri,
                                authorDid: rootDid,
                                authorHandle: rootHandle,
                                text: 'Nested reply',
                                createdAt: Date.parse(nestedCreatedAt),
                                externalUrl:
                                    'https://bsky.app/profile/did%3Aplc%3Athread-root/post/nested',
                                replies: [],
                            },
                        ],
                    },
                    {
                        kind: 'unavailable',
                        uri: blockedUri,
                        availability: 'blocked',
                    },
                ],
            },
        })
    })

    it('reports blocked, missing, mismatched, malformed, and invalid roots without an empty success', async () => {
        for (const [thread, availability] of [
            [
                {
                    $type: 'app.bsky.feed.defs#blockedPost',
                    uri: rootUri,
                    blocked: true,
                    author: { did: rootDid },
                },
                'blocked',
            ],
            [
                {
                    $type: 'app.bsky.feed.defs#notFoundPost',
                    uri: rootUri,
                    notFound: true,
                },
                'not_found',
            ],
        ] as const) {
            const reader = createBlueskyThreadReader({
                fetcher: async () => Response.json({ thread }),
            })
            await expect(reader.getPostThread(rootUri)).resolves.toEqual({
                kind: 'unavailable',
                requestedUri: rootUri,
                availability,
            })
        }

        for (const thread of [
            threadView(
                postView({
                    uri: 'at://did:plc:other/app.bsky.feed.post/other',
                    did: rootDid,
                    handle: rootHandle,
                    text: 'Wrong root',
                    createdAt: rootCreatedAt,
                })
            ),
            {
                $type: 'app.bsky.feed.defs#blockedPost',
                uri: 'at://did:plc:other/app.bsky.feed.post/other',
                blocked: true,
                author: { did: rootDid },
            },
            {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: { uri: rootUri },
            },
            {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: postView({
                    uri: rootUri,
                    did: rootDid,
                    handle: rootHandle,
                    text: 'Root post',
                    createdAt: 'not-a-timestamp',
                }),
            },
        ]) {
            const reader = createBlueskyThreadReader({
                fetcher: async () => Response.json({ thread }),
            })
            await expect(reader.getPostThread(rootUri)).resolves.toEqual({
                kind: 'unavailable',
                requestedUri: rootUri,
                availability: 'invalid_response',
            })
        }

        let calls = 0
        const invalidInputReader = createBlueskyThreadReader({
            fetcher: async () => {
                calls += 1
                return Response.json({})
            },
        })
        await expect(invalidInputReader.getPostThread('not-a-post-uri')).resolves.toEqual({
            kind: 'unavailable',
            requestedUri: 'not-a-post-uri',
            availability: 'invalid_response',
        })
        expect(calls).toBe(0)
    })

    it('bounds traversal by depth and node count and keeps untrusted nodes explicit', async () => {
        const deepThread = threadView(
            postView({
                uri: rootUri,
                did: rootDid,
                handle: rootHandle,
                text: 'Root post',
                createdAt: rootCreatedAt,
            }),
            [
                threadView(
                    postView({
                        uri: replyUri,
                        did: replyDid,
                        handle: replyHandle,
                        text: 'First reply',
                        createdAt: replyCreatedAt,
                        replyTo: { root: rootUri, parent: rootUri },
                    }),
                    [
                        threadView(
                            postView({
                                uri: nestedReplyUri,
                                did: rootDid,
                                handle: rootHandle,
                                text: 'Nested reply',
                                createdAt: nestedCreatedAt,
                                replyTo: { root: rootUri, parent: replyUri },
                            })
                        ),
                    ]
                ),
            ]
        )
        const depthReader = createBlueskyThreadReader({
            fetcher: async () => Response.json({ thread: deepThread }),
        })
        const depthResult = await depthReader.getPostThread(rootUri, { depth: 1 })
        if (depthResult.kind !== 'available') throw new Error('expected an available thread')
        expect(depthResult.truncated).toBe(true)
        expect(depthResult.root.replies).toHaveLength(1)
        expect(depthResult.root.replies[0]).toMatchObject({
            kind: 'post',
            uri: replyUri,
            replies: [],
        })

        const wideThread = threadView(
            postView({
                uri: rootUri,
                did: rootDid,
                handle: rootHandle,
                text: 'Root post',
                createdAt: rootCreatedAt,
            }),
            Array.from({ length: BLUESKY_THREAD_MAX_NODES }, (_, index) => {
                const uri = 'at://did:plc:reply-author/app.bsky.feed.post/reply-' + index
                return threadView(
                    postView({
                        uri,
                        did: replyDid,
                        handle: replyHandle,
                        text: 'Reply ' + index,
                        createdAt: replyCreatedAt,
                        replyTo: { root: rootUri, parent: rootUri },
                    })
                )
            })
        )
        const nodeReader = createBlueskyThreadReader({
            fetcher: async () => Response.json({ thread: wideThread }),
        })
        const nodeResult = await nodeReader.getPostThread(rootUri)
        if (nodeResult.kind !== 'available') throw new Error('expected an available thread')
        expect(nodeResult.truncated).toBe(true)
        expect(countNodes(nodeResult.root)).toBe(BLUESKY_THREAD_MAX_NODES)

        const untrustedThread = threadView(
            postView({
                uri: rootUri,
                did: rootDid,
                handle: rootHandle,
                text: 'Root post',
                createdAt: rootCreatedAt,
            }),
            [
                {
                    $type: 'app.bsky.feed.defs#futurePost',
                    post: postView({
                        uri: replyUri,
                        did: replyDid,
                        handle: replyHandle,
                        text: 'Future reply',
                        createdAt: replyCreatedAt,
                    }),
                },
                {},
            ]
        )
        const untrustedReader = createBlueskyThreadReader({
            fetcher: async () => Response.json({ thread: untrustedThread }),
        })
        const untrustedResult = await untrustedReader.getPostThread(rootUri)
        if (untrustedResult.kind !== 'available') {
            throw new Error('expected an available thread')
        }
        expect(untrustedResult.truncated).toBe(false)
        expect(untrustedResult.root.replies).toEqual([
            { kind: 'unavailable', uri: replyUri, availability: 'invalid_response' },
            { kind: 'unavailable', uri: null, availability: 'invalid_response' },
        ])

        let invalidDepthCalls = 0
        const invalidDepthReader = createBlueskyThreadReader({
            fetcher: async () => {
                invalidDepthCalls += 1
                return Response.json({ thread: deepThread })
            },
        })
        await expect(invalidDepthReader.getPostThread(rootUri, { depth: 7 })).rejects.toMatchObject(
            { code: 'invalid_input' }
        )
        expect(invalidDepthCalls).toBe(0)
    })

    it('keeps a finite timeout and distinguishes timeout, network, and HTTP failures', async () => {
        let aborted = false
        const timeoutReader = createBlueskyThreadReader({
            timeoutMs: 5,
            fetcher: async (_input, init) =>
                new Promise<Response>(() => {
                    init?.signal?.addEventListener('abort', () => {
                        aborted = true
                    })
                }),
        })
        await expect(timeoutReader.getPostThread(rootUri)).resolves.toEqual({
            kind: 'unavailable',
            requestedUri: rootUri,
            availability: 'temporarily_unavailable',
        })
        expect(aborted).toBe(true)

        for (const [status, availability] of [
            [206, 'partial_response'],
            [400, 'invalid_response'],
            [403, 'not_authorized'],
            [404, 'not_found'],
            [429, 'rate_limited'],
            [503, 'temporarily_unavailable'],
        ] as const) {
            const reader = createBlueskyThreadReader({
                fetcher: async () => Response.json({ error: 'provider detail' }, { status }),
            })
            await expect(reader.getPostThread(rootUri)).resolves.toEqual({
                kind: 'unavailable',
                requestedUri: rootUri,
                availability,
            })
        }

        const networkReader = createBlueskyThreadReader({
            fetcher: async () => {
                throw new Error('network details must not escape')
            },
        })
        await expect(networkReader.getPostThread(rootUri)).resolves.toEqual({
            kind: 'unavailable',
            requestedUri: rootUri,
            availability: 'temporarily_unavailable',
        })
    })
})
