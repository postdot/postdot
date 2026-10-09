import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('connects and recovers an X channel from the web workflow', async ({ page }) => {
    test.setTimeout(90_000)

    const suffix = randomUUID().slice(0, 8)
    const apiPort = process.env.HERALD_E2E_API_PORT
    if (apiPort === undefined) throw new Error('The isolated E2E API port is not configured')
    const apiOrigin = `http://127.0.0.1:${apiPort}`
    const callbackUri = `${apiOrigin}/api/oauth/x/callback`
    const xApplication = {
        id: `e2e-x-application-${suffix}`,
        providerId: 'x',
        name: `E2E X application ${suffix}`,
        clientId: 'e2e-x-client',
        clientMetadataUrl: null,
        handleResolver: null,
        oauthMode: null,
        state: 'active',
        isDefault: true,
        createdByUserId: `e2e-admin-${suffix}`,
        hasClientSecret: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }

    await page.route('**/api/access', async route => {
        if (route.request().method() !== 'GET') {
            await route.continue()
            return
        }

        const now = Date.now()
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                instance: {
                    id: 'default',
                    state: 'claimed',
                    bootstrapBlocked: false,
                    claimedByUserId: `e2e-admin-${suffix}`,
                    claimedAt: now,
                    createdAt: now,
                    updatedAt: now,
                },
                membership: {
                    id: `e2e-membership-${suffix}`,
                    userId: `e2e-admin-${suffix}`,
                    email: `e2e-x-${suffix}@herald.local`,
                    name: `E2E X ${suffix}`,
                    role: 'admin',
                    state: 'enabled',
                    createdAt: now,
                    updatedAt: now,
                },
                isAdmin: true,
            }),
        })
    })

    await page.route('**/api/settings/provider-applications', async route => {
        if (route.request().method() !== 'GET') {
            await route.continue()
            return
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ applications: [xApplication], xCallbackUri: callbackUri }),
        })
    })

    const projectId = await createAccountAndProject(page, suffix)
    await page.goto('/dashboard/settings/provider-applications')
    await expect(
        page.getByRole('heading', { name: 'OAuth applications', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByLabel('OAuth 2.0 redirect URI', { exact: true })).toHaveValue(
        callbackUri
    )
    await expect(page.getByText(/Authorization Code with PKCE/)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()

    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByLabel('Channel name', { exact: true }).fill(`E2E X channel ${suffix}`)
    await page.getByRole('radio', { name: 'X post', exact: true }).click()

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
    const channelsUrl = `${page.url().split('?')[0]}`

    let connectionState: 'active' | 'revoked' | null = null
    await page.route(`**/api/projects/${projectId}/publishers`, async route => {
        if (route.request().method() !== 'GET') {
            await route.continue()
            return
        }

        const now = Date.now()
        const connection = {
            id: `e2e-x-connection-${suffix}`,
            projectId,
            publisherId: `e2e-x-publisher-${suffix}`,
            channelId,
            kind: 'x',
            credentialId: `e2e-x-credential-${suffix}`,
            endpointUrl: null,
            authentication: null,
            destination: { type: 'account', id: 'e2e-x-user', name: 'E2E X user' },
            providerId: 'x',
            externalAccountId: 'e2e-x-user',
            externalAccountName: 'E2E X user',
            scopes: ['tweet.read', 'users.read', 'tweet.write', 'offline.access'],
            state: connectionState,
            connectedByActorId: `e2e-actor-${suffix}`,
            createdAt: now,
            updatedAt: now,
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                connections: connectionState === null ? [] : [connection],
                oauthReadiness: {
                    linkedin: 'not_configured',
                    bluesky: 'not_configured',
                    x: 'ready',
                },
            }),
        })
    })

    await page.route(`${apiOrigin}/api/oauth/x/callback**`, async route => {
        const callback = new URL(route.request().url())
        const result = callback.searchParams.has('error') ? 'authorization_denied' : 'connected'
        if (result === 'connected') connectionState = 'active'
        const destination = new URL(channelsUrl)
        destination.searchParams.set('publisher', result)
        destination.searchParams.set('publisher_channel', channelId)
        await route.fulfill({ status: 302, headers: { location: destination.toString() } })
    })

    await page.route('https://x.com/i/oauth2/authorize**', async route => {
        const state = new URL(route.request().url()).searchParams.get('state')
        if (state === null) throw new Error('The mocked X authorization request has no state')
        const callback = (parameters: string) => {
            const destination = new URL(callbackUri)
            for (const [key, value] of new URLSearchParams(parameters)) {
                destination.searchParams.set(key, value)
            }
            destination.searchParams.set('state', state)
            return destination.toString()
        }
        const destinations = {
            approve: callback('code=e2e-authorization-code'),
            deny: callback('error=access_denied'),
            cancel: channelsUrl,
        }
        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: `<!doctype html><html><body>
                <button id="approve">Approve</button>
                <button id="deny">Deny</button>
                <button id="cancel">Cancel</button>
                <script>
                    const destinations = ${JSON.stringify(destinations)};
                    for (const action of Object.keys(destinations)) {
                        document.getElementById(action).addEventListener('click', () => {
                            window.location.href = destinations[action];
                        });
                    }
                </script>
            </body></html>`,
        })
    })

    const connection = page.locator(`#publisher-connection-${channelId}`)
    const connectButton = () => connection.getByRole('button', { name: 'Connect X', exact: true })
    await expect(connectButton()).toBeVisible()

    await connectButton().click()
    await expect(page.getByRole('alert')).toContainText('The provider is temporarily unavailable.')

    let connectAttempt = 0
    await page.route(
        `**/api/projects/${projectId}/channels/${channelId}/publisher/x/connect`,
        async route => {
            if (route.request().method() !== 'POST') {
                await route.continue()
                return
            }

            const state = `e2e-x-state-${connectAttempt}`
            connectAttempt += 1
            const authorizationUrl = new URL('https://x.com/i/oauth2/authorize')
            authorizationUrl.searchParams.set('state', state)
            authorizationUrl.searchParams.set('client_id', 'e2e-x-client')
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    provider: 'x',
                    scopes: ['tweet.read', 'users.read', 'tweet.write', 'offline.access'],
                    authorizationUrl: authorizationUrl.toString(),
                }),
            })
        }
    )

    await connectButton().click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/channels$`))

    await connectButton().click()
    await page.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Authorization declined')

    await connectButton().click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Publisher connected')
    await expect(connection).toContainText('Connected')

    connectionState = 'revoked'
    await page.reload()
    await expect(connection).toContainText('Access revoked')
    const reconnectButton = connection.getByRole('button', { name: 'Reconnect X', exact: true })
    await expect(reconnectButton).toBeVisible()
    await reconnectButton.click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Publisher connected')
    await expect(connection).toContainText('Connected')
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/setup')
    if (page.url().endsWith('/setup')) {
        await page.getByLabel('Name', { exact: true }).fill(`E2E X admin ${suffix}`)
        await page.getByLabel('Email', { exact: true }).fill(`e2e-x-${suffix}@herald.local`)
        await page.getByLabel('Password', { exact: true }).fill('e2e-x-connection-password')
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
            .fill(`E2E X project ${suffix}`)
        await page
            .locator('form')
            .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
            .getByRole('button', { name: 'Add project', exact: true })
            .click()
    } else {
        const accountResponse = await page.request.post('/api/auth/sign-up/email', {
            data: {
                email: `e2e-x-${suffix}@herald.local`,
                name: `E2E X admin ${suffix}`,
                password: 'e2e-x-connection-password',
            },
        })
        expect(accountResponse.status()).toBe(200)
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: `E2E X project ${suffix}` },
        })
        expect(projectResponse.status()).toBe(201)
        const responseBody = (await projectResponse.json()) as { project: { id: string } }
        await page.goto(`/dashboard/projects/${responseBody.project.id}/overview`)
    }

    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
