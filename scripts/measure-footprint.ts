import { mkdtemp, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

const API_ARTIFACT_BUDGET_BYTES = 15 * 1024 * 1024
const WEB_INITIAL_JS_BUDGET_BYTES = 180 * 1024
const IDLE_RSS_TARGET_KIB = 150 * 1024
const IDLE_RSS_HARD_CEILING_KIB = 250 * 1024
const RUNTIME_SAMPLES = 5
const WARMUP_MILLISECONDS = 1_000
const HEALTH_TIMEOUT_MILLISECONDS = 5_000

interface ViteManifestChunk {
    file: string
    imports?: string[]
    isEntry?: boolean
}

type ViteManifest = Record<string, ViteManifestChunk>

interface RuntimeSample {
    startupMilliseconds: number
    idleRssKib: number
}

interface PublicationJobSample {
    beforeJobPeakRssKib: number
    peakRssKib: number
    peakIncreaseKib: number
}

function median(values: number[]) {
    const sorted = values.toSorted((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)

    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function round(value: number) {
    return Math.round(value * 100) / 100
}

async function findAvailablePort() {
    const reservation = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 503 }),
    })
    const port = reservation.port
    await reservation.stop(true)

    return port
}

async function readIdleRssKib(processId: number) {
    const status = await Bun.file(`/proc/${processId}/status`).text()
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)

    if (!match) {
        throw new Error(`Could not read VmRSS for process ${processId}`)
    }

    return Number(match[1])
}

async function measureRuntimeSample(databaseFilename: string): Promise<RuntimeSample> {
    const port = await findAvailablePort()
    const baseURL = `http://127.0.0.1:${port}`
    const startedAt = performance.now()
    const child = Bun.spawn(['bun', 'apps/api/dist/index.js'], {
        cwd: import.meta.dir.replace(/\/scripts$/, ''),
        env: {
            ...Bun.env,
            BETTER_AUTH_SECRET: 'herald-footprint-secret-with-at-least-32-characters',
            BETTER_AUTH_URL: baseURL,
            DB_FILE_NAME: databaseFilename,
            PORT: String(port),
        },
        stderr: 'pipe',
        stdout: 'ignore',
    })

    try {
        while (performance.now() - startedAt < HEALTH_TIMEOUT_MILLISECONDS) {
            if (child.exitCode !== null) {
                break
            }

            try {
                const response = await fetch(`${baseURL}/health`)

                if (response.ok) {
                    const startupMilliseconds = performance.now() - startedAt
                    await Bun.sleep(WARMUP_MILLISECONDS)

                    return {
                        startupMilliseconds: round(startupMilliseconds),
                        idleRssKib: await readIdleRssKib(child.pid),
                    }
                }
            } catch {
                // The server is still starting.
            }

            await Bun.sleep(5)
        }

        throw new Error(`API did not become healthy within ${HEALTH_TIMEOUT_MILLISECONDS} ms`)
    } finally {
        child.kill()
        await child.exited
    }
}

async function measurePublicationJobSample(
    fixturePath: string,
    databaseFilename: string
): Promise<PublicationJobSample> {
    const child = Bun.spawn(['bun', fixturePath], {
        cwd: import.meta.dir.replace(/\/scripts$/, ''),
        env: {
            ...Bun.env,
            PUBLICATION_JOB_DB: databaseFilename,
            PUBLICATION_JOB_MIGRATIONS: join(
                import.meta.dir.replace(/\/scripts$/, ''),
                'packages/db/drizzle'
            ),
        },
        stderr: 'pipe',
        stdout: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])

    if (exitCode !== 0) {
        throw new Error(`Publication fixture failed with code ${exitCode}: ${stderr.trim()}`)
    }

    return JSON.parse(stdout) as PublicationJobSample
}

function collectManifestFiles(manifest: ViteManifest, entryKeys: string[]) {
    const files = new Set<string>()
    const visited = new Set<string>()

    function visit(key: string) {
        if (visited.has(key)) return
        visited.add(key)

        const chunk = manifest[key]
        if (!chunk) throw new Error(`Missing Vite manifest entry: ${key}`)

        if (chunk.file.endsWith('.js')) files.add(chunk.file)
        for (const importedKey of chunk.imports ?? []) visit(importedKey)
    }

    for (const key of entryKeys) visit(key)

    return [...files].toSorted()
}

