import { describe, expect, test } from 'bun:test'

import { getDraftPreviewModel } from './publication-preview'

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
