import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    actors,
    channelProfileVersions,
    channels,
    closeDatabase,
    createAnalyticsStore,
    createDatabase,
    publishers,
    projects,
    runMigrations,
} from '../packages/db/src'

const benchmarkBaseTime = 1_800_000_000_000
const benchmarkScales = [1_000, 5_000, 20_000]
const queryWarmups = 2
const querySamples = 9
const legacyEvery = 5
const unknownVersionEvery = 250
const unsupportedFactOffset = 125

const benchmarkProfile = {
    id: 'analytics-benchmark-profile',
    version: 1,
    profileHash: 'sha256:analytics-benchmark-profile-v1',
    schemaHash: 'sha256:analytics-benchmark-schema-v1',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { body: { type: 'string' as const, minLength: 1 } },
        required: ['body'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'body', semantic: 'primary_text' as const, path: '/body' }],
    capabilities: {
        revision: 'analytics-benchmark-v1',
        textFields: [
            {
                bindingId: 'body',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 1_000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: {
        kind: 'built_in' as const,
        contractId: 'analytics-benchmark',
        revision: 'v1',
    },
}

interface BenchmarkFixture {
    readonly projectId: string
    readonly subjectId: string
    readonly from: number
    readonly to: number
    readonly publicationCount: number
    readonly factCount: number
    readonly legacyPublicationCount: number
    readonly unknownVersionFactCount: number
    readonly unsupportedFactCount: number
}

interface QuerySample {
    readonly milliseconds: number
    readonly rssKiB: number
    readonly heapUsedBytes: number
}

interface BenchmarkMeasurement {
    readonly publicationCount: number
    readonly factCount: number
    readonly databaseBytes: number
    readonly legacyPublicationCount: number
    readonly unknownVersionFactCount: number
    readonly unsupportedFactCount: number
    readonly result: {
        readonly currentPublicationCount: number
        readonly historicalCreated: number
        readonly historicalPublished: number
        readonly executionSucceeded: number
        readonly coverage: {
            readonly skippedFactCount: number
            readonly unknownEventVersions: number
            readonly unsupportedFacts: number
            readonly missingHistoricalDimensions: number
            readonly incompleteLatencyPairs: number
            readonly incompleteQueueDelayPairs: number
        }
    }
    readonly latencyMilliseconds: Summary
    readonly firstQueryMilliseconds: number
    readonly memory: {
        readonly rssBeforeQueryKiB: number
        readonly rssAfterFirstQueryKiB: number
        readonly rssAfterQueryKiB: number
        readonly firstQueryRssDeltaKiB: number
        readonly rssDeltaKiB: number
        readonly peakRssDeltaKiB: number | null
        readonly heapBeforeQueryBytes: number
        readonly heapAfterFirstQueryBytes: number
        readonly heapAfterQueryBytes: number
        readonly firstQueryHeapDeltaBytes: number
        readonly heapDeltaBytes: number
    }
}

interface Summary {
    readonly min: number
    readonly median: number
    readonly p95: number
    readonly max: number
}

async function main() {
    const workerIndex = process.argv.indexOf('--measure')
    if (workerIndex >= 0) {
        const databasePath = process.argv[workerIndex + 1]
        const publicationCount = Number(process.argv[workerIndex + 2])
        if (!databasePath || !Number.isSafeInteger(publicationCount) || publicationCount < 1) {
            throw new Error('Usage: --measure <database path> <publication count>')
        }

        const measurement = await measureDatabase(databasePath, publicationCount)
        console.log(JSON.stringify(measurement))
        return
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'postbot-analytics-benchmark-'))

    try {
        const measurements: BenchmarkMeasurement[] = []
        for (const publicationCount of benchmarkScales) {
            const databasePath = join(temporaryDirectory, `analytics-${publicationCount}.sqlite`)
            const fixture = seedDatabase(databasePath, publicationCount)
            const databaseBytes = Bun.file(databasePath).size
            const measurement = await measureInChildProcess(
                databasePath,
                publicationCount,
                databaseBytes,
                fixture
            )
            measurements.push(measurement)
        }

        console.log(JSON.stringify({ benchmark: 'analytics-read-model-v1', measurements }, null, 2))
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true })
    }
}

