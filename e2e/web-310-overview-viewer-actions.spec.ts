import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

// Compare permissions in the same calendar day for every actor, independent of the host zone.
test.use({ timezoneId: 'UTC' })

test('Overview withholds viewer create and bulk actions while keeping consultation', async ({
    page,
}) => {
    test.setTimeout(180_000)

    const suffix = randomUUID().slice(0, 8)
    const owner = await createAccountAndProject(page, suffix)
    await createChannel(page, owner.projectId, `E2E-310 channel ${suffix}`)

    // Anchor the publication inside the currently focused civil day so the
    // week, day and agenda readings all contain it.
    const scheduledAt = await page.evaluate(() => {
        const scheduledDate = new Date()
        scheduledDate.setHours(10, 5, 0, 0)
        if (scheduledDate.getTime() < Date.now()) scheduledDate.setHours(16, 5, 0, 0)
        return scheduledDate.getTime()
    })
    await mockCalendarPublications(page, owner.projectId, scheduledAt, suffix)

    const browser = page.context().browser()
    expect(browser).not.toBeNull()
    if (browser === null) throw new Error('The WEB-310 browser was not created')

    // Owner: the create and selection entry points are offered.
    await page.goto(`/dashboard/projects/${owner.projectId}/overview`)
    await expect(page.locator('[data-calendar="reui"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New publication', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reschedule', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)

    const viewerEmail = `e2e-310-viewer-${suffix}@postdot.local`
    const viewerInvitation = await createProjectInvitation(
        page,
        owner.projectId,
        viewerEmail,
        'viewer'
    )
    const viewerContext = await browser.newContext({ timezoneId: 'UTC' })
    const viewerPage = await viewerContext.newPage()
    await mockCalendarPublications(viewerPage, owner.projectId, scheduledAt, suffix)

    try {
        await acceptProjectInvitation(
            viewerPage,
            viewerInvitation,
            owner.projectId,
            viewerEmail,
            `E2E-310 viewer ${suffix}`,
            'e2e-310-viewer-password'
        )

        await viewerPage.goto(`/dashboard/projects/${owner.projectId}/overview`)

        // The calendar must be rendered before absence assertions mean
        // anything, otherwise they pass against a page that has not loaded yet.
        await expect(viewerPage.locator('[data-calendar="reui"]')).toBeVisible()

        // Forbidden actions are not offered at all.
        await expect(
            viewerPage.getByRole('button', { name: 'New publication', exact: true })
        ).toHaveCount(0)
        await expect(viewerPage.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0)
        await expect(
            viewerPage.getByRole('button', { name: 'Create publication', exact: true })
        ).toHaveCount(0)
        await expect(
            viewerPage.getByRole('button', { name: 'Reschedule', exact: true })
        ).toHaveCount(0)
        await expect(viewerPage.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)

        // Every reading mode stays readable and offers no create entry.
        for (const view of ['month', 'week', 'day', 'agenda'] as const) {
            await viewerPage.goto(`/dashboard/projects/${owner.projectId}/overview?view=${view}`)
            await expect(viewerPage.locator('[data-calendar="reui"]')).toBeVisible()
            await expect(
                viewerPage.getByRole('button', { name: 'New publication', exact: true })
            ).toHaveCount(0)
            await expect(
                viewerPage.getByRole('button', { name: 'Select', exact: true })
            ).toHaveCount(0)
            await expect(
                viewerPage.getByRole('button', { name: /^Create publication/ })
            ).toHaveCount(0)
            await expect(
                viewerPage.getByRole('button', { name: 'Reschedule', exact: true })
            ).toHaveCount(0)
            await expect(
                viewerPage.getByRole('button', { name: 'Cancel', exact: true })
            ).toHaveCount(0)

            // Period navigation stays available.
            const previous = viewerPage.getByRole('button', {
                name: 'Previous period',
                exact: true,
            })
            await expect(previous).toBeEnabled()
            const next = viewerPage.getByRole('button', { name: 'Next period', exact: true })
            await expect(next).toBeEnabled()
            await expect(
                viewerPage.getByRole('button', { name: 'Today', exact: true })
            ).toBeEnabled()

            // The publication stays readable in every reading mode, and the
            // click stays inside the calendar rather than the summary widget.
            const calendar = viewerPage.locator('[data-calendar="reui"]')
            const viewerEvent = calendar
                .getByText(`E2E-310 scheduled ${suffix}`, { exact: true })
                .first()
            await expect(viewerEvent).toBeVisible()
            await viewerEvent.click()
            const previewSheet = viewerPage.getByRole('dialog')
            await expect(
                previewSheet.getByRole('button', { name: 'View publication', exact: true })
            ).toBeVisible()
            await expect(
                previewSheet.getByRole('button', { name: 'Edit publication', exact: true })
            ).toHaveCount(0)
            await viewerPage.keyboard.press('Escape')
        }

        // Consultation is unchanged: the publication is still readable and
        // opens in context.
        const viewerEvent = viewerPage
            .locator('[data-calendar="reui"]')
            .getByText(`E2E-310 scheduled ${suffix}`, { exact: true })
            .first()
        await expect(viewerEvent).toBeVisible()
        await viewerEvent.click()
        const monthPreviewSheet = viewerPage.getByRole('dialog')
        await expect(monthPreviewSheet.getByText(`E2E-310 scheduled ${suffix}`)).toBeVisible()
        await expect(
            monthPreviewSheet.getByText('E2E-310 destination', { exact: true })
        ).toBeVisible()
        await viewerPage.keyboard.press('Escape')

        // The server refuses the same operations for this role, which is
        // exactly why the interface no longer offers them.
        const viewerScheduleResponse = await viewerPage.request.patch(
            `/api/projects/${owner.projectId}/publications/schedule`,
            { data: { publicationIds: ['e2e-310-scheduled'], scheduledAt: Date.now() + 60_000 } }
        )
        expect(viewerScheduleResponse.status()).toBe(403)
        const viewerCancelResponse = await viewerPage.request.patch(
            `/api/projects/${owner.projectId}/publications/cancel`,
            { data: { publicationIds: ['e2e-310-scheduled'] } }
        )
        expect(viewerCancelResponse.status()).toBe(403)
        const viewerChannelResponse = await viewerPage.request.post(
            `/api/projects/${owner.projectId}/channels`,
            { data: { name: `E2E-310 viewer channel ${suffix}` } }
        )
        expect(viewerChannelResponse.status()).toBe(403)
    } finally {
        await viewerContext.close()
    }

    const editorEmail = `e2e-310-editor-${suffix}@postdot.local`
    const editorInvitation = await createProjectInvitation(
        page,
        owner.projectId,
        editorEmail,
        'editor'
    )
    const editorContext = await browser.newContext({ timezoneId: 'UTC' })
    const editorPage = await editorContext.newPage()
    await mockCalendarPublications(editorPage, owner.projectId, scheduledAt, suffix)

    try {
        await acceptProjectInvitation(
            editorPage,
            editorInvitation,
            owner.projectId,
            editorEmail,
            `E2E-310 editor ${suffix}`,
            'e2e-310-editor-password'
        )

        await editorPage.goto(`/dashboard/projects/${owner.projectId}/overview`)
        await expect(editorPage.locator('[data-calendar="reui"]')).toBeVisible()
        await expect(
            editorPage.getByRole('button', { name: 'New publication', exact: true })
        ).toBeVisible()

        // Selection stays available and reveals the bulk actions.
        await editorPage.getByRole('button', { name: 'Select', exact: true }).click()
        await editorPage
            .locator('[data-calendar="reui"]')
            .getByText(`E2E-310 scheduled ${suffix}`, { exact: true })
            .first()
            .click()
        const bulkActions = editorPage.getByRole('toolbar', {
            name: 'Calendar publication actions',
        })
        await expect(bulkActions).toBeVisible()
        await expect(
            bulkActions.getByRole('button', { name: 'Reschedule', exact: true })
        ).toBeEnabled()
        await expect(bulkActions.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()

        // The month day-add affordance creates for editors.
        await expect(
            editorPage.getByRole('button', { name: 'Create publication', exact: true }).first()
        ).toBeVisible()
    } finally {
        await editorContext.close()
    }
})

async function mockCalendarPublications(
    page: Page,
    projectId: string,
    scheduledAt: number,
    suffix: string
) {
    const publications = [
        {
            channelId: `e2e-310-channel-${suffix}`,
            channelName: 'E2E-310 destination',
            createdAt: 1,
            createdByActorId: 'e2e-310-actor',
            deliveryMode: 'automatic' as const,
            draftDiffersFromTarget: false,
            draftReviewState: 'compatible' as const,
            draftRevision: 1,
            errorMessage: null,
            externalId: null,
            externalUrl: null,
            id: 'e2e-310-scheduled',
            lastAssessedProfileVersionId: 'e2e-310-profile',
            postId: `e2e-310-post-${suffix}`,
            postTitle: `E2E-310 scheduled ${suffix}`,
            profileAssessmentIssues: [],
            publishedAt: null,
            publishedByActorId: null,
            projectId,
            reviewState: 'compatible' as const,
            scheduledAt,
            scheduledByActorId: 'e2e-310-actor',
            state: 'scheduled' as const,
            stateChangedByActorId: 'e2e-310-actor',
            tags: [],
            updatedAt: 1,
        },
    ]

    await page.route(
        new RegExp(`/api/projects/${projectId}/publications(?:\\?.*)?$`),
        async route => {
            const requestUrl = new URL(route.request().url())
            if (
                route.request().method() !== 'GET' ||
                requestUrl.pathname !== `/api/projects/${projectId}/publications`
            ) {
                await route.continue()
                return
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ nextCursor: null, publications }),
            })
        }
    )
}

async function createChannel(page: Page, projectId: string, name: string) {
    const response = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name },
    })
    expect(response.status()).toBe(201)
}

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
    const email = `e2e-310-owner-${suffix}@postdot.local`
    const projectName = `E2E-310 project ${suffix}`

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-310 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill('e2e-310-owner-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    // Keep invitation fixtures below the membership limit regardless of accounts
    // accumulated by earlier scenarios in the shared runtime.
    const workspaceResponse = await page.request.post('/api/workspaces', {
        data: { name: `E2E-310 workspace ${suffix}` },
    })
    expect(workspaceResponse.status()).toBe(201)
    const { workspace } = (await workspaceResponse.json()) as { workspace: { id: string } }
    await page.goto(`/dashboard?workspaceId=${workspace.id}&projectId=none`)
    await expect(page).toHaveURL(/\/dashboard\?workspaceId=[^&]+&projectId=none$/)

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