async function measureWebInitialJavaScript() {
    const manifestPath = 'apps/web/dist/.vite/manifest.json'
    const manifest = (await Bun.file(manifestPath).json()) as ViteManifest
    const applicationEntry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)?.[0]
    const indexRouteEntry = Object.keys(manifest).find(key =>
        key.startsWith('src/routes/index.tsx?')
    )

    if (!applicationEntry || !indexRouteEntry) {
        throw new Error('Could not resolve the application and index route entries')
    }

    const files = collectManifestFiles(manifest, [applicationEntry, indexRouteEntry])
    let rawBytes = 0
    let gzipBytes = 0

    for (const file of files) {
        const bytes = await Bun.file(join('apps/web/dist', file)).bytes()
        rawBytes += bytes.byteLength
        gzipBytes += Bun.gzipSync(bytes).byteLength
    }

    return { files, rawBytes, gzipBytes }
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The reference footprint measurement requires Linux x64')
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'herald-footprint-'))

try {
    const fixtureBuild = await Bun.build({
        entrypoints: ['scripts/fixtures/publication-job.ts'],
        outdir: temporaryDirectory,
        target: 'bun',
        minify: true,
    })
    if (!fixtureBuild.success) {
        throw new AggregateError(fixtureBuild.logs, 'Could not build the publication fixture')
    }

    const fixturePath = join(temporaryDirectory, 'publication-job.js')
    const apiArtifactBytes = Bun.file('apps/api/dist/index.js').size
    const web = await measureWebInitialJavaScript()
    const runtimeSamples: RuntimeSample[] = []
    const publicationJobSamples: PublicationJobSample[] = []

    for (let index = 0; index < RUNTIME_SAMPLES; index += 1) {
        runtimeSamples.push(
            await measureRuntimeSample(join(temporaryDirectory, `sample-${index}.sqlite`))
        )
        publicationJobSamples.push(
            await measurePublicationJobSample(
                fixturePath,
                join(temporaryDirectory, `publication-job-${index}.sqlite`)
            )
        )
    }

    const startupSamples = runtimeSamples.map(sample => sample.startupMilliseconds)
    const rssSamples = runtimeSamples.map(sample => sample.idleRssKib)
    const publicationJobPeakSamples = publicationJobSamples.map(sample => sample.peakRssKib)
    const publicationJobIncreaseSamples = publicationJobSamples.map(
        sample => sample.peakIncreaseKib
    )
    const result = {
        environment: {
            platform: process.platform,
            architecture: process.arch,
            cpu: cpus()[0]?.model ?? 'unknown',
            bunVersion: Bun.version,
        },
        method: {
            command: 'bun run measure:footprint',
            buildMode: 'production',
            fixture: 'empty SQLite database per runtime sample',
            publicationJobFixture: 'one confirmed no-network publication through SQLite',
            runtimeSamples: RUNTIME_SAMPLES,
            warmupMilliseconds: WARMUP_MILLISECONDS,
        },
        metrics: {
            apiArtifact: {
                bytes: apiArtifactBytes,
                budgetBytes: API_ARTIFACT_BUDGET_BYTES,
                withinBudget: apiArtifactBytes <= API_ARTIFACT_BUDGET_BYTES,
            },
            webInitialJavaScript: {
                ...web,
                budgetGzipBytes: WEB_INITIAL_JS_BUDGET_BYTES,
                withinBudget: web.gzipBytes <= WEB_INITIAL_JS_BUDGET_BYTES,
            },
            coldStartToHealthy: {
                samplesMilliseconds: startupSamples,
                medianMilliseconds: round(median(startupSamples)),
            },
            idleResidentMemory: {
                samplesKib: rssSamples,
                medianKib: round(median(rssSamples)),
                maximumKib: Math.max(...rssSamples),
                targetKib: IDLE_RSS_TARGET_KIB,
                hardCeilingKib: IDLE_RSS_HARD_CEILING_KIB,
                withinTarget: Math.max(...rssSamples) <= IDLE_RSS_TARGET_KIB,
                withinHardCeiling: Math.max(...rssSamples) <= IDLE_RSS_HARD_CEILING_KIB,
            },
            publicationJobPeakResidentMemory: {
                samplesKib: publicationJobPeakSamples,
                medianKib: round(median(publicationJobPeakSamples)),
                maximumKib: Math.max(...publicationJobPeakSamples),
                increaseSamplesKib: publicationJobIncreaseSamples,
                medianIncreaseKib: round(median(publicationJobIncreaseSamples)),
            },
        },
    }

    console.log(JSON.stringify(result, null, 2))
} finally {
    await rm(temporaryDirectory, { recursive: true })
}
