import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('a workspace invitation joins the selected group and unlocks its project access', async ({
    page,
}, testInfo) => {
    test.setTimeout(150_000)

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

    await expect(page.getByRole('combobox', { name: 'Select workspace', exact: true })).toHaveCount(
        1
    )
    await expect(page.getByText('No pending workspace invitations.', { exact: true })).toHaveCount(
        0
    )
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    ).toBe(false)
    await page.setViewportSize({ width: 1280, height: 844 })

    await page.getByRole('tab', { name: 'Groups', exact: true }).click()
    const editorsGroup = page
        .locator('article')
        .filter({ hasText: /^Editors/ })
        .first()
    await expect(editorsGroup.getByText(owner.projectName, { exact: true })).toBeVisible()

    await expect(page.getByLabel('Group name', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Create group', exact: true }).click()
    const groupDialog = page.getByRole('dialog')
    await groupDialog.getByLabel('Group name', { exact: true }).fill('Communications')
    await page.keyboard.press('Escape')
    await expect(groupDialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create group', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Create group', exact: true }).click()
    await expect(groupDialog.getByLabel('Group name', { exact: true })).toHaveValue(
        'Communications'
    )
    await groupDialog.getByRole('button', { name: 'Create group', exact: true }).click()
    await expect(groupDialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Communications', exact: true })).toBeVisible()

    const memberEmail = `e2e-135-member-${suffix}@postdot.local`
    const invitationResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url())
        return (
            response.request().method() === 'POST' &&
            response.status() === 201 &&
            /^\/api\/workspaces\/[^/]+\/invitations$/.test(url.pathname)
        )
    })

    await page.getByRole('tab', { name: 'Members', exact: true }).click()
    await page
        .getByRole('tabpanel', { name: 'Members', exact: true })
        .getByRole('button', { name: 'Add a member', exact: true })
        .click()
    const inviteDialog = page.getByRole('dialog')
    await inviteDialog.getByLabel('Email address', { exact: true }).fill(memberEmail)
    await page.getByRole('combobox', { name: 'Group', exact: true }).click()
    await page.getByRole('option', { name: 'Editors', exact: true }).click()
    const invitationEndpoint = /\/api\/workspaces\/[^/]+\/invitations$/
    await page.route(invitationEndpoint, async route => {
        if (route.request().method() === 'POST') {
            await route.fulfill({ status: 503, json: { error: 'workspace_operation_failed' } })
        } else await route.continue()
    })
    await inviteDialog.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(inviteDialog.getByRole('alert')).toBeVisible()
    await expect(inviteDialog.getByLabel('Email address', { exact: true })).toHaveValue(memberEmail)
    await expect(inviteDialog.getByRole('combobox', { name: 'Group', exact: true })).toContainText(
        'Editors'
    )
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('workspace-invite-error.png') })
    await page.unroute(invitationEndpoint)
    await inviteDialog.getByRole('button', { name: 'Send invite', exact: true }).click()

    const invitationResponse = await invitationResponsePromise
    const invitationBody = (await invitationResponse.json()) as {
        invitation: { id: string; teamId?: string; status: string }
    }
    expect(invitationBody.invitation).toMatchObject({ status: 'pending' })
    expect(invitationBody.invitation.teamId).toBeTruthy()
    await expect(page.getByText(memberEmail, { exact: true })).toBeVisible()
    await expect(inviteDialog).toHaveCount(0)
    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 844 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({
                path: testInfo.outputPath(`workspace-${theme}-${width}.png`),
                fullPage: true,
            })
            await page.getByRole('tab', { name: 'Groups', exact: true }).click()
            await expect(page.getByRole('tab', { name: 'Groups', exact: true })).toHaveAttribute(
                'aria-selected',
                'true'
            )
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({
                path: testInfo.outputPath(`groups-${theme}-${width}.png`),
                fullPage: true,
            })
            await page.getByRole('tab', { name: 'Members', exact: true }).click()
        }
    }
    await page
        .getByRole('tabpanel', { name: 'Members', exact: true })
        .getByRole('button', { name: 'Add a member', exact: true })
        .click()
    await expect(inviteDialog).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('workspace-mobile-invite.png') })
    await page.keyboard.press('Escape')
    await expect(inviteDialog).toHaveCount(0)
    await expect(
        page
            .getByRole('tabpanel', { name: 'Members', exact: true })
            .getByRole('button', { name: 'Add a member', exact: true })
    ).toBeFocused()
    await page.setViewportSize({ width: 1280, height: 844 })

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
        await page.getByRole('tab', { name: 'Groups', exact: true }).click()
        const refreshedEditorsGroup = page
            .locator('article')
            .filter({ hasText: /^Editors/ })
            .first()
        await expect(refreshedEditorsGroup.getByText(memberName, { exact: true })).toBeVisible()
        await page.screenshot({
            path: testInfo.outputPath('workspace-populated-members.png'),
            fullPage: true,
        })
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
            memberPage.getByRole('heading', { name: 'Projects', exact: true })
        ).toBeVisible()
        await expect(memberPage).toHaveURL(/\/dashboard\?projectId=none$/)
        await refreshedEditorsGroup
            .getByRole('button', { name: 'Add a member', exact: true })
            .click()
        await refreshedEditorsGroup
            .getByRole('combobox', { name: 'Add a group member', exact: true })
            .click()
        await page.getByRole('option', { name: memberName, exact: true }).click()
        await expect(
            refreshedEditorsGroup.getByRole('combobox', { name: 'Add a group member', exact: true })
        ).toContainText(memberName)
        await refreshedEditorsGroup.getByRole('button', { name: 'Add', exact: true }).click()
        await expect(refreshedEditorsGroup.getByText(memberName, { exact: true })).toBeVisible()
        const restoredProjects = await memberPage.request.get('/api/projects')
        expect(restoredProjects.status()).toBe(200)
        expect(await restoredProjects.json()).toMatchObject({ projects: [{ id: owner.projectId }] })
    } finally {
        await memberContext.close()
    }
})

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-135-owner-${suffix}@postdot.local`
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
