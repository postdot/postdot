import { basename, resolve } from 'node:path'

import { isSafeE2EDataDirectory } from './e2e-runtime'

const dataDirectory = Bun.env.HERALD_E2E_DATA_DIRECTORY
if (!isSafeE2EDataDirectory(dataDirectory)) {
    throw new Error('Mailpit requires an isolated Herald E2E runtime directory')
}

const smtpPort = requiredPort(Bun.env.HERALD_E2E_MAILPIT_SMTP_PORT)
const uiPort = requiredPort(Bun.env.HERALD_E2E_MAILPIT_UI_PORT)
const projectName = `herald-${basename(dataDirectory).toLowerCase()}`
const repositoryRoot = resolve(import.meta.dir, '..')
const composePrefix = [
    'docker',
    'compose',
    '--project-name',
    projectName,
    '--file',
    resolve(repositoryRoot, 'docker-compose.dev.yml'),
]
const composeEnvironment = {
    ...Bun.env,
    HERALD_MAILPIT_SMTP_PORT: String(smtpPort),
    HERALD_MAILPIT_UI_PORT: String(uiPort),
}

const startup = Bun.spawn([...composePrefix, 'up', '--detach', 'mailpit'], {
    cwd: repositoryRoot,
    env: composeEnvironment,
    stderr: 'inherit',
    stdout: 'inherit',
})
const startupCode = await startup.exited
if (startupCode !== 0) {
    await stopMailpit()
    process.exitCode = startupCode
} else {
    const signal = await new Promise<'SIGINT' | 'SIGTERM'>(resolveSignal => {
        process.once('SIGINT', () => resolveSignal('SIGINT'))
        process.once('SIGTERM', () => resolveSignal('SIGTERM'))
    })
    await stopMailpit()
    process.exitCode = signal === 'SIGINT' ? 130 : 143
}

async function stopMailpit() {
    const shutdown = Bun.spawn([...composePrefix, 'down', '--timeout', '2', '--remove-orphans'], {
        cwd: repositoryRoot,
        env: composeEnvironment,
        stderr: 'inherit',
        stdout: 'inherit',
    })
    return shutdown.exited
}

function requiredPort(value: string | undefined): number {
    const port = Number(value)
    if (value === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('Mailpit E2E ports must be valid TCP ports')
    }
    return port
}
