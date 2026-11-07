import type { DatabaseHandle } from '../../packages/db/src/client'
import { insertRow, seedTestWorkspace, seedWorkspaceChannel } from '../../packages/db/src/testing'

const profileVersionId = 'profile'
const fixtureProfile = {
    id: 'fixture',
    version: 1,
    profileHash: 'sha256:fixture-profile-v1',
    schemaHash: 'sha256:fixture-schema-v1',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { body: { type: 'string' as const, minLength: 1 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text' as const, path: '/body' }],
    capabilities: {
        revision: 'fixture-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 10_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in' as const, contractId: 'fixture', revision: 'v1' },
}

export async function seedWorkflowBenchmark(database: DatabaseHandle, count: number) {
    const dueAt = Date.now() - 1_000
    await database.sql.transaction(async () => {
        await insertRow(database, 'projects', {
            id: 'project',
            name: 'Benchmark project',
            workspaceId: await seedTestWorkspace(database),
        })
        await insertRow(database, 'actors', [
            {
                id: 'human',
                projectId: 'project',
                kind: 'human',
                displayName: 'Benchmark editor',
            },
            {
                id: 'system',
                projectId: 'project',
                kind: 'system',
                displayName: 'Benchmark worker',
            },
        ])
        const owned = await seedWorkspaceChannel(database, {
            projectId: 'project',
            channelId: 'channel',
            name: 'Benchmark channel',
            profileVersionId,
            profile: fixtureProfile,
            createdByActorId: 'human',
        })
        await insertRow(database, 'publishers', {
            id: 'publisher',
            workspaceId: owned.workspaceId,
            channelId: 'channel',
            kind: 'fixture',
        })

        for (let index = 0; index < count; index++) {
            await insertRow(database, 'posts', {
                id: `post-${index}`,
                projectId: 'project',
                sourceContent: {
                    body: { text: 'Benchmark post', format: 'plain_text' },
                    media: [],
                },
                sourceRevision: 1,
                createdByActorId: 'human',
            })
            await insertRow(database, 'publications', {
                id: `publication-${index}`,
                projectId: 'project',
                postId: `post-${index}`,
                channelId: 'channel',
                targetRevisionId: `target-${index}`,
                deliveryMode: 'automatic',
                reviewState: 'compatible',
                state: 'scheduled',
                scheduledAt: dueAt,
                createdByActorId: 'human',
                scheduledByActorId: 'human',
                stateChangedByActorId: 'human',
            })
            await insertRow(database, 'publication_target_revisions', {
                id: `target-${index}`,
                projectId: 'project',
                publicationId: `publication-${index}`,
                sequence: 1,
                profileVersionId,
                sourceRevision: 1,
                deliveryMode: 'automatic',
                contentJson: { body: 'Benchmark publication' },
                contentHash: 'sha256:benchmark-content',
                profileHash: fixtureProfile.profileHash,
                schemaHash: fixtureProfile.schemaHash,
                validationIssuesJson: [],
                createdByActorId: 'human',
            })
            await insertRow(database, 'jobs', {
                id: `job-${index}`,
                projectId: 'project',
                publicationId: `publication-${index}`,
                state: 'pending',
                runAt: dueAt,
            })
        }
    })
}
