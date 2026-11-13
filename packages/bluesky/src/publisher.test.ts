import { describe, expect, it } from 'bun:test'

import type { BlobRef } from '@atproto/api'
import { ChannelProfileCompiler, applySourceContentToTarget } from '@postdot/core'

import { blueskyChannelProfile, blueskyVideoChannelProfile } from './channel-profile'
import { blueskyChannelProfileValidationAdapter } from './external'
import type { BlueskyPublisherAgent } from './publisher'
import { createBlueskyPublisher } from './publisher'

function stream(value: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(value)
            controller.close()
        },
    })
}

it('retains strong receipts and both ancestry references for authored threads', async () => {
    // cspell:disable-next-line
    const cid = 'bafyreiecx6dujwoeqpdzl27w67z4h46hyklk3an4i4cvvmioaqb2qbyo5u'
    const did = 'did:plc:owner'
    const root = { uri: `at://${did}/app.bsky.feed.post/root`, cid }
    const parent = { uri: `at://${did}/app.bsky.feed.post/second`, cid }
    const posts: unknown[] = []
    const publisher = createBlueskyPublisher({
        includeCid: true,
        agent: {
            did,
            uploadBlob: async () => {
                throw new Error('Unexpected upload')
            },
            post: async record => {
                posts.push(record)
                return { uri: `at://${did}/app.bsky.feed.post/third`, cid }
            },
        } as BlueskyPublisherAgent,
    })
    expect(
        await publisher.publish({
            text: 'Third https://example.com',
            media: [],
            reply: { root, parent },
        })
    ).toMatchObject({ type: 'published', externalCid: cid })
    expect(posts[0]).toMatchObject({
        reply: { root, parent },
        facets: [
            { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }] },
        ],
    })
    expect(
        (
            await publisher.publish({
                text: 'Wrong author',
                media: [],
                reply: {
                    root,
                    parent: { ...parent, uri: 'at://did:plc:other/app.bsky.feed.post/second' },
                },
            })
        ).type
    ).toBe('permanent_failure')
    expect(posts).toHaveLength(1)
})

function createAgent() {
    const uploads: Uint8Array[] = []
    const posts: unknown[] = []
    const agent = {
        did: 'did:plc:postdot-test',
        async uploadBlob(value: Uint8Array) {
            uploads.push(value)
            return {
                data: {
                    blob: {
                        ref: { $link: `bafk${uploads.length}` },
                        mimeType: 'image/png',
                        size: value.byteLength,
                    },
                },
            }
        },
        async post(record: unknown) {
            posts.push(record)
            return {
                uri: 'at://did:plc:postdot-test/app.bsky.feed.post/3jzfcwijors2a',
                cid: 'bafy-test',
            }
        },
    } as unknown as BlueskyPublisherAgent

    return { agent, uploads, posts }
}

describe('Bluesky publisher', () => {
    it('publishes text and returns a Bluesky URL', async () => {
        const fixture = createAgent()
        const publisher = createBlueskyPublisher({ agent: fixture.agent })

        const result = await publisher.publish({ text: 'Hello Bluesky', media: [] })

        expect(result).toEqual({
            type: 'published',
            externalId: 'at://did:plc:postdot-test/app.bsky.feed.post/3jzfcwijors2a',
            externalUrl: 'https://bsky.app/profile/did:plc:postdot-test/post/3jzfcwijors2a',
        })
        expect(fixture.posts).toEqual([
            expect.objectContaining({ text: 'Hello Bluesky', createdAt: expect.any(String) }),
        ])
    })

    it('uploads images before creating an image post', async () => {
        const fixture = createAgent()
        const publisher = createBlueskyPublisher({ agent: fixture.agent })
        const bytes = new TextEncoder().encode('image')

        const result = await publisher.publish({
            text: 'A post with media',
            media: [
                {
                    contentType: 'image/png',
                    size: bytes.byteLength,
                    stream: stream(bytes),
                    accessibilityText: 'A test image',
                },
            ],
        })

        expect(result.type).toBe('published')
        expect(fixture.uploads).toEqual([bytes])
        expect(fixture.posts[0]).toMatchObject({
            text: 'A post with media',
            embed: {
                $type: 'app.bsky.embed.images',
                images: [{ alt: 'A test image' }],
            },
        })
    })

    it('reuses a durable blob checkpoint without uploading the image again', async () => {
        const fixture = createAgent()
        const publisher = createBlueskyPublisher({ agent: fixture.agent })
        const remoteBlob = {
            ref: { $link: 'bafk-existing' },
            mimeType: 'image/png',
            size: 5,
        } as unknown as BlobRef

        const result = await publisher.publish({
            text: 'Retry the post with its uploaded image',
            media: [
                {
                    contentType: 'image/png',
                    size: remoteBlob.size,
                    remoteBlob,
                    accessibilityText: 'The previously uploaded image',
                },
            ],
        })

        expect(result.type).toBe('published')
        expect(fixture.uploads).toHaveLength(0)
        expect(fixture.posts[0]).toMatchObject({
            embed: {
                images: [{ image: remoteBlob, alt: 'The previously uploaded image' }],
            },
        })
    })

    it('rejects text and media that violate the Bluesky contract before network calls', async () => {
        const fixture = createAgent()
        const publisher = createBlueskyPublisher({ agent: fixture.agent })

        const result = await publisher.publish({
            text: 'x'.repeat(301),
            media: [],
        })

        expect(result.type).toBe('permanent_failure')
        expect(fixture.posts).toHaveLength(0)
        expect(fixture.uploads).toHaveLength(0)
    })
})

