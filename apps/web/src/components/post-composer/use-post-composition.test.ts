import { describe, expect, test } from 'bun:test'

import {
    initialPostComposition,
    reducePostComposition,
    postScopeText,
    type PostCompositionInitialState,
} from './use-post-composition'

function composition(initial: PostCompositionInitialState = {}) {
    return initialPostComposition({
        postContent: 'Shared text',
        publicationTargets: [
            {
                id: 'one',
                channelId: 'channel-one',
                content: '',
                customized: false,
                deliveryMode: 'manual',
                scheduledAt: '2026-12-01T10:00',
            },
            {
                id: 'two',
                channelId: 'channel-two',
                content: 'Own text',
                customized: true,
                deliveryMode: 'automatic',
                scheduledAt: '2026-12-02T11:00',
            },
        ],
        ...initial,
    })
}

describe('post composition', () => {
    test('loads existing post fields, targets, flags and active scope without a create workflow', () => {
        const state = composition({
            postTitle: 'Existing post',
            publicationTagIds: ['tag'],
            sourceMedia: [{ assetId: 'image' }],
            activeContentScopeId: 'two',
        })
        expect(state.postTitle).toBe('Existing post')
        expect(state.publicationTagIds).toEqual(['tag'])
        expect(state.sourceMedia).toEqual([{ assetId: 'image' }])
        expect(postScopeText(state, state.activeContentScopeId)).toBe('Own text')
    })

    test('shared scope updates following text and leaves channel copy alone', () => {
        const state = reducePostComposition(composition(), {
            type: 'editText',
            scopeId: 'shared',
            content: 'Updated shared text',
        })
        expect(postScopeText(state, 'one')).toBe('Updated shared text')
        expect(postScopeText(state, 'two')).toBe('Own text')
        expect(state.publicationTargets[0]?.customized).toBe(false)
    })

    test('editing a channel gives it its own copy, including an intentionally empty edit', () => {
        let state = reducePostComposition(composition(), {
            type: 'editText',
            scopeId: 'one',
            content: 'Channel text',
        })
        state = reducePostComposition(state, {
            type: 'editText',
            scopeId: 'shared',
            content: 'Later shared text',
        })
        expect(postScopeText(state, 'one')).toBe('Channel text')
        state = reducePostComposition(state, { type: 'editText', scopeId: 'one', content: '' })
        expect(state.publicationTargets[0]?.customized).toBe(true)
        expect(postScopeText(state, 'one')).toBe('')
    })

    test('resetting copy follows the latest shared text and clears customization', () => {
        let state = reducePostComposition(composition(), { type: 'resetText', targetId: 'two' })
        state = reducePostComposition(state, {
            type: 'editText',
            scopeId: 'shared',
            content: 'Latest shared text',
        })
        expect(postScopeText(state, 'two')).toBe('Latest shared text')
        expect(state.publicationTargets[1]?.content).toBe('')
        expect(state.publicationTargets[1]?.customized).toBe(false)
    })

    test('confirmed removal drops custom text and returns the active scope to shared', () => {
        const original = reducePostComposition(composition(), {
            type: 'selectScope',
            scopeId: 'two',
        })
        const state = reducePostComposition(original, { type: 'removeTarget', targetId: 'two' })
        expect(state.publicationTargets.map(target => target.id)).toEqual(['one'])
        expect(state.activeContentScopeId).toBe('shared')
        expect(state.activePublicationTabId).toBe('shared')
        expect(original.publicationTargets[1]?.content).toBe('Own text')
        expect(state.postContent).toBe('Shared text')
    })

    test('adding a target preserves scope and rejects duplicate channels', () => {
        const original = reducePostComposition(composition(), {
            type: 'selectScope',
            scopeId: 'two',
        })
        const target = {
            id: 'three',
            channelId: 'channel-three',
            content: '',
            customized: false,
            deliveryMode: 'manual' as const,
            scheduledAt: '2026-12-03T12:00',
        }
        const state = reducePostComposition(original, { type: 'addTarget', target })
        expect(state.activeContentScopeId).toBe('two')
        expect(state.publicationTargets).toHaveLength(3)
        expect(
            reducePostComposition(state, {
                type: 'addTarget',
                target: { ...target, id: 'duplicate' },
            })
        ).toBe(state)
    })

    test('delivery overrides stay independent from copy and reset to current defaults', () => {
        let state = reducePostComposition(composition(), {
            type: 'customizeDelivery',
            targetId: 'two',
            customized: true,
        })
        state = reducePostComposition(state, { type: 'defaultDelivery', deliveryMode: 'automatic' })
        state = reducePostComposition(state, {
            type: 'defaultSchedule',
            scheduledAt: '2026-12-04T12:00',
        })
        expect(state.publicationTargets[0]?.deliveryMode).toBe('automatic')
        expect(state.publicationTargets[0]?.scheduledAt).toBe('2026-12-04T12:00')
        expect(state.publicationTargets[1]?.scheduledAt).toBe('2026-12-02T11:00')
        state = reducePostComposition(state, {
            type: 'customizeDelivery',
            targetId: 'two',
            customized: false,
        })
        expect(state.publicationTargets[1]?.scheduledAt).toBe('2026-12-04T12:00')
        expect(state.publicationTargets[1]?.customized).toBe(true)
        expect(postScopeText(state, 'two')).toBe('Own text')
    })

    test('target delivery edits preserve locked targets and text customization', () => {
        const state = composition({
            publicationTargets: [
                {
                    id: 'locked',
                    channelId: 'published',
                    content: 'Published text',
                    customized: false,
                    locked: true,
                    deliveryMode: 'manual',
                    scheduledAt: '2026-11-01T09:00',
                },
                ...composition().publicationTargets,
            ],
        })
        const updated = reducePostComposition(state, {
            type: 'changeTargets',
            targets: state.publicationTargets.map(target => ({
                ...target,
                deliveryMode: 'automatic',
                scheduledAt: '2026-12-05T09:00',
            })),
        })
        expect(updated.publicationTargets[0]).toBe(state.publicationTargets[0]!)
        expect(updated.publicationTargets[1]?.deliveryMode).toBe('automatic')
        expect(updated.publicationTargets[1]?.scheduledAt).toBe('2026-12-05T09:00')
        expect(updated.publicationTargets[2]?.customized).toBe(true)
        expect(
            reducePostComposition(state, { type: 'changeTargets', targets: [] }).publicationTargets
        ).toEqual([state.publicationTargets[0]!])
    })

    test('locked tabs can be selected but keep their text and delivery through shared edits', () => {
        let state = composition({
            publicationTargets: [
                {
                    id: 'locked',
                    channelId: 'published',
                    content: 'Published text',
                    customized: false,
                    locked: true,
                    deliveryMode: 'manual',
                    scheduledAt: '2026-11-01T09:00',
                },
            ],
        })
        state = reducePostComposition(state, { type: 'selectScope', scopeId: 'locked' })
        state = reducePostComposition(state, {
            type: 'editText',
            scopeId: 'shared',
            content: 'New shared text',
        })
        state = reducePostComposition(state, { type: 'defaultDelivery', deliveryMode: 'automatic' })
        state = reducePostComposition(state, {
            type: 'defaultSchedule',
            scheduledAt: '2026-12-04T12:00',
        })
        expect(postScopeText(state, 'locked')).toBe('Published text')
        expect(state.publicationTargets[0]?.deliveryMode).toBe('manual')
        expect(state.publicationTargets[0]?.scheduledAt).toBe('2026-11-01T09:00')
        expect(state.activeContentScopeId).toBe('locked')
        expect(
            reducePostComposition(state, {
                type: 'editText',
                scopeId: 'locked',
                content: 'Refused',
            })
        ).toBe(state)
        expect(reducePostComposition(state, { type: 'resetText', targetId: 'locked' })).toBe(state)
        expect(reducePostComposition(state, { type: 'removeTarget', targetId: 'locked' })).toBe(
            state
        )
        expect(
            reducePostComposition(state, {
                type: 'customizeDelivery',
                targetId: 'locked',
                customized: true,
            })
        ).toBe(state)
    })
})

test('structured channel edits remain scoped and survive delivery changes', () => {
    let state = composition()
    const document = { text: 'Own text', poll: { options: ['Yes', 'No'] } }
    state = reducePostComposition(state, {
        type: 'targetDocument',
        targetId: 'one',
        document,
        content: 'Own text',
        customized: true,
    })
    state = reducePostComposition(state, {
        type: 'changeTargets',
        targets: state.publicationTargets.map(target => ({
            ...target,
            scheduledAt: '2026-12-10T09:00',
        })),
    })
    expect(state.publicationTargets[0]?.contentDocument).toEqual(document)
    expect(state.publicationTargets[0]?.customized).toBe(true)
    expect(state.postContent).toBe('Shared text')
    const locked = {
        ...state,
        publicationTargets: state.publicationTargets.map(target => ({ ...target, locked: true })),
    }
    expect(
        reducePostComposition(locked, {
            type: 'targetDocument',
            targetId: 'one',
            document: {},
            content: '',
            customized: true,
        })
    ).toBe(locked)
})
