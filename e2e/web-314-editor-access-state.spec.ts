import { randomUUID } from 'node:crypto'

import { expect, test, type Page, type Request, type Route } from '@playwright/test'

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

        // The mechanism that could dispatch another draft write is the 650 ms
        // autosave debounce, which can only be re-armed by `dirty` becoming true
        // again — impossible while the editor is frozen. The mechanism that used
        // to cause surprise traffic was a project-data refetch following a stream
        // flap, so it is now driven on purpose: the owner renames a channel, the
        // observer receives it on its live stream, and its invalidation rounds
        // really run before the counter is asserted.
        await driveProjectDataRefresh({
            ownerPage: page,
            observerPage: editorPage,
            projectId: owner.projectId,
            channelId: publication.channelId,
            suffix,
            exclude: ['/editor'],
        })
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
        // its own, and no new draft write is dispatched. The same project-data
        // refresh that once arrived as a flap is now delivered deliberately, so
        // the absence is proven against a real event rather than against silence.
        await driveProjectDataRefresh({
            ownerPage: page,
            observerPage: editorPage,
            projectId: owner.projectId,
            channelId: publication.channelId,
            suffix: `${suffix} again`,
            exclude: ['/editor'],
        })
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
        // The mechanism under test is the save promise's continuation, which
        // carries no timer: it runs once the browser has finished the request.
        // Waiting for that is an observable condition rather than a pause, so the
        // assertions below cannot pass before the late success had its chance to
        // be applied.
        await editorPage.waitForEvent(
            'requestfinished',
            request => request.method() === 'PATCH' && draftPatchPath(request.url())
        )
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
        // This window is kept, and deliberately not replaced. The forbidden action
        // here is a late purge of the buffer caused by a reconnect-driven *full*
        // invalidation that includes publication editors
        // (`refresh('project', true, true)` in project-realtime.tsx), and that
        // invalidation is only reachable from a `resync-required` frame. A frame
        // cannot be produced on demand from a browser without corrupting the
        // journal cursor, so absence cannot be proven by traversal here. What can
        // be done is bound the observation by the mechanism that would carry it:
        // the resync path uses the same [0, 80, 240, 800] ms rounds as every other
        // refresh, so this budget outlives the last of them.
        await editorPage.waitForTimeout(REFRESH_BURST_SETTLE_MS)
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
        // The forbidden action is a self-firing retry. The mechanism that could
        // cause one is an effect re-run after a query invalidation, which a live
        // event triggers, so the event is delivered deliberately: the owner
        // renames a channel, the observer receives it on its live stream, and the
        // invalidation rounds genuinely run.
        //
        // The membership read count is deliberately not asserted here. Every
        // project-data refetch reads membership as part of loading project data
        // (`loadProjectData` calls `getProjectMembership` in dashboard-context.tsx),
        // so on a live stream that endpoint cannot separate a verification launch
        // from a background read, and counting it measures the refresh rounds
        // instead. Exactly-once verification is measured in the scenario that cuts
        // the streams, where membership reads can only come from verification, and
        // in the reducer unit tests. What this scenario proves is that a real
        // stream refresh neither fires the retry nor disturbs the machine.
        await driveProjectDataRefresh({
            ownerPage: page,
            observerPage: editorPage,
            projectId: owner.projectId,
            channelId: publication.channelId,
            suffix,
            exclude: ['/editor', '/membership'],
        })
        await expect(editorPage.getByText('Application could not be confirmed.')).toBeVisible()
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
        // the reconciled editor: still editing, local text intact. The mechanism
        // that would disturb it is a `project.draft-changed` hint making the page
        // reread the editor, so the owner saves the same draft for real and that
        // reread happens for real.
        await driveEditorReread({
            ownerPage: page,
            observerPage: editorPage,
            projectId: owner.projectId,
            publicationId: publication.id,
        })
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

