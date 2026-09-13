import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('an instance admin can create, copy, revoke, and accept invitations', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const account = await createAccountAndProject(page, suffix)
    await page.goto(`/dashboard/settings/access?projectId=${account.projectId}`)

    await expect(page.getByRole('heading', { name: 'Instance access', exact: true })).toBeVisible()
    await expect(page.getByText('Administrator', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Members', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()
    await expect(page.getByText(account.email, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('combobox', { name: `Role for ${account.email}` })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: `Status for ${account.email}` })).toBeDisabled()

    const pendingEmail = `pending-${suffix}@herald.local`
    await page.getByLabel('Email', { exact: true }).fill(pendingEmail)
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(page.getByText(`Invitation for ${pendingEmail}`, { exact: true })).toBeVisible()

    const pendingLink = await readInvitationLink(page)
    expect(pendingLink).toContain('/dashboard/settings/access?invitation=')
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
    await expect(page).toHaveURL(/\/dashboard\/settings\/access(?:\?projectId=.*)?$/)
    await expect(page.getByText('Invitation accepted.', { exact: true })).toBeVisible()
})

test('a member sees their membership without admin invitation controls', async ({ page }) => {
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
    await expect(page.getByRole('heading', { name: 'Instance access', exact: true })).toBeVisible()
    await expect(page.getByText('Member', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
    await expect(
        page.getByRole('heading', { name: 'Members & invitations', exact: true })
    ).toHaveCount(0)
})

async function readInvitationLink(page: Page) {
    const link = await page
        .locator('code')
        .filter({ hasText: '/dashboard/settings/access?invitation=' })
        .textContent()
    if (link === null) throw new Error('The invitation link was not rendered')
    return link
}

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-132-admin-${suffix}@herald.local`

    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-132 admin ${suffix}`)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('e2e-132-admin-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    const projectName = `E2E-132 access project ${suffix}`
    await page.locator('#new-project').fill(projectName)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return { email, projectId: match[1] }
}
