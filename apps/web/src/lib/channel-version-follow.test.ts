import { describe, expect, test } from 'bun:test'

import {
    applyPostToChannel,
    channelVersionFollowsSource,
    followSourceChange,
    postFromChannelVersion,
} from './channel-version-follow'

const profile = {
    fieldBindings: [
        { id: 'text', path: '/text', semantic: 'primary_text' },
        { id: 'title', path: '/title', semantic: 'headline' },
        { id: 'lang', path: '/lang', semantic: 'language' },
        {
            id: 'media',
            path: '/media',
            semantic: 'ordered_media',
            item: { assetIdPath: '/id', accessibilityTextPath: '/alt' },
        },
    ],
}

const source = {
    body: { format: 'plain_text' as const, text: 'Hello' },
    media: [{ assetId: 'a1', accessibilityText: 'A cat' }],
}

describe('channel versions that follow the post', () => {
    test('a version equal to the projected post follows it, channel-only fields aside', () => {
        const target = { text: 'Hello', lang: 'fr', media: [{ id: 'a1', alt: 'A cat' }] }
        expect(channelVersionFollowsSource(profile, source, target)).toBe(true)
        expect(channelVersionFollowsSource(profile, source, { ...target, text: 'Hi' })).toBe(false)
    })

    test('typing in the post updates a following version and leaves an adapted one alone', () => {
        const next = { ...source, body: { format: 'plain_text' as const, text: 'Hello world' } }
        const following = { text: 'Hello', lang: 'fr', media: [{ id: 'a1', alt: 'A cat' }] }
        expect(followSourceChange(profile, source, next, following)).toEqual({
            ...following,
            text: 'Hello world',
        })
        expect(followSourceChange(profile, source, next, { ...following, text: 'Own' })).toBe(null)
    })

    test('the post text can be applied again and recovered from a version', () => {
        const own = { text: 'Own', lang: 'fr', media: [] }
        expect(applyPostToChannel(profile, source, own)).toEqual({
            text: 'Hello',
            lang: 'fr',
            media: [{ id: 'a1', alt: 'A cat' }],
        })
        expect(
            postFromChannelVersion(
                profile,
                { text: 'Applied', title: 'T', media: [{ id: 'b2' }] },
                source
            )
        ).toEqual({
            body: { format: 'plain_text', text: 'Applied' },
            headline: 'T',
            media: [{ assetId: 'b2' }],
        })
    })
})
