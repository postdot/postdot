import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const e2eRuntimeDirectoryPrefix = 'postbot-e2e-run-'

export interface E2ERuntimeResources {
    readonly dataDirectory: string
    readonly databaseFile: string
    readonly mediaDirectory: string
    readonly apiPort: number
    readonly webPort: number
    readonly apiOrigin: string
    readonly webOrigin: string
    readonly mailpit?: {
        readonly smtpPort: number
        readonly uiPort: number
    }
}

/**
 * Creates the resources owned by one Playwright invocation.
 *
 * Explicit ports remain available for debugging, but are caller-reserved. In
 * the normal case the operating system supplies free loopback ports so two
 * test invocations do not share a listener, database, or media directory.
 */
export async function createE2ERuntimeResources(
    environment: NodeJS.ProcessEnv = process.env
): Promise<E2ERuntimeResources> {
    const existingDataDirectory = environment.POSTBOT_E2E_DATA_DIRECTORY
    if (existingDataDirectory !== undefined) {
        return resourcesFromEnvironment(environment, existingDataDirectory)
    }

    const dataDirectory = mkdtempSync(join(tmpdir(), e2eRuntimeDirectoryPrefix))

    try {
        const requestedApiPort = parsePort(environment.POSTBOT_E2E_API_PORT, 'POSTBOT_E2E_API_PORT')
        const requestedWebPort = parsePort(environment.POSTBOT_E2E_WEB_PORT, 'POSTBOT_E2E_WEB_PORT')
        const useMailpit = environment.POSTBOT_E2E_MAILPIT === 'true'
        const requestedMailpitSmtpPort = useMailpit
            ? parsePort(environment.POSTBOT_E2E_MAILPIT_SMTP_PORT, 'POSTBOT_E2E_MAILPIT_SMTP_PORT')
            : undefined
        const requestedMailpitUiPort = useMailpit
            ? parsePort(environment.POSTBOT_E2E_MAILPIT_UI_PORT, 'POSTBOT_E2E_MAILPIT_UI_PORT')
            : undefined
        const requestedPorts = new Set(
            [
                requestedApiPort,
                requestedWebPort,
                requestedMailpitSmtpPort,
                requestedMailpitUiPort,
            ].filter((port): port is number => port !== undefined)
        )
        if (
            requestedPorts.size !==
            [
                requestedApiPort,
                requestedWebPort,
                requestedMailpitSmtpPort,
                requestedMailpitUiPort,
            ].filter((port): port is number => port !== undefined).length
        ) {
            throw new Error('E2E API, web, and Mailpit ports must be different')
        }
        const apiPort = requestedApiPort ?? (await findAvailablePort(requestedPorts))
        const usedPorts = new Set(requestedPorts).add(apiPort)
        const webPort = requestedWebPort ?? (await findAvailablePort(usedPorts))

        if (apiPort === webPort) {
            throw new Error(`E2E API and web ports must be different, received ${apiPort}`)
        }

        const mailpitSmtpPort = useMailpit
            ? (requestedMailpitSmtpPort ?? (await findAvailablePort(usedPorts)))
            : undefined
        if (mailpitSmtpPort !== undefined) usedPorts.add(mailpitSmtpPort)
        const mailpitUiPort = useMailpit
            ? (requestedMailpitUiPort ?? (await findAvailablePort(usedPorts)))
            : undefined
        if (mailpitUiPort !== undefined) usedPorts.add(mailpitUiPort)

        return {
            dataDirectory,
            databaseFile: join(dataDirectory, 'postbot.sqlite'),
            mediaDirectory: join(dataDirectory, 'media'),
            apiPort,
            webPort,
            apiOrigin: `http://127.0.0.1:${apiPort}`,
            webOrigin: `http://127.0.0.1:${webPort}`,
            ...(mailpitSmtpPort === undefined || mailpitUiPort === undefined
                ? {}
                : { mailpit: { smtpPort: mailpitSmtpPort, uiPort: mailpitUiPort } }),
        }
    } catch (error) {
        rmSync(dataDirectory, { recursive: true, force: true })
        throw error
    }
}

