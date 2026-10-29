import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

for (const route of ['overview', 'queue', 'media', 'channels', 'access']) {
    test(`open ${route} removes project content after membership removal`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(90_000)
        const suffix = randomUUID().slice(0, 8)
        const owner = await createAccountAndProject(page, suffix)
        const publication = await createPublication(page, owner.projectId, suffix)
        const email = `e2e-598-${suffix}@postdot.local`
        const invitation = await createProjectInvitation(page, owner.projectId, email)
        const context = await page.context().browser()!.newContext()
        try {
            const tab = await context.newPage()
            await acceptProjectInvitation(
                tab,
                invitation,
                owner.projectId,
                email,
                `Member ${suffix}`,
                'access-598-password'
            )
            const memberId = await waitForProjectMember(page, owner.projectId, email)
            await tab.goto(`/dashboard/projects/${owner.projectId}/${route}`)
            if (route === 'access')
                await expect(
                    tab.getByRole('heading', { name: 'Project access', exact: true })
                ).toBeVisible()
            else
                await expect(
                    tab.getByRole('link', { name: 'New publication', exact: true })
                ).toBeVisible()
            if (route === 'queue')
                await expect(tab.locator('[data-queue-publication-list="true"]')).toContainText(
                    publication.title
                )
            const response = await page.request.delete(
                `/api/projects/${owner.projectId}/members/${memberId}`
            )
            expect(response.status()).toBe(200)
            await expect(tab.getByText('Project access removed', { exact: true })).toBeVisible({
                timeout: 25_000,
            })
            await expect(
                tab.getByRole('link', { name: 'New publication', exact: true })
            ).toHaveCount(0)
            await expect(tab.getByText(publication.title, { exact: true })).toHaveCount(0)
            await expect(
                tab.getByRole('combobox', { name: 'Select project', exact: true })
            ).toHaveCount(0)
            if (route === 'access')
                await tab.screenshot({ path: testInfo.outputPath('access-removed.png') })
        } finally {
            await context.close()
        }
    })
}

for (const route of ['queue', 'media', 'channels']) {
    test(`open ${route} applies role narrowing and restoration without navigation`, async ({
        page,
    }) => {
        test.setTimeout(100_000)
        const suffix = randomUUID().slice(0, 8)
        const owner = await createAccountAndProject(page, suffix)
        await createPublication(page, owner.projectId, suffix)
        const email = `e2e-598-role-${suffix}@postdot.local`
        const invitation = await createProjectInvitation(page, owner.projectId, email)
        const context = await page.context().browser()!.newContext()
        try {
            const tab = await context.newPage()
            await acceptProjectInvitation(
                tab,
                invitation,
                owner.projectId,
                email,
                `Member ${suffix}`,
                'access-598-password'
            )
            const memberId = await waitForProjectMember(page, owner.projectId, email)
            await tab.goto(`/dashboard/projects/${owner.projectId}/${route}`)
            const create = tab.getByRole('link', { name: 'New publication', exact: true })
            await expect(create).toBeVisible()
            const url = tab.url()
            expect(
                (
                    await page.request.patch(
                        `/api/projects/${owner.projectId}/members/${memberId}`,
                        { data: { role: 'viewer' } }
                    )
                ).status()
            ).toBe(200)
            await expect(create).toHaveCount(0, { timeout: 25_000 })
            await expect(tab.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
            expect(tab.url()).toBe(url)
            expect(
                (
                    await page.request.patch(
                        `/api/projects/${owner.projectId}/members/${memberId}`,
                        { data: { role: 'editor' } }
                    )
                ).status()
            ).toBe(200)
            await expect(create).toBeVisible({ timeout: 25_000 })
            expect(tab.url()).toBe(url)
        } finally {
            await context.close()
        }
    })
}

test('a technical access failure preserves composer work and resumes only after Retry', async ({
    page,
}, testInfo) => {
    test.setTimeout(90_000)
    await page.addInitScript(() => {
        const Native = window.EventSource
        window.EventSource = class extends Native {
            constructor(url: string | URL, options?: EventSourceInit) {
                super(url, options)
                if (String(url).includes('/api/projects/'))
                    Object.assign(window, { accessSource: this })
            }
        }
    })
    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await createPublication(page, owner.projectId, suffix)
    await page.goto(`/dashboard/projects/${owner.projectId}/publications/new`)
    const content = page.getByRole('textbox', { name: 'Content', exact: true })
    await expect(content).toBeVisible()
    await content.fill('Local work survives an unavailable access check')
    await expect
        .poll(() =>
            page.evaluate(() =>
                Object.values(localStorage).some(value => value.includes('Local work survives'))
            )
        )
        .toBe(true)
    await page.route('**/api/projects/*/membership', route =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'unavailable', message: 'Temporarily unavailable' },
            }),
        })
    )
    await page.evaluate(projectId => {
        const source = (window as unknown as { accessSource: EventSource }).accessSource
        source.dispatchEvent(
            new MessageEvent('project.access-revoked', { data: JSON.stringify({ projectId }) })
        )
    }, owner.projectId)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(page.getByText('Project access removed', { exact: true })).toHaveCount(0)
    await expect(content).toHaveCount(0)
    expect(
        await page.evaluate(() =>
            Object.values(localStorage).some(value => value.includes('Local work survives'))
        )
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('access-unconfirmed.png') })
    await page.unroute('**/api/projects/*/membership')
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(content).toBeVisible()
    await expect(content).toHaveText('Local work survives an unavailable access check')
    await expect(page).toHaveURL(
        new RegExp(`/dashboard/projects/${owner.projectId}/publications/new$`)
    )
})