function seedDatabase(databasePath: string, publicationCount: number): BenchmarkFixture {
    const database = createDatabase(databasePath)
    const projectId = 'analytics-benchmark-project'
    const subjectId = 'analytics-benchmark-user'
    const actorId = 'analytics-benchmark-actor'
    const channelId = 'analytics-benchmark-channel'
    const publisherId = 'analytics-benchmark-publisher'
    const profileVersionId = 'analytics-benchmark-profile-version'
    const from = benchmarkBaseTime
    const to = benchmarkBaseTime + publicationCount * 10 + 20

    try {
        runMigrations(database)
        database
            .insert(projects)
            .values({
                id: projectId,
                name: 'Analytics benchmark project',
                timeZone: 'UTC',
                createdAt: from,
                updatedAt: from,
            })
            .run()
        database
            .insert(actors)
            .values({
                id: actorId,
                projectId,
                kind: 'human',
                subjectId,
                displayName: 'Analytics benchmark operator',
                createdAt: from,
                updatedAt: from,
            })
            .run()
        database.$client.run('PRAGMA foreign_keys = OFF')
        try {
            database
                .insert(channelProfileVersions)
                .values({
                    id: profileVersionId,
                    projectId,
                    channelId,
                    profileId: benchmarkProfile.id,
                    version: benchmarkProfile.version,
                    origin: benchmarkProfile.origin,
                    state: 'active',
                    profileJson: benchmarkProfile,
                    profileHash: benchmarkProfile.profileHash,
                    schemaHash: benchmarkProfile.schemaHash,
                    createdByActorId: actorId,
                    createdAt: from,
                    updatedAt: from,
                })
                .run()
            database
                .insert(channels)
                .values({
                    id: channelId,
                    projectId,
                    name: 'Analytics benchmark channel',
                    profileVersionId,
                    state: 'active',
                    revision: 1,
                    createdAt: from,
                    updatedAt: from,
                })
                .run()
        } finally {
            database.$client.run('PRAGMA foreign_keys = ON')
        }
        database
            .insert(publishers)
            .values({
                id: publisherId,
                projectId,
                channelId,
                kind: 'benchmark-provider',
                createdAt: from,
                updatedAt: from,
            })
            .run()

        const client = database.$client
        const insertPost = client.query(
            `insert into posts (id, project_id, source_content, source_revision, created_by_actor_id, created_at, updated_at)
             values (?1, ?2, ?3, 1, ?4, ?5, ?5)`
        )
        const insertPublication = client.query(
            `insert into publications (
                id, project_id, post_id, channel_id, target_revision_id, delivery_mode,
                review_state, state, scheduled_at, published_at, created_by_actor_id,
                scheduled_by_actor_id, state_changed_by_actor_id, published_by_actor_id,
                profile_assessment_issues_json, created_at, updated_at
            ) values (?1, ?2, ?3, ?4, null, 'automatic', 'compatible', 'published',
                ?5, ?6, ?7, ?7, ?7, ?7, '[]', ?8, ?8)`
        )
        const insertJob = client.query(
            `insert into jobs (
                id, project_id, publication_id, state, run_at, attempts,
                started_at, completed_at, created_at, updated_at
            ) values (?1, ?2, ?3, 'succeeded', ?4, 1, ?5, ?6, ?7, ?6)`
        )
        const insertAuditEvent = client.query(
            `insert into audit_events (
                id, project_id, actor_id, action, entity_type, entity_id, metadata_json,
                event_version, created_at
            ) values (?1, ?2, ?3, ?4, 'publication', ?5, ?6, ?7, ?8)`
        )

        const legacyPublicationCount = countMatching(
            publicationCount,
            index => index % legacyEvery === 0
        )
        const unknownVersionFactCount = countMatching(
            publicationCount,
            index => index % unknownVersionEvery === 0
        )
        const unsupportedFactCount = countMatching(
            publicationCount,
            index => index % unknownVersionEvery === unsupportedFactOffset
        )
        let factCount = 0
        let eventSequence = 0

        const seed = client.transaction(() => {
            for (let index = 0; index < publicationCount; index += 1) {
                const publicationNumber = index + 1
                const createdAt = from + publicationNumber * 10
                const runAt = createdAt + 3
                const effectStartedAt = createdAt + 4
                const completedAt = createdAt + 5
                const postId = `analytics-benchmark-post-${publicationNumber}`
                const publicationId = `analytics-benchmark-publication-${publicationNumber}`
                const jobId = `analytics-benchmark-job-${publicationNumber}`
                const legacy = index % legacyEvery === 0
                const commonMetadata = legacy
                    ? { deliveryMode: 'automatic' }
                    : {
                          channelId,
                          deliveryMode: 'automatic',
                          provider: 'benchmark-provider',
                      }

                insertPost.run(
                    postId,
                    projectId,
                    JSON.stringify({
                        body: {
                            text: `Analytics benchmark ${publicationNumber}`,
                            format: 'plain_text',
                        },
                        media: [],
                    }),
                    actorId,
                    createdAt
                )
                insertPublication.run(
                    publicationId,
                    projectId,
                    postId,
                    channelId,
                    runAt,
                    completedAt,
                    actorId,
                    createdAt
                )
                insertJob.run(
                    jobId,
                    projectId,
                    publicationId,
                    runAt,
                    effectStartedAt,
                    completedAt,
                    createdAt
                )

                const append = (
                    action: string,
                    metadata: Readonly<Record<string, unknown>>,
                    occurredAt: number,
                    version = 1
                ) => {
                    eventSequence += 1
                    factCount += 1
                    insertAuditEvent.run(
                        `analytics-benchmark-event-${eventSequence}`,
                        projectId,
                        actorId,
                        action,
                        publicationId,
                        JSON.stringify(metadata),
                        version,
                        occurredAt
                    )
                }

                append(
                    'publication.created',
                    {
                        ...commonMetadata,
                        state: 'scheduled',
                        ...(legacy ? {} : { scheduledAt: createdAt + 1 }),
                    },
                    createdAt
                )
                append(
                    'publication.execution.claimed',
                    {
                        ...commonMetadata,
                        jobId,
                        attempt: 1,
                        ...(legacy ? {} : { runAt }),
                    },
                    createdAt + 2
                )
                append(
                    'publication.execution.effect_started',
                    {
                        ...commonMetadata,
                        jobId,
                        attempt: 1,
                        toState: 'publishing',
                        ...(legacy ? {} : { runAt }),
                    },
                    effectStartedAt
                )
                append(
                    'publication.execution.succeeded',
                    {
                        ...commonMetadata,
                        jobId,
                        attempt: 1,
                        toState: 'published',
                        ...(legacy ? {} : { runAt }),
                    },
                    completedAt
                )

                if (index % unknownVersionEvery === 0) {
                    append(
                        'publication.execution.succeeded',
                        { ...commonMetadata, jobId, attempt: 1 },
                        completedAt + 1,
                        2
                    )
                }
                if (index % unknownVersionEvery === unsupportedFactOffset) {
                    append('benchmark.unsupported_fact', {}, completedAt + 2)
                }
            }
        })
        seed()

        return {
            projectId,
            subjectId,
            from,
            to,
            publicationCount,
            factCount,
            legacyPublicationCount,
            unknownVersionFactCount,
            unsupportedFactCount,
        }
    } finally {
        closeDatabase(database)
    }
}

