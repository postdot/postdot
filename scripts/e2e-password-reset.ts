import { rm } from 'node:fs/promises'

import { startE2EMailpit, waitForE2EMailpit } from './e2e-mailpit'
import { createE2ERuntimeResources, isSafeE2EDataDirectory } from './e2e-runtime'

const ownsDataDirectory = Bun.env.POSTDOT_E2E_DATA_DIRECTORY === undefined
const runtimeEnvironment = { ...Bun.env, POSTDOT_E2E_MAILPIT: 'true' }
const runtime = await createE2ERuntimeResources(runtimeEnvironment)
if (runtime.mailpit === undefined) throw new Error('Mailpit E2E ports were not allocated')

const playwrightEnvironment = {
    ...runtimeEnvironment,
    POSTDOT_E2E_API_PORT: String(runtime.apiPort),
    POSTDOT_E2E_DATA_DIRECTORY: runtime.dataDirectory,
    POSTDOT_E2E_MAILPIT_SMTP_PORT: String(runtime.mailpit.smtpPort),
    POSTDOT_E2E_MAILPIT_UI_PORT: String(runtime.mailpit.uiPort),
    POSTDOT_E2E_WEB_PORT: String(runtime.webPort),
}
const mailpitOrigin = `http://127.0.0.1:${runtime.mailpit.uiPort}`
let activePlaywright: ReturnType<typeof Bun.spawn> | undefined
let interruptedBy: 'SIGINT' | 'SIGTERM' | undefined

function forwardSignal(signal: 'SIGINT' | 'SIGTERM') {
    interruptedBy = signal
    activePlaywright?.kill(signal)
}

const onInterrupt = () => forwardSignal('SIGINT')
const onTerminate = () => forwardSignal('SIGTERM')
process.once('SIGINT', onInterrupt)
process.once('SIGTERM', onTerminate)

let exitCode = 1
let stopMailpit: (() => Promise<void>) | undefined

try {
    stopMailpit = await startE2EMailpit(runtime, playwrightEnvironment)
    await waitForE2EMailpit(mailpitOrigin)

    if (interruptedBy !== undefined) {
        exitCode = interruptedBy === 'SIGINT' ? 130 : 143
    } else {
        activePlaywright = Bun.spawn(
            ['bun', 'x', 'playwright', 'test', 'e2e/access-219-password-reset.spec.ts'],
            {
                env: playwrightEnvironment,
                stderr: 'inherit',
                stdout: 'inherit',
            }
        )
        exitCode = await activePlaywright.exited
    }
} finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
    try {
        await stopMailpit?.()
    } finally {
        if (ownsDataDirectory && isSafeE2EDataDirectory(runtime.dataDirectory)) {
            await rm(runtime.dataDirectory, { recursive: true, force: true })
        }
    }
}

process.exitCode = exitCode
