import { expect, test } from 'bun:test'

import type { PublicationEditorState } from '@/lib/api'

import { compositionFromPost } from './existing-post-composition'
import {
    postCompositionRecoveryKey,
    readPostRecoveries,
    recoveryMatchesProfiles,
    restorePostRecovery,
    serializePostRecovery,
} from './post-composition-recovery'

const editor = {
    publication: {
        id: 'publication',
        projectId: 'project',
        state: 'draft',
        scheduledAt: null,
        deliveryMode: 'manual',
    },
    post: {
        id: 'post',
        sourceRevision: 1,
        sourceContent: { body: { format: 'plain_text', text: 'Server' }, media: [] },
    },
    draft: { revision: 1, profileVersionId: 'v1', content: { text: 'Server' } },
    channel: { id: 'channel', state: 'active' },
    profile: {
        profile: {
            contentSchema: { type: 'object', properties: { text: { type: 'string' } } },
            fieldBindings: [{ id: 'text', path: '/text', semantic: 'primary_text' }],
        },
    },
    selectedTarget: null,
} as unknown as PublicationEditorState
const source = editor.post
const state = { ...compositionFromPost(source, [editor], 'UTC'), postContent: 'Local' }
function storage(entries: Record<string, string>) {
    return { getItem: (key: string) => entries[key] ?? null }
}

test('post recovery is scoped to the author and round trips composition settings', () => {
    const key = postCompositionRecoveryKey('project', 'post', 'author')
    const serialized = serializePostRecovery(state, [editor], 'UTC')
    const recovered = readPostRecoveries(
        storage({ [key]: serialized }),
        key,
        source,
        [editor],
        'UTC'
    )
    expect(recovered[0]?.state.postContent).toBe('Local')
    expect(recovered[0]?.state.customizedTargetIds.has('publication')).toBe(true)
    expect(
        readPostRecoveries(
            storage({ [key]: serialized }),
            postCompositionRecoveryKey('project', 'post', 'someone-else'),
            source,
            [editor],
            'UTC'
        )
    ).toEqual([])
})

test('both legacy spellings preserve in-flight text, channel fields and schedule as explicit candidates', () => {
    const legacy = JSON.stringify({
        version: 3,
        baseRevision: 1,
        profileVersionId: 'v1',
        sourceContent: {
            ...source.sourceContent,
            body: { format: 'plain_text', text: 'Recovered source' },
        },
        targetText: JSON.stringify({ text: 'Own recovery', poll: { options: ['Yes', 'No'] } }),
        scheduleValue: '2026-12-01T09:00',
        timeZone: 'UTC',
    })
    const recovered = readPostRecoveries(
        storage({
            'postdot:publication-editor:v3:project:publication': legacy,
            'postdot:publication-editor-recovery:v3:project:publication': legacy,
        }),
        'post-key',
        source,
        [editor],
        'UTC'
    )
    expect(recovered).toHaveLength(2)
    expect(recovered[0]?.state.publicationTargets[0]).toMatchObject({
        content: 'Own recovery',
        scheduledAt: '2026-12-01T09:00',
        customized: true,
        contentDocument: { poll: { options: ['Yes', 'No'] } },
    })
    expect(recovered[0]?.state.postContent).toBe('Recovered source')
    expect(
        recoveryMatchesProfiles(recovered[0]!, [
            { ...editor, draft: { ...editor.draft, profileVersionId: 'v2' } },
        ])
    ).toBe(false)
})

test('restoring never changes a newly locked channel or another legacy publication', () => {
    const locked = {
        ...state,
        publicationTargets: state.publicationTargets.map(target => ({ ...target, locked: true })),
    }
    const recovered = { key: 'key', state, profileVersionIds: { publication: 'v1' } }
    expect(restorePostRecovery(locked, recovered).publicationTargets[0]).toBe(
        locked.publicationTargets[0]
    )
})

test('invalid storage and a different time zone are ignored without deleting them', () => {
    const entries = {
        bad: '{broken',
        wrong: serializePostRecovery(state, [editor], 'Europe/Paris'),
    }
    expect(readPostRecoveries(storage(entries), 'bad', source, [editor], 'UTC')).toEqual([])
    expect(readPostRecoveries(storage(entries), 'wrong', source, [editor], 'UTC')).toEqual([])
    expect(entries.bad).toBe('{broken')
})
