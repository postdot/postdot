import { randomUUID } from 'node:crypto'

import { expect, test, type Page, type Route } from '@playwright/test'

// WEB-314 is a bounded first implementation on the publication editor page.
// These specs prove suspension, late-response quarantine, and confirmation
// into a concurrent conflict. Queue, calendar, channels, media, approvals,
// notifications, composer, and role-change announcement stay out of scope.

test('an ambiguous signal suspends writes, verifies once, then shows removal', async ({ page }) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-314-editor-${suffix}@herald.local`
    const editorInvitation = await createProjectInvitation(page, owner.projectId, editorEmail)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-314 browser was not created')

    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-314 editor ${suffix}`,
            'e2e-314-editor-password'
        )
        const member = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()
        await sourceBody.click()
        await editorPage.keyboard.type('Local work written before the revocation')
        await editorPage.keyboard.press('Tab')
        await expect
            .poll(() => countRecoveryBuffers(editorPage), { timeout: 15_000 })
            .toBeGreaterThan(0)
        await expect(editorPage.getByRole('status', { name: 'Saved', exact: true })).toBeVisible({
            timeout: 30_000,
        })

        // Hold the single verification read so the frozen state is observable.
        let releaseMembership!: () => void
        const membershipGate = new Promise<void>(resolve => {
            releaseMembership = resolve
        })
        let draftPatchRequests = 0
        editorPage.on('request', request => {
            const url = new URL(request.url())
            if (request.method() === 'PATCH' && url.pathname.endsWith('/draft')) {
                draftPatchRequests += 1
            }
        })
        await editorPage.route('**/api/projects/*/membership', async route => {
            await membershipGate
            await route.continue()
        })

        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${member.id}`
        )
        expect(removalResponse.status()).toBe(200)

        // The first write attempted after the revocation is refused by the
        // server, which starts the one-shot verification and freezes the
        // editor while the membership read is held.
        await sourceBody.click()
        await editorPage.keyboard.type(' plus an attempt after the revocation')
        await expect(editorPage.getByText('Checking project access…')).toBeVisible({
            timeout: 90_000,
        })
        expect(draftPatchRequests).toBeGreaterThan(0)
        const draftPatchAfterReveal = draftPatchRequests
        await expect(sourceBody).toHaveCount(0)
        await expect(
            editorPage
                .getByText('Local work written before the revocation', { exact: false })
                .first()
        ).toBeVisible()
        await editorPage.waitForTimeout(3_000)
        expect(draftPatchRequests).toBe(draftPatchAfterReveal)

        // Releasing the held verification lets the real refusal through.
        releaseMembership()
        await expect(editorPage.getByText('Project access removed')).toBeVisible({
            timeout: 60_000,
        })
        await expect(
            editorPage.getByRole('link', { name: 'Select project', exact: true })
        ).toBeVisible()

        // The local buffer survives separately and is never purged.
        expect(await countRecoveryBuffers(editorPage)).toBe(1)
        const bufferText = await readRecoveryBufferText(editorPage)
        expect(bufferText).toContain('Local work written before the revocation')

        // No polling and no self-recovery: the removal surface persists on
        // its own, and no new draft write is dispatched. Background
        // project-data refetches share the membership endpoint in flap-heavy
        // environments, so exact-once dispatch is pinned by the reducer tests
        // while the browser proves the absence of repeat behavior here.
        await editorPage.waitForTimeout(5_000)
        await expect(editorPage.getByText('Project access removed')).toBeVisible()
        expect(draftPatchRequests).toBe(draftPatchAfterReveal)

        // The return leads back to the available projects.
        await editorPage.getByRole('link', { name: 'Select project', exact: true }).click()
        await expect(editorPage).toHaveURL(/\/dashboard\?projectId=none/)
    } finally {
        await editorContext.close()
    }
})

test('a late draft response is quarantined instead of applied', async ({ page }) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-314-late-${suffix}@herald.local`
    const editorInvitation = await createProjectInvitation(page, owner.projectId, editorEmail)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-314 browser was not created')

    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-314 late ${suffix}`,
            'e2e-314-late-password'
        )
        const member = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()
        await sourceBody.click()
        await editorPage.keyboard.type('Local work saved before the revocation')
        await editorPage.keyboard.press('Tab')
        await expect(editorPage.getByRole('status', { name: 'Saved', exact: true })).toBeVisible({
            timeout: 30_000,
        })

        // Capture a genuine editor payload to answer the held request with.
        const savedEditor = await page.request.get(
            `/api/projects/${owner.projectId}/publications/${publication.id}/editor`
        )
        expect(savedEditor.status()).toBe(200)
        const savedEditorBody = await savedEditor.text()

        // Hold the first draft write and the verification read; later writes
        // pass through so one of them reveals the loss.
        let releaseMembership!: () => void
        const membershipGate = new Promise<void>(resolve => {
            releaseMembership = resolve
        })
        let heldDraftRoute: Route | null = null
        await editorPage.route('**/api/projects/*/membership', async route => {
            await membershipGate
            await route.continue()
        })
        await editorPage.route('**/api/projects/*/publications/*/draft', async route => {
            if (route.request().method() !== 'PATCH') {
                await route.continue()
                return
            }
            if (heldDraftRoute === null) {
                heldDraftRoute = route
                return
            }
            await route.continue()
        })

        await sourceBody.click()
        await editorPage.keyboard.type(' plus held unsent work')
        const heldRequest = editorPage.waitForRequest(
            request =>
                request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/draft'),
            { timeout: 30_000 }
        )
        await heldRequest

        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${member.id}`
        )
        expect(removalResponse.status()).toBe(200)

        // A second write reveals the loss and freezes the editor while the
        // membership read is held.
        await editorPage.keyboard.type(' plus revealing work')
        await expect(editorPage.getByText('Checking project access…')).toBeVisible({
            timeout: 90_000,
        })
        await expect(sourceBody).toHaveCount(0)

        // The held first write now answers with success, after the freeze. It
        // must change nothing: no saved state, no cleared buffer, no actions.
        const routeToRelease = heldDraftRoute as Route | null
        if (routeToRelease === null) throw new Error('The draft write was not held')
        await routeToRelease.fulfill({
            status: 200,
            contentType: 'application/json',
            body: savedEditorBody,
        })
        await editorPage.waitForTimeout(3_000)
        await expect(editorPage.getByText('Checking project access…')).toBeVisible()
        await expect(editorPage.getByRole('status', { name: 'Saved', exact: true })).toHaveCount(0)
        expect(await countRecoveryBuffers(editorPage)).toBe(1)
        const bufferText = await readRecoveryBufferText(editorPage)
        expect(bufferText).toContain('plus held unsent work')

        // The held verification then establishes the refusal.
        releaseMembership()
        await expect(editorPage.getByText('Project access removed')).toBeVisible({
            timeout: 60_000,
        })
        await editorPage.waitForTimeout(5_000)
        await expect(editorPage.getByText('Project access removed')).toBeVisible()
        expect(await countRecoveryBuffers(editorPage)).toBe(1)
    } finally {
        await editorContext.close()
    }
})