async function measureInChildProcess(
    databasePath: string,
    publicationCount: number,
    databaseBytes: number,
    fixture: BenchmarkFixture
): Promise<BenchmarkMeasurement> {
    const child = Bun.spawn(
        ['bun', import.meta.path, '--measure', databasePath, String(publicationCount)],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        }
    )
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    if (exitCode !== 0) {
        throw new Error(`Analytics benchmark worker failed with code ${exitCode}: ${stderr.trim()}`)
    }

    const output = stdout.trim().split('\n').filter(Boolean).at(-1)
    if (!output) throw new Error('Analytics benchmark worker returned no measurement')

    return {
        ...(JSON.parse(output) as Omit<
            BenchmarkMeasurement,
            | 'databaseBytes'
            | 'legacyPublicationCount'
            | 'unknownVersionFactCount'
            | 'unsupportedFactCount'
        >),
        databaseBytes,
        legacyPublicationCount: fixture.legacyPublicationCount,
        unknownVersionFactCount: fixture.unknownVersionFactCount,
        unsupportedFactCount: fixture.unsupportedFactCount,
    }
}

async function measureDatabase(
    databasePath: string,
    publicationCount: number
): Promise<
    Omit<
        BenchmarkMeasurement,
        | 'databaseBytes'
        | 'legacyPublicationCount'
        | 'unknownVersionFactCount'
        | 'unsupportedFactCount'
    >