// A negative assertion here is only meaningful if it is made after the
// mechanisms that could produce the forbidden action have actually run:
//
//   - the autosave debounce is 650 ms
//     (apps/web/src/components/publication-editor.tsx), so a pending save can
//     still dispatch that long after the last keystroke;
//   - a live event or a stream reconnect invalidates dashboard queries in
//     rounds scheduled at [0, 80, 240, 800] ms after the signal
//     (apps/web/src/lib/project-realtime.tsx), so the last round lands about
//     1.12 s later and the requests it triggers follow it.
//
// The later of the two tails is the 800 ms refresh round. This budget covers it
// plus the request it causes, with margin. A short generic quiet window would be
// wrong rather than merely conservative: it would complete *before* an
// undesirable action at 800 ms or one second and report success.
const REFRESH_BURST_SETTLE_MS = 1_500

const draftPatchPath = (url: string): boolean =>
    new URL(url).pathname.endsWith('/draft') && !new URL(url).pathname.endsWith('/editor/draft')

/** Counts the aborted stream attempts this spec induces by cutting the streams. */
function countStreamAttempts(page: Page): () => number {
    let attempts = 0
    page.on('request', request => {
        const { pathname } = new URL(request.url())
        if (pathname.endsWith('/events')) attempts += 1
    })
    return () => attempts
}

function countProjectDataReads(page: Page, exclude: readonly string[]): () => number {
    let reads = 0
    page.on('request', request => {
        if (request.method() !== 'GET') return
        const { pathname } = new URL(request.url())
        if (!pathname.startsWith('/api/projects/')) return
        if (pathname.endsWith('/events') || pathname.endsWith('/membership')) return
        if (exclude.some(suffix => pathname.endsWith(suffix))) return
        reads += 1
    })
    return () => reads
}

/**
 * Makes the observer page receive a real event on its live stream and proves it
 * acted on it, by renaming a channel from the owner's session. That emits a
 * project-scoped `project.update`, which drives `refresh('project')` on the
 * observer, so the invalidation rounds genuinely run before the caller asserts.
 */
async function driveProjectDataRefresh(input: {
    readonly ownerPage: Page
    readonly observerPage: Page
    readonly projectId: string
    readonly channelId: string
    readonly suffix: string
    readonly exclude?: readonly string[]
}) {
    const reads = countProjectDataReads(input.observerPage, input.exclude ?? [])
    const before = reads()
    // A rename advances the channel revision and the contract rejects a stale
    // one, so the current revision is read before each rename.
    const channels = await input.ownerPage.request.get(`/api/projects/${input.projectId}/channels`)
    expect(channels.status()).toBe(200)
    const current = (
        (await channels.json()) as { channels: { id: string; revision: number }[] }
    ).channels.find(channel => channel.id === input.channelId)
    if (current === undefined) throw new Error('The renamed channel is missing from the project')
    const response = await input.ownerPage.request.patch(
        `/api/projects/${input.projectId}/channels/${input.channelId}`,
        {
            data: {
                name: `E2E-314 renamed ${input.suffix}`,
                expectedRevision: current.revision,
            },
        }
    )
    expect(response.status()).toBe(200)

    // The traversal is only worth anything if it demonstrably reached the
    // observer. Requiring an observed refetch means a stream that silently stops
    // delivering fails this helper instead of turning the caller's negative
    // assertions into a vacuous pass.
    await expect.poll(reads, { timeout: 20_000 }).toBeGreaterThanOrEqual(before + 1)
    await input.observerPage.waitForTimeout(REFRESH_BURST_SETTLE_MS)
}

/**
 * Makes the observer page reread the editor by having the owner save the same
 * draft. That emits `project.draft-changed`, which is the mechanism ADR-076
 * relies on, so a reconciled editor is exercised rather than merely observed.
 */
