import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('a workspace invitation joins the selected group and unlocks its project access', async ({
    page,
}) => {
    test.setTimeout(90_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)

    await page.goto(`/dashboard/projects/${owner.projectId}/access`)
    await expect(page.getByRole('heading', { name: 'Group access', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Add a workspace group', exact: true }).click()
    await page.getByRole('option', { name: 'Editors', exact: true }).click()
    await page.getByRole('button', { name: 'Grant group access', exact: true }).click()
    await expect(page.getByText('Member updated.', { exact: true })).toBeVisible()

    await page.goto(`/dashboard/settings/workspace?projectId=${owner.projectId}`)
    await expect(page.getByRole('heading', { name: 'Members & groups', exact: true })).toBeVisible()

    const editorsGroup = page
        .locator('article')
        .filter({ hasText: /^Editors/ })
        .first()
    await expect(editorsGroup.getByText(owner.projectName, { exact: true })).toBeVisible()

    const memberEmail = `e2e-135-member-${suffix}@herald.local`
    const invitationResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url())
        return (
            response.request().method() === 'POST' &&
            response.status() === 201 &&
            /^\/api\/workspaces\/[^/]+\/invitations$/.test(url.pathname)
        )
    })

    await page.getByLabel('Email address', { exact: true }).fill(memberEmail)
    await page.getByRole('combobox', { name: 'Group', exact: true }).click()
    await page.getByRole('option', { name: 'Editors', exact: true }).click()
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    const invitationResponse = await invitationResponsePromise
    const invitationBody = (await invitationResponse.json()) as {
        invitation: { id: string; teamId?: string; status: string }
    }
    expect(invitationBody.invitation).toMatchObject({ status: 'pending' })
    expect(invitationBody.invitation.teamId).toBeTruthy()
    await expect(page.getByText(memberEmail, { exact: true })).toBeVisible()

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The member browser context was not created')
    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()

    try {
        await memberPage.goto(`/invite?invitationId=${invitationBody.invitation.id}`)
        await expect(memberPage).toHaveURL(/\/login\?continue=/)
        await memberPage.getByRole('button', { name: 'Create an account instead' }).click()
        await memberPage.getByLabel('Name', { exact: true }).fill(`E2E-135 member ${suffix}`)
        await memberPage.getByLabel('Email', { exact: true }).fill(memberEmail)
        await memberPage.getByLabel('Password', { exact: true }).fill('e2e-135-member-password')
        await Promise.all([
            memberPage.waitForResponse(
                response => response.url().includes('/api/auth/sign-up/email') && response.ok()
            ),
            memberPage.getByRole('button', { name: 'Create account', exact: true }).click(),
        ])

        await expect(memberPage).toHaveURL(/\/invite\?invitationId=/)
        await expect(
            memberPage.getByRole('heading', { name: 'Workspace invitation', exact: true })
        ).toBeVisible()
        await memberPage.getByRole('button', { name: 'Join workspace', exact: true }).click()
        await expect(memberPage).toHaveURL(
            new RegExp(`/dashboard/projects/${owner.projectId}/overview$`)
        )

        await memberPage.goto(`/dashboard/projects/${owner.projectId}/overview`)
        await expect(memberPage).toHaveURL(
            new RegExp(`/dashboard/projects/${owner.projectId}/overview$`)
        )
        await expect(
            memberPage.getByRole('heading', { name: 'Overview', exact: true })
        ).toBeVisible()

        await memberPage.getByRole('combobox', { name: 'Select workspace', exact: true }).click()
        await expect(
            memberPage.getByRole('link', { name: 'Members & groups', exact: true })
        ).toHaveCount(0)
        await memberPage.keyboard.press('Escape')
        await memberPage.goto('/dashboard/settings/workspace')
        await expect(memberPage).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

        await page.reload()
        await expect(
            page.getByRole('heading', { name: 'Members & groups', exact: true })
        ).toBeVisible()
        const memberName = `E2E-135 member ${suffix}`
        const refreshedEditorsGroup = page
            .locator('article')
            .filter({ hasText: /^Editors/ })
            .first()
        await expect(refreshedEditorsGroup.getByText(memberName, { exact: true })).toBeVisible()
        await refreshedEditorsGroup
            .getByRole('button', {
                name: `Remove ${memberName} from this group`,
                exact: true,
            })
            .click()
        await expect(
            page.getByText('Member removed from the group.', { exact: true })
        ).toBeVisible()

        const memberProjectsAfterRemoval = await memberPage.request.get('/api/projects')
        expect(memberProjectsAfterRemoval.status()).toBe(200)
        expect(await memberProjectsAfterRemoval.json()).toEqual({ projects: [] })

        await memberPage.goto(`/dashboard/projects/${owner.projectId}/overview`)
        await expect(
            memberPage.getByRole('heading', { name: 'Create your first project', exact: true })
        ).toBeVisible()
        await expect(memberPage).toHaveURL(/\/dashboard\?projectId=none$/)
    } finally {
        await memberContext.close()
    }
})

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-135-owner-${suffix}@herald.local`
    const projectName = `E2E-135 project ${suffix}`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-135 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-135-owner-password')
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
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return { projectId: match[1], projectName }
}
