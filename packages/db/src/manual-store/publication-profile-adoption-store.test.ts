import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChannelProfileDefinition } from '@postdot/core'
import { createLocalMediaStore } from '@postdot/media'

import { backupWithMedia, restoreWithMedia } from '../backup'
import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { createMediaAssetStore } from '../media-asset-store'
import { runMigrations } from '../migrations'
import { seedTestWorkspace } from '../testing'

const profile: ChannelProfileDefinition = {
    id: 'adoption-test',
    version: 1,
    profileHash: 'old-profile',
    schemaHash: 'old-schema',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: { body: { type: 'string' }, extra: { type: 'string' } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
    capabilities: {
        revision: 'adoption-v1',
        textFields: [{ bindingId: 'body', acceptedSourceFormats: ['plain_text'], maxLength: 1000 }],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'adoption-test', revision: 'v1' },
}
function fixture(filename = ':memory:', pathChange = true) {
    const database = createDatabase(filename)
    runMigrations(database)
    const now = 1_800_000_000_000
    const store = createManualStore(database, { now: () => now })
    const project = store.createProject({
        workspaceId: seedTestWorkspace(database),
        name: 'Adoption',
        subjectId: 'operator',
        displayName: 'Operator',
    })
    const projectId = project.project.id
    const channel = store.createChannel({
        projectId,
        subjectId: 'operator',
        name: 'Channel',
        profile,
    })!
    const post = store.createPost({
        projectId,
        subjectId: 'operator',
        sourceContent: { body: { text: 'Original', format: 'plain_text' }, media: [] },
        publications: [
            { channelId: channel.id, deliveryMode: 'automatic', scheduledAt: now + 60_000 },
        ],
    })!
    const publicationId = post.publications[0]!.id
    const next = store.createChannelProfileDraft({
        projectId,
        channelId: channel.id,
        subjectId: 'operator',
        profile: {
            ...profile,
            version: 2,
            profileHash: 'next-profile',
            schemaHash: 'next-schema',
            contentSchema: pathChange
                ? {
                      type: 'object',
                      properties: {
                          article: {
                              type: 'object',
                              properties: { body: { type: 'string', minLength: 1 } },
                              required: ['body'],
                              additionalProperties: false,
                          },
                      },
                      required: ['article'],
                      additionalProperties: false,
                  }
                : profile.contentSchema,
            fieldBindings: [
                {
                    id: 'body',
                    semantic: 'primary_text',
                    path: pathChange ? '/article/body' : '/body',
                },
            ],
        },
    })!
    store.activateChannelProfile({
        projectId,
        channelId: channel.id,
        subjectId: 'operator',
        profileVersionId: next.id,
        expectedRevision: next.revision,
    })
    const editor = store.getPublicationEditorState(projectId, publicationId, 'operator')!
    const input = {
        projectId,
        publicationId,
        subjectId: 'operator',
        expectedRevision: editor.draft.revision,
        expectedSourceRevision: editor.draft.sourceRevision,
        expectedProfileVersionId: editor.draft.profileVersionId,
        activeProfileVersionId: next.id,
        targetContent: pathChange ? { article: { body: 'Adapted' } } : { body: 'Adapted' },
    }
    return { database, store, editor, input }
}
function state(database: ReturnType<typeof createDatabase>) {
    return [
        'publication_working_drafts',
        'publication_target_revisions',
        'publication_draft_adoptions',
        'publications',
        'jobs',
        'audit_events',
        'publication_approval_requests',
    ].map(table => database.$client.query(`select * from ${table} order by rowid`).all())
}

describe('explicit draft profile adoption', () => {
    test('preserves invalid saved and local content, the selected target and jobs; supports ordinary promotion afterward', () => {
        const { database, store, editor, input } = fixture()
        try {
            const saved = store.savePublicationDraft({
                projectId: input.projectId,
                publicationId: input.publicationId,
                subjectId: input.subjectId,
                expectedRevision: input.expectedRevision,
                targetContent: {
                    body: 'Saved original',
                    extra: 'Never discard',
                    unknown: 'Invalid but retained',
                },
            })!
            const before = store.getPublicationEditorState(
                input.projectId,
                input.publicationId,
                input.subjectId
            )!
            const jobs = database.$client.query('select * from jobs').all()
            const source = before.post
            const adopted = store.adoptPublicationDraftProfile({
                ...input,
                expectedRevision: saved.revision,
                previousLocalContent: { body: 'Unsaved', extra: 'Local extra' },
            })!
            expect(adopted.profileVersionId).toBe(input.activeProfileVersionId)
            expect(adopted.content).toEqual(input.targetContent)
            expect(adopted.reviewState).toBe('compatible')
            expect(adopted.revision).toBe(saved.revision + 1)
            const after = store.getPublicationEditorState(
                input.projectId,
                input.publicationId,
                input.subjectId
            )!
            expect(after.post).toEqual(source)
            expect(after.publication).toEqual(before.publication)
            expect(after.selectedTarget).toEqual(editor.selectedTarget)
            expect(after.selectedTargetProfile?.id).toBe(editor.profile.id)
            expect(after.profile.id).toBe(input.activeProfileVersionId)
            expect(database.$client.query('select * from jobs').all()).toEqual(jobs)
            const history = store.listPublicationDraftAdoptions(
                input.projectId,
                input.publicationId,
                input.subjectId
            )!
            expect(history).toHaveLength(1)
            expect(history[0]!.draft).toEqual(saved)
            expect(history[0]!.localContent).toEqual({ body: 'Unsaved', extra: 'Local extra' })
            expect(
                database.$client.query('select id from publication_target_revisions').all()
            ).toHaveLength(2)
            store.promotePublicationDraft({
                projectId: input.projectId,
                publicationId: input.publicationId,
                subjectId: input.subjectId,
                expectedRevision: adopted.revision,
            })
            expect(
                store.getPublicationEditorState(
                    input.projectId,
                    input.publicationId,
                    input.subjectId
                )!.selectedTarget!.profileVersionId
            ).toBe(input.activeProfileVersionId)
        } finally {
            closeDatabase(database)
        }
    })
    test('retains snapshot-only media and restores adoption history with a complete backup', async () => {
        const root = await mkdtemp(join(tmpdir(), 'postdot-adoption-'))
        const filename = join(root, 'source.sqlite')
        const { database, store, input } = fixture(filename)
        let closed = false
        try {
            const storage = createLocalMediaStore({
                storeId: 'adoption-local',
                rootDirectory: join(root, 'media'),
                maxObjectBytes: 2_000_000,
            })
            const media = createMediaAssetStore(database, storage, { now: () => 1_800_000_000_000 })
            const reservation = media.reserveUpload({
                projectId: input.projectId,
                subjectId: input.subjectId,
                originalFilename: 'preserved.png',
            })!
            const bytes = new Uint8Array(33)
            bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
            bytes.set([0, 0, 0, 4, 0, 0, 0, 3], 16)
            await media.upload({
                projectId: input.projectId,
                subjectId: input.subjectId,
                intentId: reservation.intent.id,
                source: new Blob([bytes]).stream(),
            })
            expect(
                (
                    await media.finalizeUpload({
                        projectId: input.projectId,
                        subjectId: input.subjectId,
                        intentId: reservation.intent.id,
                    })
                ).kind
            ).toBe('ready')
            const saved = store.savePublicationDraft({
                projectId: input.projectId,
                publicationId: input.publicationId,
                subjectId: input.subjectId,
                expectedRevision: input.expectedRevision,
                targetContent: { body: 'Previous', extra: reservation.asset.id },
            })!
            store.adoptPublicationDraftProfile({ ...input, expectedRevision: saved.revision })
            const history = store.listPublicationDraftAdoptions(
                input.projectId,
                input.publicationId,
                input.subjectId
            )
            expect(
                media.getAssetUsage(input.projectId, reservation.asset.id, input.subjectId)?.active
            ).toHaveLength(1)
            expect(
                media.requestDeletion(input.projectId, reservation.asset.id, input.subjectId)
            ).toEqual({ kind: 'blocked', reason: 'referenced' })
            closeDatabase(database)
            closed = true
            const bundle = join(root, 'bundle')
            const manifest = await backupWithMedia({
                databaseFilename: filename,
                destinationDirectory: bundle,
                mediaStore: storage,
            })
            expect(manifest.representations).toHaveLength(1)
            const restoredFile = join(root, 'restored.sqlite')
            const restoredStorage = createLocalMediaStore({
                storeId: 'adoption-local',
                rootDirectory: join(root, 'restored-media'),
                maxObjectBytes: 2_000_000,
            })
            await restoreWithMedia({
                sourceDirectory: bundle,
                databaseFilename: restoredFile,
                mediaStore: restoredStorage,
            })
            const restored = createDatabase(restoredFile)
            try {
                expect(
                    createManualStore(restored).listPublicationDraftAdoptions(
                        input.projectId,
                        input.publicationId,
                        input.subjectId
                    )
                ).toEqual(history)
                expect(
                    createMediaAssetStore(restored, restoredStorage).requestDeletion(
                        input.projectId,
                        reservation.asset.id,
                        input.subjectId
                    )
                ).toEqual({ kind: 'blocked', reason: 'referenced' })
            } finally {
                closeDatabase(restored)
            }
        } finally {
            if (!closed) closeDatabase(database)
            await rm(root, { recursive: true, force: true })
        }
    })
    test('adopts an already-compatible draft explicitly and supersedes its pending approval without scheduling it', () => {
        const { database, store, input } = fixture(':memory:', false)
        try {
            store.promotePublicationDraft({
                projectId: input.projectId,
                publicationId: input.publicationId,
                subjectId: input.subjectId,
                expectedRevision: input.expectedRevision,
                scheduledAt: null,
            })
            const draft = store.getPublicationEditorState(
                input.projectId,
                input.publicationId,
                input.subjectId
            )!.draft
            const request = store.submitPublicationForApproval({
                projectId: input.projectId,
                publicationId: input.publicationId,
                subjectId: input.subjectId,
                expectedDraftRevision: draft.revision,
                proposedScheduledAt: 1_800_000_060_000,
            })
            expect(request).not.toBeNull()
            const before = store.getPublicationEditorState(
                input.projectId,
                input.publicationId,
                input.subjectId
            )!
            const adopted = store.adoptPublicationDraftProfile({
                ...input,
                expectedRevision: before.draft.revision,
            })!
            const after = store.getPublicationEditorState(
                input.projectId,
                input.publicationId,
                input.subjectId
            )!
            expect(adopted.profileVersionId).toBe(input.activeProfileVersionId)
            expect(after.publication).toEqual(before.publication)
            expect(
                database.$client.query('select state from publication_approval_requests').all()
            ).toEqual([{ state: 'superseded' }])
            expect(
                database.$client.query("select id from jobs where state = 'pending'").all()
            ).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })
    test('validation is read-only and invalid candidates change nothing', () => {
        const { database, store, input } = fixture()
        try {
            const before = state(database)
            expect(store.assessPublicationDraftAdoption(input)?.valid).toBe(true)
            expect(
                store.assessPublicationDraftAdoption({ ...input, targetContent: {} })?.valid
            ).toBe(false)
            expect(state(database)).toEqual(before)
            expect(() =>
                store.adoptPublicationDraftProfile({ ...input, targetContent: {} })
            ).toThrow('invalid')
            expect(state(database)).toEqual(before)
        } finally {
            closeDatabase(database)
        }
    })
    test.each([
        'expectedRevision',
        'expectedSourceRevision',
        'expectedProfileVersionId',
        'activeProfileVersionId',
    ] as const)('rejects stale %s atomically', field => {
        const { database, store, input } = fixture()
        try {
            const before = state(database)
            expect(() =>
                store.adoptPublicationDraftProfile({
                    ...input,
                    [field]: typeof input[field] === 'number' ? 999 : 'stale-profile',
                })
            ).toThrow('changed')
            expect(state(database)).toEqual(before)
        } finally {
            closeDatabase(database)
        }
    })
})
