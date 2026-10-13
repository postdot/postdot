import { describe, expect, it } from 'bun:test'

import type { BlobRef } from '@atproto/api'

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

function createAgent() {
    const uploads: Uint8Array[] = []
    const posts: unknown[] = []
    const agent = {
        did: 'did:plc:postbot-test',
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
                uri: 'at://did:plc:postbot-test/app.bsky.feed.post/3jzfcwijors2a',
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
            externalId: 'at://did:plc:postbot-test/app.bsky.feed.post/3jzfcwijors2a',
            externalUrl: 'https://bsky.app/profile/did:plc:postbot-test/post/3jzfcwijors2a',
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
