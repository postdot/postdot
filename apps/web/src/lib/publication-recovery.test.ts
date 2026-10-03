import { describe, expect, test } from 'bun:test'

import { hasRecoverablePublicationContent } from './publication-recovery'

function target(content = '') {
    return {
        channelId: 'channel-1',
        content,
        deliveryMode: 'manual' as const,
        id: 'target-1',
        scheduledAt: '',
    }
}

describe('new publication recovery', () => {
    test('does not treat whitespace or an untouched target as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: ' ',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(false)
    })

    test('recognizes a title-only article as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postTitle: 'My article',
                postContent: '',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(true)
    })

    test('recognizes shared text, target text, and media as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: 'A shared post',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(true)
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: '',
                publicationTargets: [target('A channel-specific post')],
                sourceMedia: [],
            })
        ).toBe(true)
        expect(
            hasRecoverablePublicationContent({
                postTitle: '',
                postContent: '',
                publicationTargets: [target()],
                sourceMedia: [{ assetId: 'asset-1' }],
            })
        ).toBe(true)
    })
})