async function driveEditorReread(input: {
    readonly ownerPage: Page
    readonly observerPage: Page
    readonly projectId: string
    readonly publicationId: string
}) {
    const editorState = await input.ownerPage.request.get(
        `/api/projects/${input.projectId}/publications/${input.publicationId}/editor`
    )
    expect(editorState.status()).toBe(200)
    const revision = ((await editorState.json()) as { editor: { draft: { revision: number } } })
        .editor.draft.revision
    const saved = await input.ownerPage.request.patch(
        `/api/projects/${input.projectId}/publications/${input.publicationId}/draft`,
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
    expect(saved.status()).toBe(200)
    await input.observerPage.waitForTimeout(REFRESH_BURST_SETTLE_MS)
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

test('defers the editor reread after confirmation and starts nothing first', async ({ page }) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-314-deferred-${suffix}@herald.local`
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
            `E2E-314 deferred ${suffix}`,
            'e2e-314-deferred-password'
        )
        const member = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()
        await sourceBody.click()
        await editorPage.keyboard.type('Local work awaiting reconciliation')
        await editorPage.keyboard.press('Tab')
        await expect(editorPage.getByRole('status', { name: 'Saved', exact: true })).toBeVisible({
            timeout: 30_000,
        })

        // Hold the verification read and the reconcile reread; count every
        // mutating request so a premature restart would be visible.
        let releaseMembership!: () => void
        const membershipGate = new Promise<void>(resolve => {
            releaseMembership = resolve
        })
        let releaseEditorRead!: () => void
        const editorReadGate = new Promise<void>(resolve => {
            releaseEditorRead = resolve
        })
        let mutatingRequests = 0
        editorPage.on('request', request => {
            const url = new URL(request.url())
            if (request.method() === 'GET' || !url.pathname.startsWith('/api/')) return
            mutatingRequests += 1
        })
        await editorPage.route('**/api/projects/*/membership', async route => {
            await membershipGate
            await route.continue()
        })
        await editorPage.route('**/api/projects/*/publications/*/editor', async route => {
            await editorReadGate
            await route.continue()
        })

        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${member.id}`
        )
        expect(removalResponse.status()).toBe(200)

        // The first write attempted after the revocation starts verification.
        await sourceBody.click()
        await editorPage.keyboard.type(' plus a revealing attempt')
        await expect(editorPage.getByText('Checking project access…')).toBeVisible({
            timeout: 90_000,
        })

        // Access is restored, so the held verification confirms and the
        // machine moves to reconciliation with the reread still held.
        const restoredGrant = await page.request.post(
            `/api/projects/${owner.projectId}/user-grants`,
            { data: { userId: member.userId, role: 'editor' } }
        )
        expect(restoredGrant.status()).toBe(201)
        releaseMembership()
        await expect(editorPage.getByText('Confirming the latest server version…')).toBeVisible({
            timeout: 60_000,
        })
        // While the reread is deferred, nothing restarts: no autosave and no
        // other server action may fire before reconciliation succeeds. Two
        // mechanisms could restart it — the 650 ms autosave debounce, and a query
        // invalidation after a live event or a reconnect, whose last round lands
        // at +800 ms. A stream reconnect invalidates publication editors too, so
        // the event is delivered deliberately and the budget outlives both tails.
        const mutatingAtReconciling = mutatingRequests
        await driveProjectDataRefresh({
            ownerPage: page,
            observerPage: editorPage,
            projectId: owner.projectId,
            channelId: publication.channelId,
            suffix,
            exclude: ['/editor', '/membership'],
        })
        expect(mutatingRequests).toBe(mutatingAtReconciling)
        await expect(editorPage.getByText('Confirming the latest server version…')).toBeVisible()

        // Releasing the reread reconciles against an unchanged server, so the
        // local draft resumes and saves normally. The save completes with no
        // remaining local changes, so the existing clean-save cleanup removes
        // the buffer; that absence here proves the success path really applied
        // instead of being quarantined.
        releaseEditorRead()
        await expect(editorPage.getByRole('status', { name: 'Saved', exact: true })).toBeVisible({
            timeout: 60_000,
        })
        await expect(editorPage.getByRole('textbox', { name: 'Body', exact: true })).toContainText(
            'Local work awaiting reconciliation'
        )
        expect(await countRecoveryBuffers(editorPage)).toBe(0)
    } finally {
        await editorContext.close()
    }
})

