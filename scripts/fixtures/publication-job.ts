import { createExponentialRetryPolicy, processNextWorkflowEvent } from '../../packages/core/src'
import {
    closeDatabase,
    createDatabase,
    createWorkflowStore,
    runMigrations,
} from '../../packages/db/src'
import { insertRow, seedTestWorkspace, seedWorkspaceChannel } from '../../packages/db/src/testing'

const databaseFilename = Bun.env.PUBLICATION_JOB_DB
if (!databaseFilename) throw new Error('PUBLICATION_JOB_DB is required')
const migrationsFolder = Bun.env.PUBLICATION_JOB_MIGRATIONS
if (!migrationsFolder) throw new Error('PUBLICATION_JOB_MIGRATIONS is required')

const dueAt = 1_800_000_000_000
const profileVersionId = 'profile'
const targetRevisionId = 'target'
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
const database = createDatabase(databaseFilename)

try {
    await runMigrations(database, migrationsFolder)
    await insertRow(database, 'projects', {
        id: 'project',
        name: 'Footprint project',
        workspaceId: await seedTestWorkspace(database),
    })
    await insertRow(database, 'actors', [
        {
            id: 'human',
            projectId: 'project',
            kind: 'human',
            displayName: 'Footprint editor',
        },
        {
            id: 'system',
            projectId: 'project',
            kind: 'system',
            displayName: 'Footprint worker',
        },
    ])
    const owned = await seedWorkspaceChannel(database, {
        projectId: 'project',
        channelId: 'channel',
        name: 'Footprint channel',
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
    await insertRow(database, 'posts', {
        id: 'post',
        projectId: 'project',
        sourceContent: {
            body: { text: 'Footprint post', format: 'plain_text' },
            media: [],
        },
        sourceRevision: 1,
        createdByActorId: 'human',
    })
    await insertRow(database, 'publications', {
        id: 'publication',
        projectId: 'project',
        postId: 'post',
        channelId: 'channel',
        targetRevisionId,
        deliveryMode: 'automatic',
        reviewState: 'compatible',
        state: 'scheduled',
        scheduledAt: dueAt,
        createdByActorId: 'human',
        scheduledByActorId: 'human',
        stateChangedByActorId: 'human',
    })
    await insertRow(database, 'publication_target_revisions', {
        id: targetRevisionId,
        projectId: 'project',
        publicationId: 'publication',
        sequence: 1,
        profileVersionId,
        sourceRevision: 1,
        deliveryMode: 'automatic',
        contentJson: { body: 'Footprint publication' },
        contentHash: 'sha256:footprint-content',
        profileHash: fixtureProfile.profileHash,
        schemaHash: fixtureProfile.schemaHash,
        validationIssuesJson: [],
        createdByActorId: 'human',
    })
    await insertRow(database, 'jobs', {
        id: 'job',
        projectId: 'project',
        publicationId: 'publication',
        state: 'pending',
        runAt: dueAt,
    })

    const beforeJobPeakRssKib = await readPeakRssKib()
    const result = await processNextWorkflowEvent({
        store: createWorkflowStore(database),
        actorId: 'system',
        leaseDuration: 60_000,
        retryPolicy: createExponentialRetryPolicy({
            maxAttempts: 3,
            initialDelay: 1_000,
            maximumDelay: 60_000,
        }),
        createClaimToken: () => 'footprint-claim',
        performExternalEffect: () => ({
            type: 'published',
            externalId: 'footprint-result',
        }),
        now: () => dueAt,
    })
    const peakRssKib = await readPeakRssKib()

    if (result.outcome !== 'published') {
        throw new Error(`Publication fixture finished with ${result.outcome}`)
    }

    console.log(
        JSON.stringify({
            beforeJobPeakRssKib,
            peakRssKib,
            peakIncreaseKib: peakRssKib - beforeJobPeakRssKib,
        })
    )
} finally {
    closeDatabase(database)
}

async function readPeakRssKib(): Promise<number> {
    const status = await Bun.file('/proc/self/status').text()
    const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status)
    if (!match) throw new Error('Could not read VmHWM for the publication fixture')
    return Number(match[1])
}
