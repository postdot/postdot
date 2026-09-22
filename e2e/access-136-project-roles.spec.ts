import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('project roles keep viewer read-only and editor actions available', async ({ page }) => {
    test.setTimeout(120_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The role test browser was not created')

    const viewerEmail = `e2e-136-viewer-${suffix}@herald.local`
    const viewerInvitation = await createProjectInvitation(
        page,
        owner.projectId,
        viewerEmail,
        'viewer'
    )
    const viewerContext = await browser.newContext()
    const viewerPage = await viewerContext.newPage()

    try {
        await acceptProjectInvitation(
            viewerPage,
            viewerInvitation,
            owner.projectId,
            viewerEmail,
            `E2E-136 viewer ${suffix}`,
            'e2e-136-viewer-password'
        )

        const viewerMembershipResponse = await viewerPage.request.get(
            `/api/projects/${owner.projectId}/membership`
        )
        expect(viewerMembershipResponse.status()).toBe(200)
        expect(await viewerMembershipResponse.json()).toMatchObject({
            membership: { role: 'viewer' },
        })

        await viewerPage.goto(`/dashboard/projects/${owner.projectId}/queue`)
        await expect(
            viewerPage.getByRole('button', { name: 'New publication', exact: true })
        ).toHaveCount(0)

        await viewerPage.goto(`/dashboard/projects/${owner.projectId}/publications/new`)
        await expect(viewerPage).toHaveURL(
            new RegExp(`/dashboard/projects/${owner.projectId}/queue(?:\\?.*)?$`)
        )

        await viewerPage.goto(`/dashboard/projects/${owner.projectId}/media`)
        await expect(viewerPage.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
        await expect(viewerPage.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0)

        const viewerCreateChannelResponse = await viewerPage.request.post(
            `/api/projects/${owner.projectId}/channels`,
            { data: { name: 'Viewer must not create' } }
        )
        expect(viewerCreateChannelResponse.status()).toBe(403)
    } finally {
        await viewerContext.close()
    }

    const editorEmail = `e2e-136-editor-${suffix}@herald.local`
    const editorInvitation = await createProjectInvitation(
        page,
        owner.projectId,
        editorEmail,
        'editor'
    )
    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-136 editor ${suffix}`,
            'e2e-136-editor-password'
        )

        const editorMembershipResponse = await editorPage.request.get(
            `/api/projects/${owner.projectId}/membership`
        )
        expect(editorMembershipResponse.status()).toBe(200)
        expect(await editorMembershipResponse.json()).toMatchObject({
            membership: { role: 'editor' },
        })

        await editorPage.goto(`/dashboard/projects/${owner.projectId}/queue`)
        await expect(
            editorPage.getByRole('button', { name: 'New publication', exact: true }).first()
        ).toBeVisible()

        await editorPage.goto(`/dashboard/projects/${owner.projectId}/media`)
        await expect(editorPage.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
        await expect(editorPage.getByRole('button', { name: 'Select', exact: true })).toBeVisible()

        await editorPage.goto(`/dashboard/projects/${owner.projectId}/channels`)
        await expect(
            editorPage.getByRole('button', { name: 'Add channel', exact: true })
        ).toBeVisible()

        const editorCreateChannelResponse = await editorPage.request.post(
            `/api/projects/${owner.projectId}/channels`,
            { data: { name: `Editor channel ${suffix}` } }
        )
        expect(editorCreateChannelResponse.status()).toBe(201)
    } finally {
        await editorContext.close()
    }
})

async function createProjectInvitation(
    page: Page,
    projectId: string,
    email: string,
    role: 'viewer' | 'editor'
) {
    const response = await page.request.post(`/api/projects/${projectId}/invitations`, {
        data: { email, role },
    })
    expect(response.status()).toBe(201)
    const body = (await response.json()) as {
        invitation: { id: string; organizationId: string }
    }
    return body.invitation
}

async function acceptProjectInvitation(
    page: Page,
    invitation: { id: string; organizationId: string },
    projectId: string,
    email: string,
    name: string,
    password: string
) {
    await page.goto(
        `/invite?invitationId=${invitation.id}&organizationId=${invitation.organizationId}&projectId=${projectId}`
    )
    await expect(page).toHaveURL(/\/login\?continue=/)
    await page.getByRole('button', { name: 'Create an account instead' }).click()
    await page.getByLabel('Name', { exact: true }).fill(name)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])

    await expect(page).toHaveURL(/\/invite\?invitationId=/)
    await expect(
        page.getByRole('heading', { name: 'Project invitation', exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Join project', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/[^/]+/overview$`))
}

async function createAccountAndProject(page: Page, suffix: string) {
    const email = `e2e-136-owner-${suffix}@herald.local`
    const projectName = `E2E-136 project ${suffix}`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-136 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-136-owner-password')
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
    return { projectId: match[1] }
}