test('a technical error retries once and confirms into a concurrent conflict', async ({ page }) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-314-conflict-${suffix}@herald.local`
    const editorInvitation = await createProjectInvitation(page, owner.projectId, editorEmail)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-314 browser was not created')

    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-314 conflict ${suffix}`,
            'e2e-314-conflict-password'
        )
        const member = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()
        await sourceBody.click()
        await editorPage.keyboard.type('Local work concurrent with the owner')
        await editorPage.keyboard.press('Tab')
        await expect
            .poll(() => countRecoveryBuffers(editorPage), { timeout: 15_000 })
            .toBeGreaterThan(0)

        // The owner moves the server revision forward while the local draft is
        // still unsent.
        const editorState = await page.request.get(
            `/api/projects/${owner.projectId}/publications/${publication.id}/editor`
        )
        expect(editorState.status()).toBe(200)
        const revision = ((await editorState.json()) as { editor: { draft: { revision: number } } })
            .editor.draft.revision
        const ownerSave = await page.request.patch(
            `/api/projects/${owner.projectId}/publications/${publication.id}/draft`,
            {
                data: {
                    expectedRevision: revision,
                    sourceContent: {
                        body: { format: 'plain_text', text: 'Owner concurrent change' },
                        media: [],
                    },
                },
            }
        )
        expect(ownerSave.status()).toBe(200)

        // Every membership read issued while access is unverified fails
        // technically, so the machine shows the compact retry state instead of
        // claiming a revocation. Background refetches cannot steal the failure
        // from the verification read this way.
        let revoked = false
        let allowRealMembership = false
        await editorPage.route('**/api/projects/*/membership', async route => {
            if (!revoked || allowRealMembership) {
                await route.continue()
                return
            }
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: { code: 'server_error', message: 'boom' } }),
            })
        })

        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${member.id}`
        )
        expect(removalResponse.status()).toBe(200)
        revoked = true

        // The first write attempted after the revocation is refused, which
        // starts verification; the intercepted membership read then fails
        // technically instead of claiming a revocation.
        const triggerBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await triggerBody.click()
        await editorPage.keyboard.type(' plus a revealing attempt')
        await expect(editorPage.getByText('Application could not be confirmed.')).toBeVisible({
            timeout: 90_000,
        })
        await expect(editorPage.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
        await editorPage.waitForTimeout(5_000)
        await expect(editorPage.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
        expect(await countRecoveryBuffers(editorPage)).toBe(1)

        // Access is restored, so the explicit retry confirms and reconciles:
        // the server is newer, the local draft diverges, and the reference
        // revision must not advance silently.
        const restoredGrant = await page.request.post(
            `/api/projects/${owner.projectId}/user-grants`,
            {
                data: { userId: member.userId, role: 'editor' },
            }
        )
        expect(restoredGrant.status()).toBe(201)
        allowRealMembership = true
        await editorPage.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(editorPage.getByText('The server has newer work')).toBeVisible({
            timeout: 60_000,
        })
        // The retry resolved into confirmation, and no later cycle disturbs
        // the reconciled editor: still editing, local text intact.
        await editorPage.waitForTimeout(5_000)
        await expect(editorPage.getByText('The server has newer work')).toBeVisible()
        await expect(editorPage.getByRole('textbox', { name: 'Body', exact: true })).toContainText(
            'Local work concurrent with the owner'
        )
        expect(await countRecoveryBuffers(editorPage)).toBe(1)
        const bufferText = await readRecoveryBufferText(editorPage)
        expect(bufferText).toContain('Local work concurrent with the owner')
    } finally {
        await editorContext.close()
    }
})

async function countRecoveryBuffers(page: Page) {
    return page.evaluate(
        () =>
            Object.keys(window.localStorage).filter(key =>
                key.startsWith('herald:publication-editor:')
            ).length
    )
}

async function readRecoveryBufferText(page: Page) {
    return page.evaluate(() => {
        const key = Object.keys(window.localStorage).find(candidate =>
            candidate.startsWith('herald:publication-editor:')
        )
        return key === undefined ? '' : (window.localStorage.getItem(key) ?? '')
    })
}

async function waitForProjectMember(page: Page, projectId: string, email: string) {
    let member: { id: string; userId: string } | undefined
    await expect
        .poll(
            async () => {
                const response = await page.request.get(`/api/projects/${projectId}/members`)
                if (!response.ok()) return null
                const body = (await response.json()) as {
                    members: { email: string; id: string; userId: string }[]
                }
                member = body.members.find(candidate => candidate.email === email)
                return member ?? null
            },
            { timeout: 15_000 }
        )
        .not.toBeNull()
    if (member === undefined) throw new Error(`No project member found for ${email}`)
    return member
}

async function createPublication(page: Page, projectId: string, suffix: string) {
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `E2E-314 destination ${suffix}`, profile: 'manual-message' },
    })
    expect(channelResponse.status()).toBe(201)
    const channel = (await channelResponse.json()) as { channel: { id: string } }
    const title = `E2E-314 scheduled ${suffix}`
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
    const email = `e2e-314-owner-${suffix}@herald.local`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-314 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-314-owner-password')
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
    await page.getByRole('textbox', { name: 'New project', exact: true }).fill(`E2E-314 ${suffix}`)
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
