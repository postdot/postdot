import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { runMigrations } from '../migrations'

const now = 1_800_000_000_000

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const store = createManualStore(database, { now: () => now })
    const project = store.createProject({
        name: 'Composer recovery project',
        subjectId: 'user-1',
        displayName: 'Herald Operator',
    })
    return { database, project, store }
}

function content(postContent: string) {
    return {
        activePublicationTabId: 'shared',
        customizedContentTargetIds: [],
        customizedTargetIds: [],
        defaultDeliveryMode: 'manual' as const,
        defaultScheduledAt: '',
        postContent,
        postTitle: '',
        publicationTagIds: [],
        publicationTargets: [
            {
                channelId: 'channel-1',
                content: '',
                deliveryMode: 'manual' as const,
                id: 'target-1',
                scheduledAt: '',
            },
        ],
        sourceMedia: [],
    }
}

describe('publication composer draft store', () => {
    it('persists one revisioned recovery point per project actor', () => {
        const fixture = createFixture()

        try {
            expect(
                fixture.store.getPublicationComposerDraft(fixture.project.project.id, 'user-1')
            ).toBeNull()

            const created = fixture.store.savePublicationComposerDraft({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                expectedRevision: 0,
                content: content('First recovery copy'),
            })
            expect(created).toMatchObject({
                projectId: fixture.project.project.id,
                revision: 1,
                content: content('First recovery copy'),
                createdAt: now,
                updatedAt: now,
            })

            const unchanged = fixture.store.savePublicationComposerDraft({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                content: content('First recovery copy'),
            })
            expect(unchanged?.revision).toBe(1)

            const updated = fixture.store.savePublicationComposerDraft({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                expectedRevision: 1,
                content: content('Second recovery copy'),
            })
            expect(updated).toMatchObject({ revision: 2, content: content('Second recovery copy') })

            expect(() =>
                fixture.store.savePublicationComposerDraft({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    content: content('Stale recovery copy'),
                })
            ).toThrow('changed after revision 1')
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('persists title-only articles without relaxing empty draft rejection', () => {
        const fixture = createFixture()
        try {
            const draft = { ...content(''), postTitle: 'Article outline' }
            fixture.store.savePublicationComposerDraft({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                expectedRevision: 0,
                content: draft,
            })
            expect(
                fixture.store.getPublicationComposerDraft(fixture.project.project.id, 'user-1')
                    ?.content
            ).toEqual(draft)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects empty recovery points and discards the current one', () => {
        const fixture = createFixture()

        try {
            expect(() =>
                fixture.store.savePublicationComposerDraft({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                    expectedRevision: 0,
                    content: content(''),
                })
            ).toThrow('must include content')

            fixture.store.savePublicationComposerDraft({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                expectedRevision: 0,
                content: content('Keep this until discard'),
            })
            expect(
                fixture.store.deletePublicationComposerDraft({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                })
            ).toBe(true)
            expect(
                fixture.store.getPublicationComposerDraft(fixture.project.project.id, 'user-1')
            ).toBeNull()
            expect(
                fixture.store.deletePublicationComposerDraft({
                    projectId: fixture.project.project.id,
                    subjectId: 'user-1',
                })
            ).toBe(false)
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
