import { expect, test } from 'bun:test'

import type { BlueskyThreadPost } from '@postdot/bluesky'

import { presentPublicationComments } from './publication-comments-view'

test('presents replies without repeating the source or inventing unavailable comment content', () => {
    const root: BlueskyThreadPost = {
        kind: 'post',
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        parentUri: null,
        authorDid: 'did:plc:author',
        authorHandle: 'author.test',
        text: 'Original publication',
        createdAt: 1000,
        externalUrl: null,
        replies: [
            {
                kind: 'post',
                uri: 'at://did:plc:reply/app.bsky.feed.post/reply',
                parentUri: null,
                authorDid: 'did:plc:reply',
                authorHandle: 'reply.test',
                text: '<script>Text stays plain</script>',
                createdAt: 2000,
                externalUrl: 'https://bsky.app/profile/reply.test/post/reply',
                replies: [{ kind: 'unavailable', uri: null, availability: 'blocked' }],
            },
        ],
    }
    const result = presentPublicationComments(
        { kind: 'available', requestedUri: root.uri, root, truncated: true },
        3000
    )
    expect(result.comments).toHaveLength(2)
    expect(result.comments[0]).toMatchObject({
        depth: 0,
        parentUri: root.uri,
        text: '<script>Text stays plain</script>',
    })
    expect(result.comments[1]).toMatchObject({
        depth: 1,
        parentUri: root.replies[0]?.uri,
        availability: 'blocked',
        authorHandle: null,
        text: null,
    })
    expect(result.truncated).toBe(true)
    expect(JSON.stringify(result.comments)).not.toContain('Original publication')
})

test('preserves unavailable roots rather than treating them as successfully empty threads', () => {
    expect(
        presentPublicationComments(
            {
                kind: 'unavailable',
                requestedUri: 'at://did:plc:author/app.bsky.feed.post/root',
                availability: 'not_found',
            },
            3000
        )
    ).toMatchObject({ availability: 'not_found', comments: [], fetchedAt: 3000 })
})
