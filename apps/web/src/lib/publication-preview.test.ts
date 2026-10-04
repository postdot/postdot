import { describe, expect, test } from 'bun:test'

import { getDraftPreviewModel, getTargetPreviewTitle } from './publication-preview'

describe('publication draft preview model', () => {
    test('uses a non-blank channel adaptation and keeps the DEV.to title', () => {
        expect(
            getDraftPreviewModel({
                postContent: 'Shared content',
                postTitle: 'Release notes',
                profileId: 'devto',
                targetContent: 'DEV.to body',
            })
        ).toEqual({
            body: 'DEV.to body',
            hasText: true,
            showTitle: true,
            title: 'Release notes',
        })
    })

    test('keeps an explicitly blank channel adaptation blank', () => {
        expect(
            getDraftPreviewModel({
                postContent: 'Shared content',
                postTitle: 'Internal title',
                profileId: 'bluesky',
                targetContent: '  \n',
            })
        ).toEqual({
            body: '  \n',
            hasText: false,
            showTitle: false,
            title: 'Internal title',
        })
    })

    test('marks a media-only draft as textually empty without inventing copy', () => {
        expect(
            getDraftPreviewModel({
                postContent: '   ',
                postTitle: '',
                profileId: 'custom',
            })
        ).toEqual({
            body: '   ',
            hasText: false,
            showTitle: false,
            title: '',
        })
    })
})

describe('destination preview headline', () => {
    const profile = {
        fieldBindings: [{ id: 'title', semantic: 'headline', path: '/article/title' }],
    }

    test('uses the declared destination field rather than a guessed title property', () => {
        expect(
            getTargetPreviewTitle(profile, {
                title: 'Internal metadata',
                article: { title: 'Destination headline' },
            })
        ).toBe('Destination headline')
    })

    test('preserves a blank adaptation and does not invent missing content', () => {
        expect(getTargetPreviewTitle(profile, { article: { title: '' } })).toBe('')
        expect(getTargetPreviewTitle(profile, { title: 'Unbound title' })).toBe('')
        expect(getTargetPreviewTitle(profile, null)).toBe('')
        expect(getTargetPreviewTitle({}, { title: 'Unbound title' })).toBe('')
    })
})
