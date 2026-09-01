import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname } from 'node:path'

const dataDirectory = Bun.env.HERALD_E2E_DATA_DIRECTORY
const databaseFile = Bun.env.DB_FILE_NAME

if (
    dataDirectory === undefined ||
    databaseFile === undefined ||
    dirname(databaseFile) !== dataDirectory ||
    dirname(dataDirectory) !== tmpdir() ||
    basename(dataDirectory) !== 'herald-e2e-data'
) {
    throw new Error('The E2E API data directory is not safely configured')
}

const validatedDataDirectory = dataDirectory

await rm(validatedDataDirectory, { recursive: true, force: true })
await mkdir(validatedDataDirectory, { recursive: true })

const server = Bun.spawn(['bun', './apps/api/src/index.ts'], {
    env: { ...Bun.env },
    stderr: 'inherit',
    stdout: 'inherit',
})

let cleanupPromise: Promise<void> | undefined

function cleanup() {
    cleanupPromise ??= rm(validatedDataDirectory, { recursive: true, force: true })
    return cleanupPromise
}

async function stop(signal: NodeJS.Signals) {
    server.kill(signal)
    await server.exited
    await cleanup()
    process.exit(0)
}

process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))

const exitCode = await server.exited
await cleanup()
process.exit(exitCode)
