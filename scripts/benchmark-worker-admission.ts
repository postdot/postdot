import { cpus } from 'node:os'
import { parseArgs } from 'node:util'

import { createPublicationWorker } from '../apps/api/src/modules/workflow/worker'
import { linkedInPublisherConnectionPolicy } from '../apps/api/src/providers/linkedin/connection-policy'
import {
    createManualStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    runMigrations,
} from '../packages/db/src'
import { testEngines } from '../packages/db/src/sql/test-engines'
import { seedTestWorkspace } from '../packages/db/src/testing'
import { linkedinChannelProfile } from '../packages/linkedin/src'

// Disposable databases, synthetic credentials and an injected provider: no remote effects.
const { values } = parseArgs({
    options: {
        seconds: { type: 'string', default: '30' },
        rate: { type: 'string', default: '8' },
        projects: { type: 'string', default: '4' },
        'effect-ms': { type: 'string', default: '100' },
        engine: { type: 'string' },
    },
})
const seconds = Number(values.seconds)
const rate = Number(values.rate)
const projectCount = Number(values.projects)
const effectMs = Number(values['effect-ms'])
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 300) throw new Error('seconds: 5–300')
if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error('rate: >0–100')
if (!Number.isInteger(projectCount) || projectCount < 1 || projectCount > 20)
    throw new Error('projects: 1–20')
if (!Number.isFinite(effectMs) || effectMs < 0 || effectMs > 5_000)
    throw new Error('effect-ms: 0–5000')
const engines = testEngines.filter(engine => !values.engine || engine.name === values.engine)
if (!engines.length)
    throw new Error('Requested engine unavailable; PostgreSQL needs POSTDOT_TEST_POSTGRES_URL')