test('composer content survives a real downgrade and restoration', async ({ page }) => {
    test.setTimeout(100_000)
    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await createPublication(page, owner.projectId, suffix)
    const email = `e2e-598-draft-${suffix}@postdot.local`
    const invitation = await createProjectInvitation(page, owner.projectId, email)
    const context = await page.context().browser()!.newContext()
    try {
        const tab = await context.newPage()
        await acceptProjectInvitation(
            tab,
            invitation,
            owner.projectId,
            email,
            `Member ${suffix}`,
            'access-598-password'
        )
        const memberId = await waitForProjectMember(page, owner.projectId, email)
        await tab.goto(`/dashboard/projects/${owner.projectId}/publications/new`)
        const content = tab.getByRole('textbox', { name: 'Content', exact: true })
        await expect(content).toBeVisible()
        await content.fill('Keep this local composition across role changes')
        await expect
            .poll(() =>
                tab.evaluate(() =>
                    Object.values(localStorage).some(value =>
                        value.includes('Keep this local composition')
                    )
                )
            )
            .toBe(true)
        expect(
            (
                await page.request.patch(`/api/projects/${owner.projectId}/members/${memberId}`, {
                    data: { role: 'viewer' },
                })
            ).status()
        ).toBe(200)
        await expect(tab).toHaveURL(
            new RegExp(`/dashboard/projects/${owner.projectId}/queue(?:\\?.*)?$`),
            { timeout: 25_000 }
        )
        expect(
            await tab.evaluate(() =>
                Object.values(localStorage).some(value =>
                    value.includes('Keep this local composition')
                )
            )
        ).toBe(true)
        expect(
            (
                await page.request.patch(`/api/projects/${owner.projectId}/members/${memberId}`, {
                    data: { role: 'editor' },
                })
            ).status()
        ).toBe(200)
        await expect(tab.getByRole('link', { name: 'New publication', exact: true })).toBeVisible({
            timeout: 25_000,
        })
        await tab.getByRole('link', { name: 'New publication', exact: true }).click()
        await expect(content).toHaveText('Keep this local composition across role changes')
    } finally {
        await context.close()
    }
})

