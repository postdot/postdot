import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('an instance admin can create, copy, revoke, and accept invitations', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const account = await createAccountAndProject(page, suffix)
    await page.goto(`/dashboard/settings/access?projectId=${account.projectId}`)

    await expect(
        page.getByRole('heading', { name: 'Members & invitations', exact: true }).first()
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your access', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Herald users', exact: true })).toBeVisible()
    await expect(page.getByText('Administrator', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()
    await expect(page.getByText(account.email, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('combobox', { name: `Role for ${account.email}` })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: `Status for ${account.email}` })).toBeDisabled()

    const pendingEmail = `pending-${suffix}@herald.local`
    await page.getByLabel('Email', { exact: true }).fill(pendingEmail)
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(page.getByText(`Invitation for ${pendingEmail}`, { exact: true })).toBeVisible()

    const pendingLink = await readInvitationLink(page)
    expect(pendingLink).toContain('/invite?token=')
    await page.getByRole('button', { name: 'Copy invitation link', exact: true }).click()

    const pendingInvitation = page.locator('li').filter({ hasText: pendingEmail })
    await pendingInvitation.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(pendingInvitation).toHaveCount(0)

    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(page.getByText(`Invitation for ${account.email}`, { exact: true })).toBeVisible()
    const selfLink = await readInvitationLink(page)

    await page.goto(selfLink)
    await expect(
        page.getByRole('heading', { name: 'Accept invitation', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${account.projectId}/overview$`))
})

test('a member cannot enter instance administration', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const account = await createAccountAndProject(page, suffix)
    await page.route('**/api/access', async route => {
        if (route.request().method() !== 'GET') {
            await route.continue()
            return
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                instance: {
                    id: 'default',
                    state: 'claimed',
                    bootstrapBlocked: false,
                    claimedByUserId: 'member-owner',
                    claimedAt: Date.now(),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                },
                membership: {
                    id: 'member-membership',
                    userId: 'member-user',
                    email: account.email,
                    name: 'Invited Herald member',
                    role: 'member',
                    state: 'enabled',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                },
                isAdmin: false,
            }),
        })
    })

    await page.goto(`/dashboard/settings/access?projectId=${account.projectId}`)
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${account.projectId}/overview$`))
    await expect(
        page.getByRole('heading', { name: 'Members & invitations', exact: true })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
})

async function readInvitationLink(page: Page) {
    const link = await page.locator('code').filter({ hasText: '/invite?token=' }).textContent()
    if (link === null) throw new Error('The invitation link was not rendered')
    return link
}

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-132-admin-${suffix}@herald.local`
    const projectName = `E2E-132 access project ${suffix}`

    await page.goto('/setup')
    if (page.url().endsWith('/setup')) {
        await page.getByLabel('Name', { exact: true }).fill(`E2E-132 admin ${suffix}`)
        await page.getByLabel('Email', { exact: true }).fill(email)
        await page.getByLabel('Password', { exact: true }).fill('e2e-132-admin-password')
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
        await page.getByRole('textbox', { name: 'New project', exact: true }).fill(projectName)
        await page
            .locator('form')
            .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
            .getByRole('button', { name: 'Add project', exact: true })
            .click()
    } else {
        const response = await page.request.post('/api/auth/sign-up/email', {
            data: {
                email,
                name: `E2E-132 admin ${suffix}`,
                password: 'e2e-132-admin-password',
            },
        })
        expect(response.status()).toBe(200)
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: projectName },
        })
        expect(projectResponse.status()).toBe(201)
        const projectBody = (await projectResponse.json()) as { project: { id: string } }
        await page.goto(`/dashboard/projects/${projectBody.project.id}/overview`)
    }
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return { email, projectId: match[1] }
}