const percentile = (samples: number[], fraction: number) => {
    const sorted = [...samples].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null
}
const results = []
for (const engine of engines) {
    const opened = await engine.open()
    const database = opened.database
    let worker: ReturnType<typeof createPublicationWorker> | undefined
    try {
        await runMigrations(database)
        let creationTime = Date.now()
        const settings =
            engine.name === 'postgres'
                ? await database.sql
                      .statement(
                          "select version(), current_setting('fsync') as fsync, current_setting('synchronous_commit') as synchronous_commit, current_setting('jit') as jit"
                      )
                      .get()
                : {
                      journalMode: await database.sql.statement('pragma journal_mode').get(),
                      synchronous: await database.sql.statement('pragma synchronous').get(),
                  }
        const manual = createManualStore(database, { now: () => creationTime })
        const credentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'benchmark',
                key: new Uint8Array(32).fill(11),
            }),
        })
        const publisherStore = createPublisherStore(database, {
            credentialRevoker: credentials,
            connectionPolicies: { linkedin: linkedInPublisherConnectionPolicy },
        })
        const projects = []
        for (let index = 0; index < projectCount; index++) {
            const created = await manual.createProject({
                workspaceId: await seedTestWorkspace(database),
                name: `Benchmark ${index}`,
                subjectId: 'operator',
                displayName: 'Benchmark editor',
            })
            const projectId = created.project.id
            const channel = await manual.createChannel({
                projectId,
                subjectId: 'operator',
                name: 'Synthetic provider',
                profile: linkedinChannelProfile,
            })
            if (!channel) throw new Error('Channel fixture failed')
            const credential = await credentials.createPublisherCredential({
                projectId,
                connectedByActorId: created.actor.id,
                providerId: 'linkedin',
                externalAccountId: `benchmark-${index}`,
                scopes: ['openid', 'profile', 'w_member_social'],
                accessToken: 'synthetic',
            })
            if (credential.kind !== 'created') throw new Error('Credential fixture failed')
            const connection = await publisherStore.createPublisherConnection({
                projectId,
                channelId: channel.id,
                subjectId: 'operator',
                kind: 'linkedin',
                credentialId: credential.credential.id,
            })
            if (connection.kind !== 'created') throw new Error('Publisher fixture failed')
            projects.push({ projectId, channelId: channel.id })
        }
        await database.sql.exec('ANALYZE')
        const active = new Set<string>()
        const starts: {
            projectId: string
            offeredAtMs: number
            startedAtMs: number
            endedAtMs: number
        }[] = []
        const errors: string[] = []
        const enqueueMs: number[] = []
        const producerLagMs: number[] = []
        let maximumActive = 0
        let admissionViolations = 0
        let created = 0
        let finished = 0
        let completedDuringArrivals = 0
        const started = performance.now()
        worker = createPublicationWorker({
            database,
            publisherStore,
            publisherCredentialStore: credentials,
            onError: error => {
                errors.push(error instanceof Error ? error.message : String(error))
                console.error(error)
            },
            builtInProviderRegistry: {
                resolve: () => ({
                    providerId: 'linkedin',
                    contractId: 'linkedin',
                    revision: 'benchmark',
                    async execute(input) {
                        const projectId = input.target.projectId
                        if (active.has(projectId) || active.size >= 2) admissionViolations++
                        active.add(projectId)
                        maximumActive = Math.max(maximumActive, active.size)
                        const sample = {
                            projectId,
                            offeredAtMs: Number(input.target.content.commentary),
                            startedAtMs: performance.now() - started,
                            endedAtMs: 0,
                        }
                        starts.push(sample)
                        try {
                            await Bun.sleep(effectMs)
                            sample.endedAtMs = performance.now() - started
                            finished++
                            return {
                                type: 'published',
                                externalId: `benchmark-${sample.offeredAtMs}`,
                            }
                        } finally {
                            active.delete(projectId)
                        }
                    },
                }),
            },
        })
        await worker.start()
        // Open-loop schedule: retain intended timestamps if insertion falls behind.
        // Sequential writes bound the producer; record its lag instead of hiding overload.
        const count = Math.floor(seconds * rate)
        for (let index = 0; index < count; index++) {
            const offeredAtMs = (index * 1_000) / rate
            await Bun.sleep(Math.max(0, started + offeredAtMs - performance.now()))
            const project = projects[index % projects.length]!
            const before = performance.now()
            creationTime = Date.now()
            const post = await manual.createPost({
                projectId: project.projectId,
                subjectId: 'operator',
                sourceContent: {
                    body: { text: String(offeredAtMs), format: 'plain_text' },
                    media: [],
                },
                publications: [
                    {
                        channelId: project.channelId,
                        deliveryMode: 'automatic',
                        scheduledAt: creationTime,
                    },
                ],
            })
            if (!post) throw new Error('Enqueue fixture failed')
            created++
            enqueueMs.push(performance.now() - before)
            producerLagMs.push(performance.now() - started - offeredAtMs)
            await worker.replan()
        }
        await Bun.sleep(Math.max(0, started + seconds * 1_000 - performance.now()))
        const arrivalElapsedMs = performance.now() - started
        const schedulerStateAfterArrivals = worker.scheduler.state
        completedDuringArrivals = finished
        const deadline = performance.now() + 120_000
        while (finished < created && performance.now() < deadline && !errors.length)
            await Bun.sleep(20)
        const schedulerStateBeforeStop = worker.scheduler.state
        await worker.stop()
        const elapsedMs = performance.now() - started
        const states = await database.sql
            .statement<{ state: string; count: number }>(
                'select state, count(*) as count from jobs group by state'
            )
            .all()
        const result = {
            engine: engine.name,
            seconds,
            settings,
            rate,
            projects: projectCount,
            effectMs,
            created,
            arrivalElapsedMs,
            schedulerStateAfterArrivals,
            schedulerStateBeforeStop,
            completedDuringArrivals,
            outstandingAfterArrivals: created - completedDuringArrivals,
            completed: finished,
            elapsedMs,
            maximumActive,
            admissionViolations,
            errors,
            states,
            enqueueP95Ms: percentile(enqueueMs, 0.95),
            producerLagP95Ms: percentile(producerLagMs, 0.95),
            queueWaitP50Ms: percentile(
                starts.map(s => s.startedAtMs - s.offeredAtMs),
                0.5
            ),
            queueWaitP95Ms: percentile(
                starts.map(s => s.startedAtMs - s.offeredAtMs),
                0.95
            ),
            starts,
        }
        results.push(result)
        console.error(JSON.stringify({ ...result, starts: undefined }))
        if (
            errors.length ||
            admissionViolations ||
            states.some(row => row.state !== 'succeeded') ||
            finished !== created
        )
            process.exitCode = 1
    } finally {
        try {
            await worker?.stop()
        } finally {
            await opened.close()
        }
    }
}
console.log(
    JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            runtime: Bun.version,
            cpu: cpus()[0]?.model,
            scope: 'Actual API worker and scheduler; two projects globally, one effect per project. Synthetic provider latency, publication family only, no HTTP/media/network or provider limits. Statistics refreshed before arrivals; no warmup. Offered timestamps include producer lag. Completion counts are provider returns; final job states verify persistence.',
            results,
        },
        null,
        2
    )
)
