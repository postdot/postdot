import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

// WEB-312 is a diagnosis mission. This spec pins the behavior that exists today
// when project access disappears in the middle of a session, so a later
// correction can be proved against a known starting point. Nothing here asserts
// that the current behavior is desirable.
//
// Correction recorded by SSE-318, which supersedes what this comment originally
// said. The original text blamed the dev proxy for repeatedly tearing the stream
// down and made the open tab refetch more often than production would. That was a
// misattribution: Bun ended any connection idle for ten seconds while the SSE
// heartbeat interval was fifteen, so quiet streams died upstream and the proxy
// reported the reset as a 502. The runtime ceiling is now lifted for these two
// requests and the stream stays open, so the extra refetches described above no
// longer happen. The end state asserted below is unchanged and is now reached the
// way production reaches it, through the in-band `project.access-revoked` signal.

test('an open session keeps the last known project state after access is removed', async ({
    page,
}) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-312-editor-${suffix}@postbot.local`
    const editorInvitation = await createProjectInvitation(page, owner.projectId, editorEmail)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-312 browser was not created')

    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-312 editor ${suffix}`,
            'e2e-312-editor-password'
        )
        const memberId = await waitForProjectMember(page, owner.projectId, editorEmail)

        // Both reading surfaces are populated before access is lost.
        await editorPage.goto(`/dashboard/projects/${owner.projectId}/overview`)
        await expect(editorPage.locator('[data-calendar="reui"]')).toBeVisible()
        await expect(
            editorPage.getByRole('button', { name: 'New publication', exact: true })
        ).toBeVisible()
        await editorPage.goto(`/dashboard/projects/${owner.projectId}/queue`)
        await expect(editorPage.locator('[data-queue-publication-list="true"]')).toContainText(
            publication.title
        )

        // The editor is open with unsaved local work when access disappears.
        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()
        await sourceBody.click()
        await editorPage.keyboard.type('Unsaved work that only exists in this browser')
        await editorPage.keyboard.press('Tab')
        await expect
            .poll(() => countRecoveryBuffers(editorPage), { timeout: 15_000 })
            .toBeGreaterThan(0)
        expect(await countRecoveryBuffers(editorPage)).toBe(1)

        // The revocation happens in the other isolated session.
        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${memberId}`
        )
        expect(removalResponse.status()).toBe(200)

        // 1. Server protection is immediate and does not depend on the open tab.
        //    Reads are masked as a missing project and writes are refused.
        expect(
            (await editorPage.request.get(`/api/projects/${owner.projectId}/membership`)).status()
        ).toBe(404)
        expect(
            (await editorPage.request.get(`/api/projects/${owner.projectId}/publications`)).status()
        ).toBe(404)
        expect(
            (
                await editorPage.request.get(
                    `/api/projects/${owner.projectId}/publications/${publication.id}/editor`
                )
            ).status()
        ).toBe(404)
        const writeResponse = await editorPage.request.post(
            `/api/projects/${owner.projectId}/posts`,
            {
                data: {
                    publications: [{ channelId: publication.channelId, deliveryMode: 'manual' }],
                    sourceContent: {
                        body: { format: 'plain_text', text: 'Revoked write' },
                        media: [],
                    },
                },
            }
        )
        expect([403, 404]).toContain(writeResponse.status())
        const draftResponse = await editorPage.request.patch(
            `/api/projects/${owner.projectId}/publications/${publication.id}/draft`,
            { data: { content: {}, expectedRevision: 1 } }
        )
        expect([403, 404]).toContain(draftResponse.status())

        // 2. The open editor page now answers with an explicit removal
        //    surface instead of an armed editor: WEB-314 freezes new writes on
        //    the first refused request, verifies once, and replaces the editor
        //    when the refusal is confirmed.
        await expect(editorPage.getByText('Project access removed')).toBeVisible({
            timeout: 90_000,
        })
        await expect(
            editorPage.getByRole('link', { name: 'Select project', exact: true })
        ).toBeVisible()
        await expect(editorPage.getByRole('textbox', { name: 'Body', exact: true })).toHaveCount(0)

        // 3. Local work is preserved, which is what the bounded correction
        //    keeps: the recovery buffer still holds the unsaved copy.
        expect(await countRecoveryBuffers(editorPage)).toBe(1)

        // 4. A later navigation drops the project from the interface entirely,
        //    because the loader no longer finds it among the user's projects.
        await editorPage.goto(`/dashboard/projects/${owner.projectId}/queue`)
        await expect(
            editorPage.getByRole('heading', { name: 'Create your first project', exact: true })
        ).toBeVisible()
        await expect(editorPage.getByText(publication.title, { exact: true })).toHaveCount(0)
    } finally {
        await editorContext.close()
    }
})

test('a role downgrade withdraws the create affordances without an announcement', async ({
    page,
}) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-312-downgrade-${suffix}@postbot.local`
    const editorInvitation = await createProjectInvitation(page, owner.projectId, editorEmail)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-312 browser was not created')

    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-312 editor ${suffix}`,
            'e2e-312-editor-password'
        )
        const memberId = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(`/dashboard/projects/${owner.projectId}/overview`)
        await expect(editorPage.locator('[data-calendar="reui"]')).toBeVisible()
        await expect(
            editorPage.getByRole('button', { name: 'New publication', exact: true })
        ).toBeVisible()

        const downgradeResponse = await page.request.patch(
            `/api/projects/${owner.projectId}/members/${memberId}`,
            { data: { role: 'viewer' } }
        )
        expect(downgradeResponse.status()).toBe(200)

        // Reads keep working, so the role is re-read through the ordinary project
        // data refresh and the create affordances leave the interface on their own.
        await expect(
            editorPage.getByRole('button', { name: 'New publication', exact: true })
        ).toHaveCount(0)
        await expect(editorPage.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0)

        const membershipResponse = await editorPage.request.get(
            `/api/projects/${owner.projectId}/membership`
        )
        expect(membershipResponse.status()).toBe(200)
        expect(await membershipResponse.json()).toMatchObject({
            membership: { role: 'viewer' },
        })

        // Server protection still holds: consultation reads succeed, writes do not.
        const channelResponse = await editorPage.request.post(
            `/api/projects/${owner.projectId}/channels`,
            { data: { name: `Downgraded ${suffix}` } }
        )
        expect(channelResponse.status()).toBe(403)
        await editorPage.goto(`/dashboard/projects/${owner.projectId}/queue`)
        await expect(
            editorPage.getByRole('button', { name: 'New publication', exact: true })
        ).toHaveCount(0)
    } finally {
        await editorContext.close()
    }
})

async function countRecoveryBuffers(page: Page) {
    return page.evaluate(
        () =>
            Object.keys(window.localStorage).filter(key =>
                key.startsWith('postbot:publication-editor:')
            ).length
    )
}

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
    const email = `e2e-312-owner-${suffix}@postbot.local`

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
