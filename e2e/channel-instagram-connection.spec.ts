import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('creates a native Instagram channel and connects a professional account directly', async ({
    page,
}, testInfo) => {
    const suffix = randomUUID().slice(0, 8)
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Instagram operator',
                    email: `instagram-connect-${suffix}@postbot.local`,
                    password: 'instagram-fixture-password',
                },
            })
        ).ok()
    ).toBe(true)
    const projectResponse = await page.request.post('/api/projects', {
        data: { name: `Instagram ${suffix}` },
    })
    expect(projectResponse.status()).toBe(201)
    const { project } = await projectResponse.json()
    const configured = await page.request.post('/api/settings/provider-applications', {
        data: {
            providerId: 'instagram',
            name: 'Instagram test application',
            clientId: '123456',
            clientSecret: 'synthetic-instagram-secret',
        },
    })
    expect(configured.status()).toBe(201)
    const { application } = await configured.json()
    let channelId = ''
    let connected = false
    let failStart = true
    await page.route(`**/api/projects/${project.id}/publishers`, async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({
            response,
            json: {
                ...body,
                oauthReadiness: { ...body.oauthReadiness, instagram: 'ready' },
                connections: connected
                    ? [
                          {
                              id: 'instagram-synthetic-connection',
                              projectId: project.id,
                              channelId,
                              providerId: 'instagram',
                              kind: 'instagram',
                              credentialId: 'instagram-synthetic-credential',
                              connectedByActorId: 'operator',
                              externalAccountId: '5678',
                              externalAccountName: 'studio_test',
                              destination: { type: 'account', id: '5678', name: 'studio_test' },
                              state: 'active',
                              createdAt: Date.now(),
                              updatedAt: Date.now(),
                          },
                      ]
                    : [],
            },
        })
    })
    await page.goto(`/dashboard/projects/${project.id}/channels`)
    await page.getByRole('button', { name: en.channel_add, exact: true }).click()
    await page.getByLabel('Channel name', { exact: true }).fill('Instagram images')
    await page.getByRole('radio', { name: /Instagram/ }).click()
    const saved = page.waitForResponse(
        response =>
            response.url().endsWith(`/api/projects/${project.id}/channels`) &&
            response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: en.channel_create_button, exact: true }).click()
    const created = await saved
    expect(created.status()).toBe(201)
    channelId = (await created.json()).channel.id
    const channelUrl = new URL(`/dashboard/projects/${project.id}/channels`, page.url()).toString()
    await page.route(
        `**/api/projects/${project.id}/channels/${channelId}/publisher/instagram/connect`,
        async route => {
            expect(route.request().postDataJSON()).toEqual({
                providerApplicationId: application.id,
            })
            if (failStart) {
                failStart = false
                await route.fulfill({
                    status: 503,
                    json: {
                        error: { code: 'provider_unavailable', message: 'Provider unavailable' },
                    },
                })
                return
            }
            await route.fulfill({
                json: { url: 'https://www.instagram.com/oauth/authorize?state=synthetic-ui-state' },
            })
        }
    )
    await page.route('https://www.instagram.com/oauth/authorize**', async route => {
        const callback = new URL(
            '/api/oauth/instagram/callback?state=synthetic-ui-state&code=synthetic-ui-code',
            channelUrl
        )
        await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><body><a href="${callback}">Approve professional account</a></body></html>`,
        })
    })
    await page.route('**/api/oauth/instagram/callback**', async route => {
        connected = true
        const destination = new URL(channelUrl)
        destination.searchParams.set('publisher', 'connected')
        destination.searchParams.set('publisher_channel', channelId)
        await route.fulfill({ status: 303, headers: { location: destination.toString() } })
    })
    const row = page.locator(`#publisher-connection-${channelId}`)
    const connect = row.getByRole('button', { name: 'Connect Instagram', exact: true })
    await expect(connect).toBeVisible()
    await connect.click()
    await expect(row.getByRole('alert')).toContainText(/unavailable/)
    await connect.click()
    await page.getByRole('link', { name: 'Approve professional account', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Publisher connected')
    await expect(row).toContainText('studio_test')
    await expect(row).toContainText('Connected')
    await expect(row.getByRole('button', { name: 'Connect Instagram', exact: true })).toHaveCount(0)
    await page.screenshot({
        path: testInfo.outputPath('instagram-channel-desktop.png'),
        fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(row).toContainText('studio_test')
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({
        path: testInfo.outputPath('instagram-channel-mobile.png'),
        fullPage: true,
    })
})