test('a late creation acknowledgement cannot clear recovery after access removal', async ({
    page,
}) => {
    test.setTimeout(100_000)
    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await createPublication(page, owner.projectId, suffix)
    const email = `e2e-598-late-${suffix}@postdot.local`
    const invitation = await createProjectInvitation(page, owner.projectId, email)
    const context = await page.context().browser()!.newContext()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
        release = resolve
    })
    let accepted!: () => void
    const acceptedGate = new Promise<void>(resolve => {
        accepted = resolve
    })
    let delivered!: () => void
    const deliveredGate = new Promise<void>(resolve => {
        delivered = resolve
    })
    let creates = 0
    try {
        const tab = await context.newPage()
        await acceptProjectInvitation(
            tab,
            invitation,
            owner.projectId,
            email,
            `Member ${suffix}`,
            'access-598-password'
        )
        const memberId = await waitForProjectMember(page, owner.projectId, email)
        await tab.goto(`/dashboard/projects/${owner.projectId}/publications/new`)
        const content = tab.getByRole('textbox', { name: 'Content', exact: true })
        await expect(content).toBeVisible()
        await content.fill('Keep the local copy after a late creation acknowledgement')
        await expect
            .poll(() =>
                tab.evaluate(() =>
                    Object.values(localStorage).some(value => value.includes('Keep the local copy'))
                )
            )
            .toBe(true)
        await tab.route('**/api/projects/*/posts', async route => {
            creates++
            const response = await route.fetch()
            expect(response.status()).toBe(201)
            accepted()
            await gate
            await route.fulfill({ response })
            delivered()
        })
        await tab.getByRole('button', { name: 'Create draft', exact: true }).click()
        await acceptedGate
        expect(
            (
                await page.request.delete(`/api/projects/${owner.projectId}/members/${memberId}`)
            ).status()
        ).toBe(200)
        await expect(tab.getByText('Project access removed', { exact: true })).toBeVisible({
            timeout: 25_000,
        })
        release()
        await deliveredGate
        await expect
            .poll(() =>
                tab.evaluate(() =>
                    Object.values(localStorage).some(value => value.includes('Keep the local copy'))
                )
            )
            .toBe(true)
        // Allow the delivered response continuation to settle, then inspect the retained author-scoped recovery.
        await tab.evaluate(
            () =>
                new Promise<void>(resolve =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                )
        )
        expect(
            await tab.evaluate(() =>
                Object.values(localStorage).some(value => value.includes('Keep the local copy'))
            )
        ).toBe(true)
        expect(creates).toBe(1)
    } finally {
        release()
        await context.close()
    }
})

async function waitForProjectMember(page: Page, projectId: string, email: string) {
    let memberId: string | undefined
    await expect
        .poll(
            async () => {
                const response = await page.request.get(`/api/projects/${projectId}/members`)
                if (!response.ok()) return null
                const body = (await response.json()) as { members: { email: string; id: string }[] }
                memberId = body.members.find(member => member.email === email)?.id
                return memberId ?? null
            },
            { timeout: 15_000 }
        )
        .not.toBeNull()
    if (memberId === undefined) throw new Error(`No project member found for ${email}`)
    return memberId
}

async function createPublication(page: Page, projectId: string, suffix: string) {
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `E2E-312 destination ${suffix}`, profile: 'manual-message' },
    })
    expect(channelResponse.status()).toBe(201)
    const channel = (await channelResponse.json()) as { channel: { id: string } }
    const title = `E2E-312 scheduled ${suffix}`
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            publications: [{ channelId: channel.channel.id, deliveryMode: 'manual' }],
            sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
        },
    })
    expect(postResponse.status()).toBe(201)
    const created = (await postResponse.json()) as { publications: { id: string }[] }
    const publication = created.publications[0]
    if (publication === undefined) throw new Error('The publication was not created')
    return { channelId: channel.channel.id, id: publication.id, title }
}

async function createProjectInvitation(page: Page, projectId: string, email: string) {
    const response = await page.request.post(`/api/projects/${projectId}/invitations`, {
        data: { email, role: 'editor' },
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
    const email = `e2e-312-owner-${suffix}@postdot.local`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-312 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-312-owner-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    // Keep invitation fixtures below the membership limit regardless of accounts
    // accumulated by earlier scenarios in the shared runtime.
    const workspaceResponse = await page.request.post('/api/workspaces', {
        data: { name: `E2E-312 workspace ${suffix}` },
    })
    expect(workspaceResponse.status()).toBe(201)
    const { workspace } = (await workspaceResponse.json()) as { workspace: { id: string } }
    await page.goto(`/dashboard?workspaceId=${workspace.id}&projectId=none`)
    await expect(page).toHaveURL(/\/dashboard\?workspaceId=[^&]+&projectId=none$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    await page.getByRole('textbox', { name: 'New project', exact: true }).fill(`E2E-312 ${suffix}`)
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
