import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('an owner can invite, update, and remove project members', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await page.goto(`/dashboard/projects/${owner.projectId}/invitations`)

    await expect(
        page.getByRole('heading', { name: 'Project invitations', exact: true }).first()
    ).toBeVisible()
    await expect(
        page.getByRole('heading', { name: 'Pending invitations', exact: true })
    ).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    ).toBe(false)
    await page.setViewportSize({ width: 1280, height: 844 })
    const memberContext = await page.context().browser()?.newContext()
    expect(memberContext).toBeDefined()
    if (memberContext === undefined) throw new Error('The member browser context was not created')
    const memberPage = await memberContext.newPage()
    const memberEmail = `e2e-134-member-${suffix}@postbot.local`

    try {
        await page.getByLabel('Email', { exact: true }).fill(memberEmail)
        await page.getByRole('button', { name: 'Invite', exact: true }).click()
        await expect(page.getByText(`Invitation for ${memberEmail}`, { exact: true })).toBeVisible()

        const initialInvitationLink = await page
            .locator('code')
            .filter({ hasText: 'invitationId=' })
            .textContent()
        expect(initialInvitationLink).toMatch(
            new RegExp(
                `/invite\\?invitationId=[^&]+&organizationId=[^&]+&projectId=${owner.projectId}`
            )
        )
        if (initialInvitationLink === null)
            throw new Error('The project invitation link was not rendered')

        await page.getByRole('button', { name: `Resend ${memberEmail}`, exact: true }).click()
        await expect(page.getByText('Invitation resent.', { exact: true })).toBeVisible()
        const invitationLink = await page
            .locator('code')
            .filter({ hasText: 'invitationId=' })
            .textContent()
        expect(invitationLink).toMatch(
            new RegExp(
                `/invite\\?invitationId=[^&]+&organizationId=[^&]+&projectId=${owner.projectId}`
            )
        )
        expect(invitationLink).not.toBe(initialInvitationLink)
        if (invitationLink === null)
            throw new Error('The resent project invitation link was not rendered')

        await memberPage.goto(invitationLink)
        await expect(memberPage).toHaveURL(/\/login\?continue=/)
        await memberPage.getByRole('button', { name: 'Create an account instead' }).click()
        await memberPage.getByLabel('Name', { exact: true }).fill(`E2E-134 member ${suffix}`)
        await memberPage.getByLabel('Email', { exact: true }).fill(memberEmail)
        await memberPage.getByLabel('Password', { exact: true }).fill('e2e-134-member-password')
        await Promise.all([
            memberPage.waitForResponse(
                response => response.url().includes('/api/auth/sign-up/email') && response.ok()
            ),
            memberPage.getByRole('button', { name: 'Create account', exact: true }).click(),
        ])
        await expect(memberPage).toHaveURL(/\/invite\?/, {
            timeout: 15_000,
        })
        const invitationUrl = new URL(memberPage.url())
        expect(invitationUrl.searchParams.get('projectId')).toBe(owner.projectId)
        expect(invitationUrl.searchParams.get('invitationId')).toEqual(expect.any(String))
        await expect(
            memberPage.getByRole('heading', { name: 'Project invitation', exact: true })
        ).toBeVisible({ timeout: 15_000 })
        await memberPage.getByRole('button', { name: 'Join project', exact: true }).click()
        await expect(memberPage).toHaveURL(
            new RegExp(`/dashboard/projects/${owner.projectId}/overview$`)
        )
        await expect(
            memberPage.getByRole('heading', { name: 'Overview', exact: true })
        ).toBeVisible()

        await page.goto(`/dashboard/projects/${owner.projectId}/access`)
        await page.reload()
        await expect(page.getByText(memberEmail, { exact: true }).first()).toBeVisible()
        const memberRole = page.getByRole('combobox', { name: `Role for ${memberEmail}` })
        await expect(memberRole).toHaveText('Editor')
        await memberRole.click()
        await page.getByRole('option', { name: 'Viewer', exact: true }).click()
        await expect(memberRole).toHaveText('Viewer')

        await page.getByRole('button', { name: /^Remove E2E-134 member/ }).click()
        await expect(
            page.getByRole('heading', { name: 'Remove this member?', exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: 'Remove access', exact: true }).click()
        await expect(page.getByText(memberEmail, { exact: true })).toHaveCount(0)
    } finally {
        await memberContext.close()
    }
})

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-134-owner-${suffix}@postbot.local`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-134 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-134-owner-password')
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
        .fill(`E2E-134 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return { email, projectId: match[1] }
}
