import { expect, test } from 'bun:test'

import {
    ChannelProfileValidationError,
    type ChannelProfileDraftDefinition,
    createManualChannelProfile,
} from '@postdot/core'

import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { runMigrations } from '../migrations'
import { seedTestWorkspace } from '../testing'

test('draft save owns fingerprints, preserves historical work and guards concurrent edits across channels', async () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const { project } = await store.createProject({
            workspaceId: await seedTestWorkspace(database),
            name: 'Fingerprint project',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const input = { projectId: project.id, subjectId: 'operator' }
        const channel = (await store.createChannel({
            ...input,
            name: 'First',
            profile: createManualChannelProfile(),
        }))!
        const secondChannel = (await store.createChannel({
            ...input,
            name: 'Second',
            profile: createManualChannelProfile(),
        }))!
        const stateInput = { projectId: project.id, channelId: channel.id, subjectId: 'operator' }
        const original = (await store.getChannelProfileState(project.id, channel.id, 'operator'))!
            .active
        const post = (await store.createPost({
            ...input,
            sourceContent: { body: { text: 'Original source', format: 'plain_text' }, media: [] },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'manual',
                    scheduledAt: 1_800_000_060_000,
                    targetContent: { body: 'Original target', media: [] },
                },
            ],
        }))!
        const editorInput = { ...stateInput, publicationId: post.publications[0]!.id }
        const editorBefore = await store.getPublicationEditorState(
            editorInput.projectId,
            editorInput.publicationId,
            editorInput.subjectId
        )
        const proposed = JSON.parse(JSON.stringify(original.profile))
        proposed.contentSchema.properties.body.maxLength = 900
        proposed.version = 999
        const first = (await store.createChannelProfileDraft({ ...stateInput, profile: proposed }))!
        expect(first.version).toBe(original.version + 1)
        expect(first.profile.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(first.profile.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(first.profile.schemaHash).not.toBe(proposed.schemaHash)
        proposed.contentSchema.properties.body.maxLength = 800
        const second = (await store.createChannelProfileDraft({
            ...stateInput,
            profile: proposed,
            expectedRevision: first.revision,
        }))!
        expect(second.id).toBe(first.id)
        expect(second.revision).toBe(2)
        expect(second.profile.schemaHash).not.toBe(first.profile.schemaHash)
        const other = (await store.createChannelProfileDraft({
            ...stateInput,
            channelId: secondChannel.id,
            profile: proposed,
        }))!
        expect(other.profile.schemaHash).toBe(second.profile.schemaHash)
        expect(other.profile.profileHash).toBe(second.profile.profileHash)
        const { id, origin, version, profileHash, schemaHash, ...editable } = second.profile
        const unchanged = (await store.createChannelProfileDraft({
            ...stateInput,
            profile: editable,
            expectedRevision: second.revision,
        }))!
        expect(unchanged.revision).toBe(3)
        expect(unchanged.profile).toEqual(second.profile)
        await expect(
            store.createChannelProfileDraft({
                ...stateInput,
                profile: editable,
                expectedRevision: second.revision,
            })
        ).rejects.toThrow('changed after revision')
        await expect(
            store.createChannelProfileDraft({
                ...stateInput,
                profile: { ...editable, id: `${id}-wrong` },
                expectedRevision: 3,
            })
        ).rejects.toThrow('cannot change profile identity')
        await expect(
            store.createChannelProfileDraft({
                ...stateInput,
                profile: { ...editable, origin: origin === 'built_in' ? 'custom' : 'built_in' },
                expectedRevision: 3,
            })
        ).rejects.toThrow('cannot change profile origin')
        await expect(
            store.createChannelProfileDraft({
                ...stateInput,
                expectedRevision: unchanged.revision,
                profile: {
                    ...editable,
                    capabilities: null,
                } as unknown as ChannelProfileDraftDefinition,
            })
        ).rejects.toThrow(ChannelProfileValidationError)
        expect(
            (await store.getChannelProfileState(project.id, channel.id, 'operator'))!.draft
        ).toEqual(unchanged)
        expect(
            (await store.getChannelProfileState(project.id, channel.id, 'operator'))!.active
        ).toEqual(original)
        expect(
            await store.getPublicationEditorState(
                editorInput.projectId,
                editorInput.publicationId,
                editorInput.subjectId
            )
        ).toEqual(editorBefore)
        expect(unchanged.profile.version).toBe(version)
        expect(unchanged.profile.profileHash).toBe(profileHash)
        expect(unchanged.profile.schemaHash).toBe(schemaHash)
    } finally {
        closeDatabase(database)
    }
})
