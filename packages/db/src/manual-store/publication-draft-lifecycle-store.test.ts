import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { runMigrations } from '../migrations'
import { createTaxonomyStore } from '../taxonomy-store'
import { seedTestWorkspace } from '../testing'

const sourceContent = (text: string) => ({
    body: { text, format: 'plain_text' as const },
    media: [],
})

describe('publication draft lifecycle store', () => {
    it('duplicates a draft as a new draft and deletes the original post when it is orphaned', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const now = 1_800_000_000_000
            const store = createManualStore(database, { now: () => now })
            const taxonomy = createTaxonomyStore(database, { now: () => now })
            const project = store.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'Draft lifecycle project',
                subjectId: 'user-1',
                displayName: 'Draft lifecycle operator',
            })
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Draft lifecycle channel',
            })
            expect(channel).not.toBeNull()

            const created = store.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                title: 'A reusable draft',
                sourceContent: sourceContent('Shared draft source'),
                publications: [
                    {
                        channelId: channel?.id ?? '',
                        targetContent: { body: 'Draft target', media: [] },
                        deliveryMode: 'manual',
                    },
                ],
            })
            expect(created).not.toBeNull()
            const publication = created?.publications[0]
            expect(publication).toMatchObject({ state: 'draft', deliveryMode: 'manual' })
            if (publication === undefined) throw new Error('Draft publication was not created')
            const tag = taxonomy.createTag({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Reusable',
            })
            expect(tag).not.toBeNull()
            if (tag === null) throw new Error('Publication tag was not created')
            taxonomy.replacePublicationTags({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                tagIds: [tag.id],
            })

            const duplicated = store.duplicateDraftPublication({
                projectId: project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
            })
            expect(duplicated).toMatchObject({
                kind: 'duplicated',
                post: { title: 'A reusable draft' },
                publication: { state: 'draft', deliveryMode: 'manual' },
            })
            if (duplicated.kind !== 'duplicated') throw new Error('Draft was not duplicated')
            expect(duplicated.post.id).not.toBe(publication.postId)
            expect(duplicated.publication.id).not.toBe(publication.id)
            expect(
                store
                    .listPublicationSummaries(project.project.id, 'user-1')
                    ?.find(item => item.id === duplicated.publication.id)?.tagIds
            ).toEqual([tag.id])
            expect(
                store.getPublicationEditorState(
                    project.project.id,
                    duplicated.publication.id,
                    'user-1'
                )
            ).toMatchObject({
                post: { title: 'A reusable draft' },
                draft: { content: { body: 'Draft target', media: [] } },
            })

            expect(
                store.deleteDraftPublication({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                })
            ).toEqual({ kind: 'deleted', postDeleted: true })
            expect(
                store.getPublicationEditorState(project.project.id, publication.id, 'user-1')
            ).toBeNull()
            expect(
                store.deleteDraftPublication({
                    projectId: project.project.id,
                    publicationId: publication.id,
                    subjectId: 'user-1',
                })
            ).toEqual({ kind: 'not_found' })
        } finally {
            closeDatabase(database)
        }
    })
})
