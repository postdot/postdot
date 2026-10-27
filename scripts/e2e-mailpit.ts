import { basename, resolve } from 'node:path'

import { isSafeE2EDataDirectory, type E2ERuntimeResources } from './e2e-runtime'

export async function startE2EMailpit(
    runtime: E2ERuntimeResources,
    environment: NodeJS.ProcessEnv = process.env
): Promise<() => Promise<void>> {
    if (!isSafeE2EDataDirectory(runtime.dataDirectory) || runtime.mailpit === undefined) {
        throw new Error('Mailpit requires an isolated Postdot E2E runtime directory')
    }

    const projectName = `postdot-${basename(runtime.dataDirectory).toLowerCase()}`
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
        ...environment,
        POSTDOT_MAILPIT_SMTP_PORT: String(runtime.mailpit.smtpPort),
        POSTDOT_MAILPIT_UI_PORT: String(runtime.mailpit.uiPort),
    }

    const shutdown = async () => {
        const shutdownProcess = Bun.spawn(
            [...composePrefix, 'down', '--timeout', '2', '--remove-orphans'],
            {
                cwd: repositoryRoot,
                env: composeEnvironment,
                stderr: 'inherit',
                stdout: 'inherit',
            }
        )
        const code = await shutdownProcess.exited
        if (code !== 0) throw new Error(`Could not stop the Mailpit E2E service (exit ${code})`)
    }

    const startup = Bun.spawn([...composePrefix, 'up', '--detach', 'mailpit'], {
        cwd: repositoryRoot,
        env: composeEnvironment,
        stderr: 'inherit',
        stdout: 'inherit',
    })
    const startupCode = await startup.exited
    if (startupCode !== 0) {
        await shutdown()
        throw new Error(`Could not start the Mailpit E2E service (exit ${startupCode})`)
    }

    let shutdownPromise: Promise<void> | undefined
    return () => {
        shutdownPromise ??= shutdown()
        return shutdownPromise
    }
}

export async function waitForE2EMailpit(origin: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${origin}/api/v1/info`, {
                signal: AbortSignal.timeout(1_000),
            })
            if (response.ok) return
        } catch {
            // The container can be running before its HTTP listener is ready.
        }
        await Bun.sleep(200)
    }

    throw new Error(`Mailpit did not become ready at ${origin} within ${timeoutMs}ms`)
}
