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
    test('does not treat a title or an untouched target as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postContent: ' ',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(false)
    })

    test('recognizes shared text, target text, and media as recoverable work', () => {
        expect(
            hasRecoverablePublicationContent({
                postContent: 'A shared post',
                publicationTargets: [target()],
                sourceMedia: [],
            })
        ).toBe(true)
        expect(
            hasRecoverablePublicationContent({
                postContent: '',
                publicationTargets: [target('A channel-specific post')],
                sourceMedia: [],
            })
        ).toBe(true)
        expect(
            hasRecoverablePublicationContent({
                postContent: '',
                publicationTargets: [target()],
                sourceMedia: [{ assetId: 'asset-1' }],
            })
        ).toBe(true)
    })
})
