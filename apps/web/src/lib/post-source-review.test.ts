import { describe, expect, test } from 'bun:test'

import { countStaleChannelVersions, sourceContentDifferences } from './post-source-review'

describe('channel version review', () => {
    test('counts only editable stale versions on active channels', () => {
        const publications = [
            { id: 'stale', channelId: 'active', state: 'draft' as const, draftSourceRevision: 1 },
            { id: 'current', channelId: 'active', state: 'draft' as const, draftSourceRevision: 2 },
            {
                id: 'published',
                channelId: 'active',
                state: 'published' as const,
                draftSourceRevision: 1,
            },
            { id: 'locked', channelId: 'active', state: 'ready' as const, draftSourceRevision: 1 },
            {
                id: 'inactive',
                channelId: 'archived',
                state: 'draft' as const,
                draftSourceRevision: 1,
            },
            {
                id: 'missing',
                channelId: 'missing',
                state: 'draft' as const,
                draftSourceRevision: 1,
            },
            {
                id: 'scheduled',
                channelId: 'active',
                state: 'scheduled' as const,
                draftSourceRevision: 1,
            },
        ]
        const channels = [
            { id: 'active', state: 'active' as const },
            { id: 'archived', state: 'archived' as const },
        ]
        expect(countStaleChannelVersions(publications, channels, 2)).toBe(2)
        expect(countStaleChannelVersions(publications, channels, 1)).toBe(0)
        expect(countStaleChannelVersions([], channels, 2)).toBe(0)
    })

    test('uses fresh summaries without losing immediate editor acknowledgements', () => {
        const channels = [{ id: 'active', state: 'active' as const }]
        const draft = {
            id: 'version',
            channelId: 'active',
            state: 'draft' as const,
            draftSourceRevision: 1,
        }
        const editor = {
            publication: { id: 'version', state: 'draft' as const },
            draft: { sourceRevision: 1 },
        }
        expect(
            countStaleChannelVersions([{ ...draft, draftSourceRevision: 2 }], channels, 2, editor)
        ).toBe(0)
        expect(
            countStaleChannelVersions([draft], channels, 2, {
                ...editor,
                draft: { sourceRevision: 2 },
            })
        ).toBe(0)
        expect(
            countStaleChannelVersions([{ ...draft, state: 'cancelled' }], channels, 2, editor)
        ).toBe(0)
        expect(
            countStaleChannelVersions([draft], channels, 2, {
                ...editor,
                publication: { ...editor.publication, state: 'published' },
            })
        ).toBe(0)
    })

    test('compares empty fields, media order and accessibility text', () => {
        const content = {
            media: [{ assetId: 'one', accessibilityText: 'First' }, { assetId: 'two' }],
        }
        expect(
            sourceContentDifferences(content, {
                ...content,
                headline: '',
                body: { text: '', format: 'plain_text' },
            })
        ).toEqual({ text: false, title: false, media: false })
        expect(
            sourceContentDifferences(content, {
                body: { text: 'New', format: 'plain_text' },
                headline: 'New title',
                media: [...content.media].reverse(),
            })
        ).toEqual({ text: true, title: true, media: true })
        expect(
            sourceContentDifferences(content, {
                media: [{ assetId: 'one', accessibilityText: 'Changed' }, { assetId: 'two' }],
            }).media
        ).toBe(true)
    })
})