test('a failing reread stays suspended with explicit resume', async ({ page }) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-314-suspended-${suffix}@herald.local`
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
            `E2E-314 suspended ${suffix}`,
            'e2e-314-suspended-password'
        )
        const member = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()
        await sourceBody.click()
        await editorPage.keyboard.type('Local work surviving a failed reread')
        await editorPage.keyboard.press('Tab')
        await expect
            .poll(() => countRecoveryBuffers(editorPage), { timeout: 15_000 })
            .toBeGreaterThan(0)

        // Hold the verification read and the first reconcile reread.
        let releaseMembership!: () => void
        const membershipGate = new Promise<void>(resolve => {
            releaseMembership = resolve
        })
        let releaseEditorRead!: () => void
        const editorReadGate = new Promise<void>(resolve => {
            releaseEditorRead = resolve
        })
        await editorPage.route('**/api/projects/*/membership', async route => {
            await membershipGate
            await route.continue()
        })
        await editorPage.route('**/api/projects/*/publications/*/editor', async route => {
            await editorReadGate
            await route.continue()
        })

        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${member.id}`
        )
        expect(removalResponse.status()).toBe(200)

        await sourceBody.click()
        await editorPage.keyboard.type(' plus a revealing attempt')
        await expect(editorPage.getByText('Checking project access…')).toBeVisible({
            timeout: 90_000,
        })

        const restoredGrant = await page.request.post(
            `/api/projects/${owner.projectId}/user-grants`,
            { data: { userId: member.userId, role: 'editor' } }
        )
        expect(restoredGrant.status()).toBe(201)
        releaseMembership()
        await expect(editorPage.getByText('Confirming the latest server version…')).toBeVisible({
            timeout: 60_000,
        })
        // Access disappears again before the reread answers: the reread fails
        // and the editor must stay suspended instead of resuming or denying.
        const revokedAgain = await waitForProjectMember(page, owner.projectId, editorEmail)
        const secondRemoval = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${revokedAgain.id}`
        )
        expect(secondRemoval.status()).toBe(200)
        releaseEditorRead()
        await expect(editorPage.getByText('Application could not be confirmed.')).toBeVisible({
            timeout: 60_000,
        })
        await expect(editorPage.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
        await expect(editorPage.getByRole('textbox', { name: 'Body', exact: true })).toHaveCount(0)
        await expect(
            editorPage.getByText('Local work surviving a failed reread').first()
        ).toBeVisible()
        expect(await countRecoveryBuffers(editorPage)).toBe(1)

        // Explicit resume re-runs the chain once access is restored again.
        const restoredGrantAgain = await page.request.post(
            `/api/projects/${owner.projectId}/user-grants`,
            { data: { userId: member.userId, role: 'editor' } }
        )
        expect(restoredGrantAgain.status()).toBe(201)
        await editorPage.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(editorPage.getByRole('status', { name: 'Saved', exact: true })).toBeVisible({
            timeout: 60_000,
        })
        await expect(editorPage.getByRole('textbox', { name: 'Body', exact: true })).toContainText(
            'Local work surviving a failed reread'
        )
        // The resumed save completed with no remaining local changes, so the
        // existing clean-save cleanup removed the buffer; that absence proves
        // the resume path really applied instead of quarantining.
        expect(await countRecoveryBuffers(editorPage)).toBe(0)
    } finally {
        await editorContext.close()
    }
})

test('close refusals before the next render still verify once', async ({ page }) => {
    test.setTimeout(300_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    const publication = await createPublication(page, owner.projectId, suffix)

    const editorEmail = `e2e-314-once-${suffix}@herald.local`
    const editorInvitation = await createProjectInvitation(page, owner.projectId, editorEmail)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-314 browser was not created')

    const editorContext = await browser.newContext()
    const editorPage = await editorContext.newPage()

    // Fully degrade the transport for this test: with the event streams cut,
    // no flap-driven project-data refetch can issue a membership read, so the
    // request count below measures verification launches only.
    await editorPage.route('**/api/projects/*/events', route => route.abort())
    await editorPage.route('**/api/notifications/events', route => route.abort())

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-314 once ${suffix}`,
            'e2e-314-once-password'
        )
        const member = await waitForProjectMember(page, owner.projectId, editorEmail)

        await editorPage.goto(
            `/dashboard/projects/${owner.projectId}/publications/${publication.id}`
        )
        const sourceBody = editorPage.getByRole('textbox', { name: 'Body', exact: true })
        await expect(sourceBody).toBeVisible()

        // Hold every draft write and the verification read. Two writes stuck
        // in flight resolve together after the revocation, so both refusals
        // reach the machine before React can render between them.
        let releaseDrafts!: () => void
        const draftsGate = new Promise<void>(resolve => {
            releaseDrafts = resolve
        })
        await editorPage.route('**/api/projects/*/publications/*/draft', async route => {
            if (route.request().method() !== 'PATCH') {
                await route.continue()
                return
            }
            await draftsGate
            await route.continue()
        })
        let releaseMembership!: () => void
        const membershipGate = new Promise<void>(resolve => {
            releaseMembership = resolve
        })
        await editorPage.route('**/api/projects/*/membership', async route => {
            await membershipGate
            await route.continue()
        })
        let membershipRequests = 0
        editorPage.on('request', request => {
            if (new URL(request.url()).pathname.endsWith('/membership')) {
                membershipRequests += 1
            }
        })

        await sourceBody.click()
        await editorPage.keyboard.type('first stuck write')
        const draftWritePattern = (request: Request) =>
            request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/draft')
        await editorPage.waitForRequest(draftWritePattern, { timeout: 30_000 })
        await editorPage.keyboard.type(' plus second stuck write')
        await editorPage.waitForRequest(draftWritePattern, { timeout: 30_000 })
        await expect
            .poll(() => countRecoveryBuffers(editorPage), { timeout: 15_000 })
            .toBeGreaterThan(0)

        const removalResponse = await page.request.delete(
            `/api/projects/${owner.projectId}/members/${member.id}`
        )
        expect(removalResponse.status()).toBe(200)

        // Release both writes at once: the two refusals land in the same
        // microtask drain, yet a single verification read must start.
        releaseDrafts()
        await expect(editorPage.getByText('Checking project access…')).toBeVisible({
            timeout: 90_000,
        })
        // This spec cuts both streams on purpose so that only verification
        // launches can issue a membership read. That makes the browser's own
        // EventSource retry the mechanism that could produce a flap-driven
        // refetch, so the barrier is an observed retry rather than a pause: the
        // attempt count must rise again after the freeze, and only then is
        // exactly-once asserted. The duration is the browser's reconnect
        // interval, which is why this scenario keeps its cost.
        const streamAttempts = countStreamAttempts(editorPage)
        const attemptsAtFreeze = streamAttempts()
        await expect.poll(streamAttempts, { timeout: 30_000 }).toBeGreaterThan(attemptsAtFreeze)
        await editorPage.waitForTimeout(REFRESH_BURST_SETTLE_MS)
        expect(membershipRequests).toBe(1)

        releaseMembership()
        await expect(editorPage.getByText('Project access removed')).toBeVisible({
            timeout: 60_000,
        })
        expect(await countRecoveryBuffers(editorPage)).toBe(1)
    } finally {
        await editorContext.close()
    }
})
