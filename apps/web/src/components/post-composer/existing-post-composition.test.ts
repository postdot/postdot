import { describe, expect, test } from 'bun:test'

import type { PublicationEditorState } from '@/lib/api'

import {
    compositionChannelContent,
    compositionFromPost,
    compositionSource,
    isCompositionChannelLocked,
} from './existing-post-composition'
import { reducePostComposition } from './use-post-composition'

const profile = {
    contentSchema: {
        type: 'object',
        properties: { text: { type: 'string' }, title: { type: 'string' } },
    },
    fieldBindings: [
        { id: 'text', path: '/text', semantic: 'primary_text' },
        { id: 'title', path: '/title', semantic: 'headline' },
        { id: 'media', path: '/media', semantic: 'ordered_media', item: { assetIdPath: '/id' } },
    ],
}
function fixture(id: string, text = 'Shared'): PublicationEditorState {
    return {
        publication: {
            id,
            channelId: 'same-channel',
            state: 'draft',
            deliveryMode: 'manual',
            scheduledAt: null,
        },
        post: {
            id: 'post',
            sourceRevision: 4,
            sourceContent: {
                body: { format: 'markdown', text: 'Shared' },
                headline: 'Title',
                media: [{ assetId: 'source-image' }],
                language: 'fr',
            },
        },
        channel: { id: 'same-channel', state: 'active' },
        profile: { profile },
        draft: { content: { text, title: 'Title', media: [{ id: 'source-image' }], lang: 'de' } },
        selectedTarget: { content: { text: 'Published', title: 'Published title', media: [] } },
    } as unknown as PublicationEditorState
}

describe('existing post composition', () => {
    test('loads source, schedule and distinct tabs for repeated channel publications', () => {
        const one = fixture('one')
        const two = fixture('two', 'Own text')
        const state = compositionFromPost(one.post, [one, two], 'Europe/Paris')
        expect(state.activeContentScopeId).toBe('shared')
        expect(state.postTitle).toBe('Title')
        expect(state.sourceMedia).toEqual([{ assetId: 'source-image' }])
        expect(
            state.publicationTargets.map(target => [
                target.id,
                target.customized,
                target.scheduledAt,
            ])
        ).toEqual([
            ['one', false, ''],
            ['two', true, ''],
        ])
        expect(
            compositionFromPost(one.post, [one, two], 'UTC', { activePublicationId: 'two' })
                .activeContentScopeId
        ).toBe('two')
    })

    test('post edits project following channels and preserve own copy and channel fields', () => {
        const one = fixture('one')
        const own = fixture('own', 'Own text')
        const state = reducePostComposition(compositionFromPost(one.post, [one, own], 'UTC'), {
            type: 'editText',
            scopeId: 'shared',
            content: 'Changed',
        })
        expect(compositionChannelContent(state, one)).toEqual({
            ...one.draft.content,
            text: 'Changed',
        })
        expect(compositionChannelContent(state, own)).toEqual(own.draft.content)
        expect(compositionSource(state, one.post.sourceContent)).toEqual({
            ...one.post.sourceContent,
            body: { format: 'markdown', text: 'Changed' },
        })
    })

    test('locked tabs show applied content, retain it across source changes and cannot be edited', () => {
        const editor = fixture('published')
        const locked = {
            ...editor,
            publication: { ...editor.publication, state: 'published' as const },
        }
        let state = compositionFromPost(editor.post, [locked], 'UTC')
        expect(state.publicationTargets[0]?.content).toBe('Published')
        state = reducePostComposition(state, {
            type: 'editText',
            scopeId: 'shared',
            content: 'Later',
        })
        const before = state
        state = reducePostComposition(state, {
            type: 'editText',
            scopeId: 'published',
            content: 'Refused',
        })
        expect(state).toBe(before)
        expect(compositionChannelContent(state, locked)).toEqual(locked.selectedTarget!.content)
    })

    test('viewers, archived channels, lifecycle locks and started threads lock the tab', () => {
        const editor = fixture('one')
        expect(isCompositionChannelLocked(editor, true)).toBe(true)
        expect(
            isCompositionChannelLocked({
                ...editor,
                channel: { ...editor.channel, state: 'archived' },
            })
        ).toBe(true)
        for (const state of ['publishing', 'published', 'cancelled'] as const)
            expect(
                isCompositionChannelLocked({
                    ...editor,
                    publication: { ...editor.publication, state },
                })
            ).toBe(true)
        expect(
            isCompositionChannelLocked({
                ...editor,
                publication: { ...editor.publication, state: 'failed' },
                threadMessages: [
                    { state: 'confirmed' },
                ] as unknown as PublicationEditorState['threadMessages'],
            })
        ).toBe(true)
    })

    test('clearing custom copy stays blank and resetting follows the latest post', () => {
        const editor = fixture('one', 'Own')
        let state = compositionFromPost(editor.post, [editor], 'UTC')
        state = reducePostComposition(state, { type: 'editText', scopeId: 'one', content: '' })
        expect(compositionChannelContent(state, editor).text).toBeUndefined()
        state = reducePostComposition(state, { type: 'resetText', targetId: 'one' })
        expect(compositionChannelContent(state, editor).text).toBe('Shared')
    })
})
