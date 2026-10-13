import { expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createE2ERuntimeResources, isSafeE2EDataDirectory } from './e2e-runtime'

test('allocates independent resources for concurrent E2E runs', async () => {
    const resources = await Promise.all([
        createE2ERuntimeResources({}),
        createE2ERuntimeResources({}),
    ])

    try {
        expect(new Set(resources.map(resource => resource.dataDirectory)).size).toBe(2)
        expect(new Set(resources.map(resource => resource.apiPort)).size).toBe(2)
        expect(new Set(resources.map(resource => resource.webPort)).size).toBe(2)
        expect(
            new Set(resources.flatMap(resource => [resource.apiPort, resource.webPort])).size
        ).toBe(4)
        expect(resources.every(resource => isSafeE2EDataDirectory(resource.dataDirectory))).toBe(
            true
        )
    } finally {
        await Promise.all(
            resources.map(resource => rm(resource.dataDirectory, { recursive: true, force: true }))
        )
    }
})

test('allocates isolated Mailpit ports only for mail-enabled E2E runs', async () => {
    const [mailEnabled, mailDisabled] = await Promise.all([
        createE2ERuntimeResources({ POSTBOT_E2E_MAILPIT: 'true' }),
        createE2ERuntimeResources({}),
    ])

    try {
        expect(mailEnabled.mailpit).toBeDefined()
        expect(mailDisabled.mailpit).toBeUndefined()
        expect(
            new Set([
                mailEnabled.apiPort,
                mailEnabled.webPort,
                mailEnabled.mailpit!.smtpPort,
                mailEnabled.mailpit!.uiPort,
            ]).size
        ).toBe(4)
    } finally {
        await Promise.all(
            [mailEnabled, mailDisabled].map(resource =>
                rm(resource.dataDirectory, { recursive: true, force: true })
            )
        )
    }
})

test('rejects the legacy shared directory as a cleanup target', () => {
    expect(isSafeE2EDataDirectory(join(tmpdir(), 'postbot-e2e-data'))).toBe(false)
    expect(isSafeE2EDataDirectory(tmpdir())).toBe(false)
    expect(isSafeE2EDataDirectory(undefined)).toBe(false)
})

test('honors explicitly reserved debug ports', async () => {
    const resources = await createE2ERuntimeResources({
        POSTBOT_E2E_API_PORT: '32101',
        POSTBOT_E2E_WEB_PORT: '32102',
    })

    try {
        expect(resources.apiPort).toBe(32101)
        expect(resources.webPort).toBe(32102)
    } finally {
        await rm(resources.dataDirectory, { recursive: true, force: true })
    }
})

test('reuses the parent runtime when Playwright loads its config in a worker', async () => {
    const parentResources = await createE2ERuntimeResources({})

    try {
        const workerResources = await createE2ERuntimeResources({
            POSTBOT_E2E_API_PORT: String(parentResources.apiPort),
            POSTBOT_E2E_DATA_DIRECTORY: parentResources.dataDirectory,
            POSTBOT_E2E_WEB_PORT: String(parentResources.webPort),
        })

        expect(workerResources).toEqual(parentResources)
    } finally {
        await rm(parentResources.dataDirectory, { recursive: true, force: true })
    }
})

test('reuses mail-enabled runtime ports when Playwright loads its config in a worker', async () => {
    const parentResources = await createE2ERuntimeResources({ POSTBOT_E2E_MAILPIT: 'true' })
    const mailpit = parentResources.mailpit

    if (mailpit === undefined) throw new Error('Expected Mailpit ports for this fixture')

    try {
        const workerResources = await createE2ERuntimeResources({
            POSTBOT_E2E_API_PORT: String(parentResources.apiPort),
            POSTBOT_E2E_DATA_DIRECTORY: parentResources.dataDirectory,
            POSTBOT_E2E_MAILPIT: 'true',
            POSTBOT_E2E_MAILPIT_SMTP_PORT: String(mailpit.smtpPort),
            POSTBOT_E2E_MAILPIT_UI_PORT: String(mailpit.uiPort),
            POSTBOT_E2E_WEB_PORT: String(parentResources.webPort),
        })

        expect(workerResources).toEqual(parentResources)
    } finally {
        await rm(parentResources.dataDirectory, { recursive: true, force: true })
    }
})
