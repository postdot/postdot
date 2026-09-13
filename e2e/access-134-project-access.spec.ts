import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('an owner can invite, update, and remove project members', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await page.goto(`/dashboard/projects/${owner.projectId}/access`)

    await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible()
    await expect(page.getByText(owner.email, { exact: true })).toBeVisible()
    await expect(page.getByText('Owner', { exact: true })).toBeVisible()

    const memberContext = await page.context().browser()?.newContext()
    expect(memberContext).toBeDefined()
    if (memberContext === undefined) throw new Error('The member browser context was not created')
    const memberPage = await memberContext.newPage()
    const memberEmail = `e2e-134-member-${suffix}@herald.local`

    try {
        await page.getByLabel('Email', { exact: true }).fill(memberEmail)
        await page.getByRole('button', { name: 'Invite', exact: true }).click()
        await expect(page.getByText(`Invitation for ${memberEmail}`, { exact: true })).toBeVisible()

        const initialInvitationLink = await page
            .locator('code')
            .filter({ hasText: 'organizationInvitation=' })
            .textContent()
        expect(initialInvitationLink).toContain(
            `/dashboard/settings/access?projectId=${owner.projectId}&organizationInvitation=`
        )
        if (initialInvitationLink === null)
            throw new Error('The project invitation link was not rendered')

        await page.getByRole('button', { name: `Resend ${memberEmail}`, exact: true }).click()
        await expect(page.getByText('Invitation resent.', { exact: true })).toBeVisible()
        const invitationLink = await page
            .locator('code')
            .filter({ hasText: 'organizationInvitation=' })
            .textContent()
        expect(invitationLink).toContain(
            `/dashboard/settings/access?projectId=${owner.projectId}&organizationInvitation=`
        )
        expect(invitationLink).not.toBe(initialInvitationLink)
        if (invitationLink === null)
            throw new Error('The resent project invitation link was not rendered')

        await memberPage.goto(invitationLink)
        await expect(memberPage).toHaveURL(/\/login\?continue=/)
        await memberPage.getByRole('button', { name: 'Need an account?' }).click()
        await memberPage.getByLabel('Name').fill(`E2E-134 member ${suffix}`)
        await memberPage.getByLabel('Email').fill(memberEmail)
        await memberPage.getByLabel('Password').fill('e2e-134-member-password')
        await memberPage.getByRole('button', { name: 'Create account', exact: true }).click()
        await expect(
            memberPage.getByRole('heading', { name: 'Project invitation', exact: true })
        ).toBeVisible()
        await memberPage.getByRole('button', { name: 'Join project', exact: true }).click()
        await expect(memberPage).toHaveURL(
            new RegExp(`/dashboard/projects/${owner.projectId}/overview$`)
        )
        await expect(
            memberPage.getByRole('heading', { name: 'Overview', exact: true })
        ).toBeVisible()

        await page.reload()
        await expect(page.getByText(memberEmail, { exact: true })).toBeVisible()
        const memberRole = page.getByRole('combobox', { name: `Role for ${memberEmail}` })
        await expect(memberRole).toHaveText('Editor')
        await memberRole.click()
        await page.getByRole('option', { name: 'Viewer', exact: true }).click()
        await expect(memberRole).toHaveText('Viewer')

        await page.getByRole('button', { name: /^Remove E2E-134 member/ }).click()
        await expect(
            page.getByRole('heading', { name: 'Remove this member?', exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: 'Remove member', exact: true }).click()
        await expect(page.getByText(memberEmail, { exact: true })).toHaveCount(0)
    } finally {
        await memberContext.close()
    }
})

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-134-owner-${suffix}@herald.local`

    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-134 owner ${suffix}`)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('e2e-134-owner-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E-134 project ${suffix}`)
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