> {
    const database = createDatabase(databasePath)
    const projectId = 'analytics-benchmark-project'
    const subjectId = 'analytics-benchmark-user'
    const from = benchmarkBaseTime
    const to = benchmarkBaseTime + publicationCount * 10 + 20
    const input = { projectId, subjectId, from, to }
    const analyticsStore = createAnalyticsStore(database, { now: () => to })

    try {
        collectGarbage()
        const rssBeforeQueryKiB = await readRssKiB()
        const peakBeforeQueryKiB = await readPeakRssKiB()
        const heapBeforeQueryBytes = process.memoryUsage().heapUsed
        const firstQueryStartedAt = performance.now()
        const firstQuery = analyticsStore.getProjectAnalytics(input)
        const firstQueryMilliseconds = round(performance.now() - firstQueryStartedAt)
        if (firstQuery === null) throw new Error('Benchmark project is not accessible')
        assertExpectedResult(firstQuery, publicationCount)
        collectGarbage()
        const rssAfterFirstQueryKiB = await readRssKiB()
        const heapAfterFirstQueryBytes = process.memoryUsage().heapUsed

        for (let index = 0; index < queryWarmups; index += 1) {
            const result = analyticsStore.getProjectAnalytics(input)
            if (result === null) throw new Error('Analytics read model lost project access')
            assertExpectedResult(result, publicationCount)
        }

        const samples: QuerySample[] = []
        let latest = firstQuery
        for (let index = 0; index < querySamples; index += 1) {
            const startedAt = performance.now()
            const result = analyticsStore.getProjectAnalytics(input)
            const finishedAt = performance.now()
            if (result === null) throw new Error('Analytics read model returned null')
            assertExpectedResult(result, publicationCount)
            latest = result
            samples.push({
                milliseconds: round(finishedAt - startedAt),
                rssKiB: await readRssKiB(),
                heapUsedBytes: process.memoryUsage().heapUsed,
            })
        }

        collectGarbage()
        const rssAfterQueryKiB = await readRssKiB()
        const peakAfterQueryKiB = await readPeakRssKiB()
        const heapAfterQueryBytes = process.memoryUsage().heapUsed
        return {
            publicationCount,
            factCount:
                database.$client
                    .query<{ readonly count: number }, [projectId: string]>(
                        'select count(*) as count from audit_events where project_id = ?1'
                    )
                    .get(projectId)?.count ?? 0,
            result: {
                currentPublicationCount: latest.current.publications.total,
                historicalCreated: latest.historical.publications.created,
                historicalPublished: latest.historical.publications.published,
                executionSucceeded: latest.historical.executions.succeeded,
                coverage: {
                    skippedFactCount: latest.coverage.skippedFactCount,
                    unknownEventVersions: latest.coverage.dataQuality.unknownEventVersions,
                    unsupportedFacts: latest.coverage.dataQuality.unsupportedFacts,
                    missingHistoricalDimensions:
                        latest.coverage.dataQuality.missingHistoricalDimensions,
                    incompleteLatencyPairs: latest.coverage.dataQuality.incompleteLatencyPairs,
                    incompleteQueueDelayPairs:
                        latest.coverage.dataQuality.incompleteQueueDelayPairs,
                },
            },
            latencyMilliseconds: summarize(samples.map(sample => sample.milliseconds)),
            firstQueryMilliseconds,
            memory: {
                rssBeforeQueryKiB,
                rssAfterFirstQueryKiB,
                rssAfterQueryKiB,
                firstQueryRssDeltaKiB: rssAfterFirstQueryKiB - rssBeforeQueryKiB,
                rssDeltaKiB: rssAfterQueryKiB - rssBeforeQueryKiB,
                peakRssDeltaKiB:
                    peakBeforeQueryKiB === null || peakAfterQueryKiB === null
                        ? null
                        : peakAfterQueryKiB - peakBeforeQueryKiB,
                heapBeforeQueryBytes,
                heapAfterFirstQueryBytes,
                heapAfterQueryBytes,
                firstQueryHeapDeltaBytes: heapAfterFirstQueryBytes - heapBeforeQueryBytes,
                heapDeltaBytes: heapAfterQueryBytes - heapBeforeQueryBytes,
            },
        }
    } finally {
        closeDatabase(database)
    }
}

function collectGarbage(): void {
    Bun.gc(true)
}

function assertExpectedResult(
    result: NonNullable<ReturnType<ReturnType<typeof createAnalyticsStore>['getProjectAnalytics']>>,
    publicationCount: number
) {
    if (result.current.publications.total !== publicationCount) {
        throw new Error(
            `Expected ${publicationCount} current publications, got ${result.current.publications.total}`
        )
    }
    if (result.historical.publications.created !== publicationCount) {
        throw new Error(
            `Expected ${publicationCount} created publications, got ${result.historical.publications.created}`
        )
    }
    if (result.historical.publications.published !== publicationCount) {
        throw new Error(
            `Expected ${publicationCount} published publications, got ${result.historical.publications.published}`
        )
    }
    if (result.historical.executions.succeeded !== publicationCount) {
        throw new Error(
            `Expected ${publicationCount} successful executions, got ${result.historical.executions.succeeded}`
        )
    }
}

function countMatching(count: number, predicate: (index: number) => boolean): number {
    let matches = 0
    for (let index = 0; index < count; index += 1) {
        if (predicate(index)) matches += 1
    }
    return matches
}

function summarize(values: readonly number[]): Summary {
    const sorted = values.toSorted((left, right) => left - right)
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
    return {
        min: sorted[0] ?? 0,
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        p95: sorted[p95Index] ?? 0,
        max: sorted.at(-1) ?? 0,
    }
}

function round(value: number): number {
    return Math.round(value * 100) / 100
}

async function readRssKiB(): Promise<number> {
    const status = await Bun.file('/proc/self/status')
        .text()
        .catch(() => '')
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
    if (match) return Number(match[1])
    return Math.round(process.memoryUsage().rss / 1024)
}

async function readPeakRssKiB(): Promise<number | null> {
    const status = await Bun.file('/proc/self/status')
        .text()
        .catch(() => '')
    const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status)
    return match ? Number(match[1]) : null
}

await main()
