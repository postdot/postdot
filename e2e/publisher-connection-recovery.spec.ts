import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test('makes a revoked publisher connection actionable', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E recovery channel ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('radio', { name: 'DEV.to article', exact: true }).click()

    const channelResponse = page.waitForResponse(
        response =>
            response.url().endsWith(`/api/projects/${projectId}/channels`) &&
            response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    const channelResult = (await (await channelResponse).json()) as {
        channel: { id: string }
    }
    const channelId = channelResult.channel.id
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    const now = Date.now()
    const revokedConnection = {
        authentication: null,
        channelId,
        connectedByActorId: 'e2e-recovery-actor',
        createdAt: now - 60_000,
        credentialId: `e2e-recovery-credential-${suffix}`,
        destination: {
            id: 'e2e-devto-account',
            name: 'E2E DEV.to account',
            type: 'account',
        },
        endpointUrl: null,
        externalAccountId: 'e2e-devto-account',
        externalAccountName: 'E2E DEV.to account',
        id: `e2e-recovery-connection-${suffix}`,
        kind: 'devto',
        projectId,
        providerId: 'devto',
        publisherId: `e2e-recovery-publisher-${suffix}`,
        scopes: [],
        state: 'revoked',
        updatedAt: now,
    }

    await page.route(`**/api/projects/${projectId}/publishers`, async route => {
        if (route.request().method() !== 'GET') {
            await route.continue()
            return
        }

        const response = await route.fetch()
        await response.body()
        await route.fulfill({
            status: response.status(),
            contentType: 'application/json',
            body: JSON.stringify({ connections: [revokedConnection] }),
        })
    })

    await page.reload()
    const connection = page.locator(`#publisher-connection-${channelId}`)
    await expect(page.locator('#channels').getByText(channelName, { exact: true })).toHaveCount(1)
    await expect(connection).toContainText('Access revoked')
    await expect(connection).toContainText(
        'Access was revoked. Reconnect this connection to resume automatic publishing.'
    )
    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(accessibility.violations).toEqual([])
    await connection.getByRole('button', { name: `Manage ${channelName}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await page.keyboard.press('Escape')

    await connection.getByRole('button', { name: 'Reconnect DEV.to', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
        dialog.getByRole('heading', { name: `Reconnect ${channelName}`, exact: true })
    ).toBeVisible()
    await expect(dialog.getByLabel('DEV.to API key', { exact: true })).toBeVisible()
    await expect(
        dialog.getByRole('button', { name: 'Reconnect DEV.to', exact: true })
    ).toBeVisible()
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E recovery ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-recovery-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-recovery-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    await page.goto('/dashboard?projectId=none')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    await page
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E recovery project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
