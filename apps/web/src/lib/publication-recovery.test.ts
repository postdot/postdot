import { describe, expect, test } from 'bun:test'

import {
    hasRecoverablePublicationContent,
    isPublicationComposerDraftContent,
} from './publication-recovery'

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

describe('server composer draft content validation', () => {
    const content = {
        postTitle: 'Retained draft',
        postContent: '',
        sourceMedia: [],
        publicationTargets: [target('Destination copy')],
        publicationTagIds: ['tag-1'],
        defaultDeliveryMode: 'manual',
        defaultScheduledAt: '',
        customizedTargetIds: [],
        customizedContentTargetIds: [],
        activePublicationTabId: 'target-1',
    }

    test('accepts complete server content and optional content scope without requiring local metadata', () => {
        expect(isPublicationComposerDraftContent(content)).toBe(true)
        expect(
            isPublicationComposerDraftContent({ ...content, activeContentScopeId: 'source' })
        ).toBe(true)
        expect(
            isPublicationComposerDraftContent({ ...content, postTitle: '', publicationTargets: [] })
        ).toBe(true)
    })

    test('rejects opaque or malformed server content before the editor treats it as a draft', () => {
        for (const value of [
            null,
            {},
            { unrelated: 'record' },
            { ...content, sourceMedia: [{ assetId: 42 }] },
            { ...content, publicationTargets: [{ ...target(), deliveryMode: 'invalid' }] },
            { ...content, publicationTagIds: [42] },
            { ...content, activeContentScopeId: 42 },
        ]) {
            expect(isPublicationComposerDraftContent(value)).toBe(false)
        }
    })
})
