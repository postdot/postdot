import { describe, expect, it } from 'bun:test'

import {
    BLUESKY_ANALYTICS_MAX_CONTENTS,
    BLUESKY_ANALYTICS_PROVENANCE,
    BLUESKY_PROVIDER,
    createBlueskyAnalyticsReader,
    collectBlueskyAnalytics,
} from './index'

const did = 'did:plc:herald-test'
const handle = 'herald.test'
const postUri = 'at://' + did + '/app.bsky.feed.post/3kpost'
const postCid = 'bafyreibsky-cid'
const profileIndexedAt = '2026-09-08T10:00:00.000Z'
const postIndexedAt = '2026-09-08T10:01:00.000Z'

describe('Bluesky provider analytics', () => {
    it('reads a profile and known posts without credentials and preserves identities', async () => {
        const calls: { readonly url: string; readonly authorization: string | null }[] = []
        const reader = createBlueskyAnalyticsReader({
            baseUrl: 'https://public.example.test',
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
                })
                if (new URL(request.url).pathname === '/xrpc/app.bsky.actor.getProfile') {
                    return Response.json({
                        did,
                        handle,
                        indexedAt: profileIndexedAt,
                        followersCount: 0,
                        followsCount: 12,
                        postsCount: 4,
                    })
                }
                return Response.json({
                    posts: [
                        {
                            uri: postUri,
                            cid: postCid,
                            author: { did, handle },
                            record: { text: 'fixture' },
                            indexedAt: postIndexedAt,
                            likeCount: 0,
                            replyCount: 2,
                            repostCount: 3,
                            quoteCount: 1,
                        },
                    ],
                })
            },
        })

        const profile = await reader.getProfile(did)
        const posts = await reader.getPosts([postUri])

        expect(profile).toEqual({
            kind: 'available',
            did,
            handle,
            observedAt: Date.parse(profileIndexedAt),
            counters: {
                followersCount: 0,
                followsCount: 12,
                postsCount: 4,
            },
        })
        expect(posts).toEqual([
            {
                kind: 'available',
                uri: postUri,
                cid: postCid,
                authorHandle: handle,
                observedAt: Date.parse(postIndexedAt),
                counters: {
                    likeCount: 0,
                    replyCount: 2,
                    repostCount: 3,
                    quoteCount: 1,
                    bookmarkCount: undefined,
                },
            },
        ])
        expect(calls).toEqual([
            {
                url:
                    'https://public.example.test/xrpc/app.bsky.actor.getProfile?actor=' +
                    encodeURIComponent(did),
                authorization: null,
            },
            {
                url:
                    'https://public.example.test/xrpc/app.bsky.feed.getPosts?uris=' +
                    encodeURIComponent(postUri),
                authorization: null,
            },
        ])
    })

    it('maps missing counters separately from a real zero and retains a cumulative snapshot', async () => {
        const result = await collectBlueskyAnalytics({
            projectId: 'project-1',
            account: {
                providerSubjectId: did,
                providerSubjectLabel: handle,
                heraldEntityId: 'channel-1',
            },
            contents: [
                { providerSubjectId: postUri, heraldEntityId: 'publication-1' },
                { providerSubjectId: postUri, heraldEntityId: 'publication-2' },
            ],
            fetchedAt: 1_800_000_000_000,
            reader: {
                getProfile: async () => ({
                    kind: 'available',
                    did,
                    handle,
                    observedAt: Date.parse(profileIndexedAt),
                    counters: { followersCount: 0, followsCount: 7 },
                }),
                getPosts: async () => [
                    {
                        kind: 'available',
                        uri: postUri,
                        cid: postCid,
                        authorHandle: handle,
                        observedAt: Date.parse(postIndexedAt),
                        counters: {
                            likeCount: 0,
                            replyCount: 1,
                            repostCount: 2,
                            quoteCount: 3,
                        },
                    },
                ],
            },
        })

        expect(result.provider).toBe(BLUESKY_PROVIDER)
        expect(result.observations).toHaveLength(8)
        expect(result.coverage).toMatchObject({
            state: 'partial',
            complete: false,
            requestedAccountMetricCount: 3,
            measuredAccountMetricCount: 2,
            requestedContentCount: 1,
            returnedContentCount: 1,
            requestedContentMetricCount: 5,
            measuredContentMetricCount: 4,
            notReportedMetricCount: 2,
            unavailableMetricCount: 0,
        })
        expect(result.observations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    subjectType: 'account',
                    providerSubjectId: did,
                    metricName: 'followersCount',
                    value: 0,
                    availability: 'measured',
                    aggregation: 'cumulative_snapshot',
                    provenance: BLUESKY_ANALYTICS_PROVENANCE,
                }),
                expect.objectContaining({
                    subjectType: 'account',
                    metricName: 'postsCount',
                    value: null,
                    availability: 'not_reported',
                }),
                expect.objectContaining({
                    subjectType: 'content',
                    providerSubjectId: postUri,
                    providerContentRevisionId: postCid,
                    heraldEntityId: 'publication-1',
                    metricName: 'bookmarkCount',
                    value: null,
                    availability: 'not_reported',
                }),
            ])
        )
        expect(
            result.observations.filter(observation => observation.subjectType === 'content')
        ).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ heraldEntityId: 'publication-2' })])
        )
    })

    it('classifies unavailable, malformed, and network responses without retaining payloads', async () => {
        for (const [status, availability] of [
            [404, 'not_found'],
            [410, 'disabled'],
            [429, 'rate_limited'],
            [503, 'temporarily_unavailable'],
            [403, 'not_authorized'],
        ] as const) {
            const reader = createBlueskyAnalyticsReader({
                baseUrl: 'https://public.example.test',
                fetcher: async () => Response.json({ error: 'provider detail' }, { status }),
            })
            await expect(reader.getProfile(did)).resolves.toEqual({
                kind: 'unavailable',
                availability,
            })
        }

        const malformedReader = createBlueskyAnalyticsReader({
            baseUrl: 'https://public.example.test',
            fetcher: async () => Response.json({ posts: 'not-an-array' }),
        })
        await expect(malformedReader.getPosts([postUri])).resolves.toEqual([
            { kind: 'unavailable', uri: postUri, availability: 'invalid_response' },
        ])

        const missingUri = 'at://' + did + '/app.bsky.feed.post/missing'
        const blockedAndMissingReader = createBlueskyAnalyticsReader({
            baseUrl: 'https://public.example.test',
            fetcher: async () =>
                Response.json({
                    posts: [
                        { uri: postUri, blocked: true },
                        {
                            uri: missingUri,
                            notFound: true,
                        },
                    ],
                }),
        })
        await expect(blockedAndMissingReader.getPosts([postUri, missingUri])).resolves.toEqual([
            { kind: 'unavailable', uri: postUri, availability: 'blocked' },
            {
                kind: 'unavailable',
                uri: missingUri,
                availability: 'not_found',
            },
        ])

        const networkReader = createBlueskyAnalyticsReader({
            fetcher: async () => {
                throw new Error('network details must not escape')
            },
        })
        await expect(networkReader.getProfile(did)).resolves.toEqual({
            kind: 'unavailable',
            availability: 'temporarily_unavailable',
        })
    })

    it('classifies provider capability and partial-response signals explicitly', async () => {
        const unsupportedReader = createBlueskyAnalyticsReader({
            fetcher: async () => Response.json({ error: 'UnsupportedMetric' }),
        })
        await expect(unsupportedReader.getProfile(did)).resolves.toEqual({
            kind: 'unavailable',
            availability: 'not_supported',
        })

        const partialReader = createBlueskyAnalyticsReader({
            fetcher: async () => Response.json({ error: 'incomplete response' }),
        })
        await expect(partialReader.getProfile(did)).resolves.toEqual({
            kind: 'unavailable',
            availability: 'partial_response',
        })

        const omittedPostReader = createBlueskyAnalyticsReader({
            fetcher: async () => Response.json({ posts: [] }),
        })
        await expect(omittedPostReader.getPosts([postUri])).resolves.toEqual([
            { kind: 'unavailable', uri: postUri, availability: 'partial_response' },
        ])

        const malformedPostReader = createBlueskyAnalyticsReader({
            fetcher: async () =>
                Response.json({
                    posts: [
                        {
                            uri: postUri,
                            cid: postCid,
                            author: { did, handle },
                            record: { text: 'fixture' },
                            likeCount: 1,
                            replyCount: 1,
                            repostCount: 1,
                            quoteCount: 1,
                            bookmarkCount: 1,
                        },
                    ],
                }),
        })
        await expect(malformedPostReader.getPosts([postUri])).resolves.toEqual([
            { kind: 'unavailable', uri: postUri, availability: 'invalid_response' },
        ])
    })

    it('passes an abort signal, times out, and bounds known-post hydration to one page', async () => {
        let aborted = false
        const timeoutReader = createBlueskyAnalyticsReader({
            timeoutMs: 5,
            fetcher: async (_input, init) =>
                new Promise<Response>(resolve => {
                    init?.signal?.addEventListener('abort', () => {
                        aborted = true
                        resolve(Response.json({ error: 'aborted' }, { status: 503 }))
                    })
                }),
        })
        await expect(timeoutReader.getProfile(did)).resolves.toEqual({
            kind: 'unavailable',
            availability: 'temporarily_unavailable',
        })
        expect(aborted).toBe(true)

        let bodyAborted = false
        const bodyTimeoutReader = createBlueskyAnalyticsReader({
            timeoutMs: 5,
            fetcher: async (_input, init) => {
                init?.signal?.addEventListener('abort', () => {
                    bodyAborted = true
                })
                return {
                    ok: true,
                    status: 200,
                    json: () => new Promise<unknown>(() => undefined),
                } as Response
            },
        })
        await expect(bodyTimeoutReader.getProfile(did)).resolves.toEqual({
            kind: 'unavailable',
            availability: 'temporarily_unavailable',
        })
        expect(bodyAborted).toBe(true)

        const uris = Array.from(
            { length: BLUESKY_ANALYTICS_MAX_CONTENTS },
            (_, index) => 'at://' + did + '/app.bsky.feed.post/post-' + index
        )
        const requests: string[] = []
        const boundedReader = createBlueskyAnalyticsReader({
            fetcher: async input => {
                requests.push(input instanceof URL ? input.href : input.toString())
                return Response.json({ posts: [] })
            },
        })
        await expect(boundedReader.getPosts(uris)).resolves.toHaveLength(
            BLUESKY_ANALYTICS_MAX_CONTENTS
        )
        expect(new URL(requests[0] ?? '').searchParams.getAll('uris')).toHaveLength(
            BLUESKY_ANALYTICS_MAX_CONTENTS
        )
        await expect(
            boundedReader.getPosts([...uris, 'at://' + did + '/app.bsky.feed.post/one-too-many'])
        ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('does not call the provider for invalid known post identifiers', async () => {
        let calls = 0
        const reader = createBlueskyAnalyticsReader({
            fetcher: async () => {
                calls += 1
                return Response.json({ posts: [] })
            },
        })

        await expect(reader.getPosts(['not-an-at-uri'])).resolves.toEqual([
            {
                kind: 'unavailable',
                uri: 'not-an-at-uri',
                availability: 'invalid_response',
            },
        ])
        expect(calls).toBe(0)
    })
})