it('publishes a processed video with its description and inspected aspect ratio, without uploading again', async () => {
    const fixture = createAgent()
    const blob = {
        ref: { $link: 'bafk-existing' },
        mimeType: 'video/mp4',
        size: 100,
    } as unknown as BlobRef
    const publisher = createBlueskyPublisher({ agent: fixture.agent })
    expect(
        (
            await publisher.publish({
                text: 'Native video',
                media: [],
                video: {
                    blob,
                    width: 320,
                    height: 180,
                    accessibilityText: 'A moving scene',
                },
            })
        ).type
    ).toBe('published')
    expect(fixture.uploads).toHaveLength(0)
    expect(fixture.posts[0]).toMatchObject({
        embed: {
            $type: 'app.bsky.embed.video',
            video: blob,
            alt: 'A moving scene',
            aspectRatio: { width: 320, height: 180 },
        },
    })
    expect(
        (
            await publisher.publish({
                text: 'Invalid mixed media',
                media: [{ contentType: 'image/png', size: 1, accessibilityText: 'Image' }],
                video: {
                    blob,
                    width: 320,
                    height: 180,
                    accessibilityText: 'Video',
                },
            })
        ).type
    ).toBe('permanent_failure')
    expect(fixture.posts).toHaveLength(1)
})

it('publishes retained website metadata and a thumbnail while annotating UTF-8 links', async () => {
    const item = createAgent()
    const external = {
        uri: 'https://example.com/article',
        title: 'Article title',
        description: 'Article description',
    }
    const bytes = new Uint8Array([1, 2, 3])
    const publisher = createBlueskyPublisher({ agent: item.agent })
    expect(
        (
            await publisher.publish({
                text: '👋 https://example.com/article',
                external,
                media: [
                    {
                        contentType: 'image/png',
                        size: 3,
                        accessibilityText: 'Article cover',
                        stream: stream(bytes),
                    },
                ],
            })
        ).type
    ).toBe('published')
    expect(item.posts[0]).toMatchObject({
        embed: {
            $type: 'app.bsky.embed.external',
            external: { ...external, thumb: { mimeType: 'image/png' } },
        },
        facets: [
            {
                index: { byteStart: 5, byteEnd: 32 },
                features: [{ $type: 'app.bsky.richtext.facet#link', uri: external.uri }],
            },
        ],
    })
    expect(item.uploads).toHaveLength(1)
    for (const uri of ['javascript:alert(1)', 'https://user:secret@example.com'])
        expect(
            (await publisher.publish({ text: 'Link', media: [], external: { ...external, uri } }))
                .type
        ).toBe('permanent_failure')
    expect(
        (
            await publisher.publish({
                text: 'Link',
                external,
                media: [{ contentType: 'image/png', size: 1_000_001, accessibilityText: 'Cover' }],
            })
        ).type
    ).toBe('permanent_failure')
    expect(item.posts).toHaveLength(1)
})

it('validates card metadata in the new profile and preserves it across source edits', () => {
    const external = {
        uri: 'https://example.com/article',
        title: 'Chosen title',
        description: 'Chosen description',
    }
    const content = { text: 'Initial copy', media: [], external }
    const compiler = new ChannelProfileCompiler({
        validationAdapters: [blueskyChannelProfileValidationAdapter],
    })
    const current = compiler.compile(blueskyChannelProfile)
    const historical = compiler.compile(blueskyVideoChannelProfile)
    if (!current.ok || !historical.ok) throw new Error('Bluesky profiles did not compile')
    expect(current.value.validate(content).ok).toBe(true)
    expect(historical.value.validate(content).ok).toBe(false)
    expect(
        current.value.validate({
            ...content,
            external: { ...external, uri: 'https://user:secret@example.com' },
        }).ok
    ).toBe(false)
    expect(
        current.value.validate({
            ...content,
            media: [
                { assetId: 'one', accessibilityText: 'One' },
                { assetId: 'two', accessibilityText: 'Two' },
            ],
        }).ok
    ).toBe(false)
    expect(
        applySourceContentToTarget(
            { body: { format: 'plain_text', text: 'Updated copy' }, media: [] },
            blueskyChannelProfile,
            content
        )
    ).toEqual({ ...content, text: 'Updated copy' })
})
