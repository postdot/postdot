import { createExponentialRetryPolicy, processNextWorkflowEvent } from '../../packages/core/src'
import {
    actors,
    channelProfileVersions,
    channels,
    closeDatabase,
    createDatabase,
    createWorkflowStore,
    jobs,
    posts,
    projects,
    publicationTargetRevisions,
    publications,
    publishers,
    runMigrations,
} from '../../packages/db/src'

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
    runMigrations(database, migrationsFolder)
    database.insert(projects).values({ id: 'project', name: 'Footprint project' }).run()
    database
        .insert(actors)
        .values([
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
        .run()
    database
        .insert(channels)
        .values({
            id: 'channel',
            projectId: 'project',
            name: 'Footprint channel',
            profileVersionId,
        })
        .run()
    database
        .insert(channelProfileVersions)
        .values({
            id: profileVersionId,
            projectId: 'project',
            channelId: 'channel',
            profileId: fixtureProfile.id,
            version: fixtureProfile.version,
            origin: fixtureProfile.origin,
            state: 'active',
            profileJson: fixtureProfile,
            profileHash: fixtureProfile.profileHash,
            schemaHash: fixtureProfile.schemaHash,
            createdByActorId: 'human',
        })
        .run()
    database
        .insert(publishers)
        .values({
            id: 'publisher',
            projectId: 'project',
            channelId: 'channel',
            kind: 'fixture',
        })
        .run()
    database
        .insert(posts)
        .values({
            id: 'post',
            projectId: 'project',
            sourceContent: {
                body: { text: 'Footprint post', format: 'plain_text' },
                media: [],
            },
            sourceRevision: 1,
            createdByActorId: 'human',
        })
        .run()
    database
        .insert(publications)
        .values({
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
        .run()
    database
        .insert(publicationTargetRevisions)
        .values({
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
        .run()
    database
        .insert(jobs)
        .values({
            id: 'job',
            projectId: 'project',
            publicationId: 'publication',
            state: 'pending',
            runAt: dueAt,
        })
        .run()

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
