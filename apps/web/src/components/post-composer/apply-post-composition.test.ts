import { expect, test } from 'bun:test'

import type { PublicationEditorState } from '@/lib/api'

import { applyCompositionChannels, discardCompositionChanges } from './apply-post-composition'
import { initialPostComposition } from './use-post-composition'

function editor(id: string, content = 'Pending', selected = 'Applied'): PublicationEditorState {
    return {
        publication: { id, state: 'draft', scheduledAt: null },
        profile: {
            profile: {
                contentSchema: { type: 'object', properties: { text: { type: 'string' } } },
                fieldBindings: [{ id: 'text', path: '/text', semantic: 'primary_text' }],
            },
        },
        post: { sourceContent: { body: { format: 'plain_text', text: content }, media: [] } },
        draft: { profileVersionId: 'v1', content: { text: content } },
        selectedTarget: { profileVersionId: 'v1', content: { text: selected } },
    } as unknown as PublicationEditorState
}
function state() {
    return initialPostComposition({
        postContent: 'Pending',
        publicationTargets: ['one', 'two', 'locked'].map(id => ({
            id,
            channelId: id,
            deliveryMode: 'manual',
            scheduledAt: '',
            content: '',
            customized: false,
            locked: id === 'locked',
        })),
    })
}

test('partial application continues sequentially and retries only remaining channels', async () => {
    let editors = [editor('one'), editor('two'), editor('locked')]
    const calls: string[] = []
    const errors: string[] = []
    let fail = true
    const input = {
        state: state(),
        timeZone: 'UTC',
        canContinue: () => true,
        apply: async (current: PublicationEditorState) => {
            calls.push(current.publication.id)
            if (current.publication.id === 'two' && fail) throw new Error('validation')
            return {
                ...current,
                selectedTarget: { ...current.selectedTarget!, content: current.draft.content },
            }
        },
        onApplied: (next: PublicationEditorState) => {
            editors = editors.map(current =>
                current.publication.id === next.publication.id ? next : current
            )
        },
        onFailure: (current: PublicationEditorState) => {
            errors.push(current.publication.id)
        },
    }
    await applyCompositionChannels({ ...input, editors })
    expect(calls).toEqual(['one', 'two'])
    expect(errors).toEqual(['two'])
    fail = false
    await applyCompositionChannels({ ...input, editors })
    expect(calls).toEqual(['one', 'two', 'two'])
})

test('an access epoch change quarantines acknowledgement and prevents subsequent application', async () => {
    let active = true
    let acknowledgements = 0
    let calls = 0
    await applyCompositionChannels({
        editors: [editor('one'), editor('two')],
        state: state(),
        timeZone: 'UTC',
        canContinue: () => active,
        apply: async current => {
            calls++
            active = false
            return current
        },
        onApplied: () => {
            acknowledgements++
        },
        onFailure: () => {
            throw new Error('Unexpected failure')
        },
    })
    expect(calls).toBe(1)
    expect(acknowledgements).toBe(0)
})

test('discard restores editable applied versions and the following post while retaining locked content', () => {
    const before = state()
    const next = discardCompositionChanges(
        before,
        [editor('one'), editor('two'), editor('locked')],
        'UTC'
    )
    expect(next.postContent).toBe('Applied')
    expect(next.publicationTargets[0]?.contentDocument).toEqual({ text: 'Applied' })
    expect(next.publicationTargets[1]?.customized).toBe(false)
    expect(next.publicationTargets[2]).toBe(before.publicationTargets[2])
    expect(before.postContent).toBe('Pending')
})