function resourcesFromEnvironment(
    environment: NodeJS.ProcessEnv,
    dataDirectory: string
): E2ERuntimeResources {
    if (!isSafeE2EDataDirectory(dataDirectory)) {
        throw new Error('The E2E data directory is not safely configured')
    }

    const apiPort = parsePort(environment.POSTBOT_E2E_API_PORT, 'POSTBOT_E2E_API_PORT')
    const webPort = parsePort(environment.POSTBOT_E2E_WEB_PORT, 'POSTBOT_E2E_WEB_PORT')
    if (apiPort === undefined || webPort === undefined) {
        throw new Error(
            'POSTBOT_E2E_API_PORT and POSTBOT_E2E_WEB_PORT must be set with POSTBOT_E2E_DATA_DIRECTORY'
        )
    }
    if (apiPort === webPort) {
        throw new Error(`E2E API and web ports must be different, received ${apiPort}`)
    }

    const useMailpit = environment.POSTBOT_E2E_MAILPIT === 'true'
    const mailpitSmtpPort = useMailpit
        ? parsePort(environment.POSTBOT_E2E_MAILPIT_SMTP_PORT, 'POSTBOT_E2E_MAILPIT_SMTP_PORT')
        : undefined
    const mailpitUiPort = useMailpit
        ? parsePort(environment.POSTBOT_E2E_MAILPIT_UI_PORT, 'POSTBOT_E2E_MAILPIT_UI_PORT')
        : undefined
    if (useMailpit && (mailpitSmtpPort === undefined || mailpitUiPort === undefined)) {
        throw new Error('Mailpit E2E ports must be set with the existing E2E runtime directory')
    }
    const configuredPorts = [apiPort, webPort, mailpitSmtpPort, mailpitUiPort].filter(
        (port): port is number => port !== undefined
    )
    if (new Set(configuredPorts).size !== configuredPorts.length) {
        throw new Error('E2E API, web, and Mailpit ports must be different')
    }

    return {
        dataDirectory,
        databaseFile: join(dataDirectory, 'postbot.sqlite'),
        mediaDirectory: join(dataDirectory, 'media'),
        apiPort,
        webPort,
        apiOrigin: `http://127.0.0.1:${apiPort}`,
        webOrigin: `http://127.0.0.1:${webPort}`,
        ...(mailpitSmtpPort === undefined || mailpitUiPort === undefined
            ? {}
            : { mailpit: { smtpPort: mailpitSmtpPort, uiPort: mailpitUiPort } }),
    }
}

/** Only direct children of the OS temp directory created by this helper. */
export function isSafeE2EDataDirectory(directory: string | undefined): directory is string {
    if (directory === undefined) return false

    const resolvedDirectory = resolve(directory)
    const directoryName = basename(resolvedDirectory)

    return (
        dirname(resolvedDirectory) === resolve(tmpdir()) &&
        directoryName.startsWith(e2eRuntimeDirectoryPrefix) &&
        directoryName.length > e2eRuntimeDirectoryPrefix.length
    )
}

function parsePort(value: string | undefined, name: string): number | undefined {
    if (value === undefined) return undefined

    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`${name} must be an integer between 1 and 65535, received ${value}`)
    }

    return port
}

async function findAvailablePort(excludedPorts: ReadonlySet<number> = new Set()): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const port = await listenOnEphemeralPort()
        if (!excludedPorts.has(port)) return port
    }

    throw new Error('Unable to allocate a distinct E2E loopback port')
}

function listenOnEphemeralPort(): Promise<number> {
    const server = createServer()

    return new Promise((resolvePort, reject) => {
        server.once('error', reject)
        server.listen({ host: '127.0.0.1', port: 0 }, () => {
            const address = server.address()
            if (address === null || typeof address === 'string') {
                server.close(() => {
                    reject(new Error('E2E ephemeral port did not expose an address'))
                })
                return
            }

            const port = address.port
            server.close(error => {
                if (error !== undefined) {
                    reject(error)
                    return
                }
                resolvePort(port)
            })
        })
    })
}
