import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('reschedules and cancels selected publications from Queue', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    let currentScheduledAt = Date.now() + 60 * 60 * 1_000
    let reschedulePayload: { publicationIds: string[]; scheduledAt: number } | null = null
    let cancelPayload: { publicationIds: string[] } | null = null
    const cancelledPublicationIds = new Set<string>()
    const publications = [
        publicationFixture({
            id: `e2e-queue-bulk-scheduled-1-${suffix}`,
            postTitle: `E2E bulk scheduled one ${suffix}`,
            projectId,
            scheduledAt: currentScheduledAt,
            state: 'scheduled',
        }),
        publicationFixture({
            id: `e2e-queue-bulk-scheduled-2-${suffix}`,
            postTitle: `E2E bulk scheduled two ${suffix}`,
            projectId,
            scheduledAt: currentScheduledAt,
            state: 'scheduled',
        }),
        publicationFixture({
            id: `e2e-queue-bulk-draft-${suffix}`,
            postTitle: `E2E bulk draft ${suffix}`,
            projectId,
            scheduledAt: null,
            state: 'draft',
        }),
    ]
    publications[2]!.postId = publications[0]!.postId
    publications[2]!.postTitle = publications[0]!.postTitle
    const [firstPublication, secondPublication] = publications
    if (firstPublication === undefined || secondPublication === undefined) {
        throw new Error('Expected two scheduled publications')
    }

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
                body: JSON.stringify({
                    nextCursor: null,
                    publications: publications
                        .filter(publication => {
                            const state = requestUrl.searchParams.get('state')
                            return state === null || publication.state === state
                        })
                        .map(publication => {
                            if (cancelledPublicationIds.has(publication.id)) {
                                return {
                                    ...publication,
                                    scheduledAt: currentScheduledAt,
                                    state: 'cancelled',
                                }
                            }
                            return publication.state === 'scheduled'
                                ? { ...publication, scheduledAt: currentScheduledAt }
                                : publication
                        }),
                    summary: {
                        total: 3,
                        manual: 0,
                        automatic: 3,
                        scheduled: 2 - cancelledPublicationIds.size,
                    },
                }),
            })
        }
    )
    await page.route(`**/api/projects/${projectId}/publications/schedule`, async route => {
        if (route.request().method() !== 'PATCH') {
            await route.continue()
            return
        }

        const body = route.request().postDataJSON() as {
            publicationIds: string[]
            scheduledAt: number
        }
        reschedulePayload = body
        currentScheduledAt = body.scheduledAt
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                publications: publications
                    .filter(publication => body.publicationIds.includes(publication.id))
                    .map(publication => ({ ...publication, scheduledAt: body.scheduledAt })),
            }),
        })
    })
    await page.route(`**/api/projects/${projectId}/publications/cancel`, async route => {
        if (route.request().method() !== 'PATCH') {
            await route.continue()
            return
        }

        const body = route.request().postDataJSON() as { publicationIds: string[] }
        cancelPayload = body
        for (const publicationId of body.publicationIds) cancelledPublicationIds.add(publicationId)
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                publications: publications
                    .filter(publication => body.publicationIds.includes(publication.id))
                    .map(publication => ({
                        ...publication,
                        scheduledAt: currentScheduledAt,
                        state: 'cancelled',
                    })),
            }),
        })
    })

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    const selectionToggles = page.locator('[data-publication-selection-toggle="true"]')
    await expect(selectionToggles).toHaveCount(3)
    const view = page.getByRole('combobox', { name: 'Queue view', exact: true })
    await view.click()
    await page.getByRole('option', { name: 'By post', exact: true }).click()
    await expect(page).toHaveURL(/view=posts/)
    const groups = page.locator('[data-queue-post-group]')
    await expect(groups).toHaveCount(2)
    await expect(groups.first()).toContainText('2 destinations in these results')
    await expect(groups.first().locator('[data-publication-selection-toggle="true"]')).toHaveCount(
        2
    )
    await expect(groups.first()).toContainText('Queued')
    await expect(groups.first()).toContainText('Draft')
    await expect(
        groups.first().getByRole('link', { name: 'View post', exact: true })
    ).toHaveAttribute('href', `/dashboard/projects/${projectId}/posts/${firstPublication.postId}`)
    await groups.first().locator('[data-publication-selection-toggle="true"]').first().click()
    await expect(page.locator('[data-publication-selection-active="true"]')).toHaveCount(1)
    await view.click()
    await page.getByRole('option', { name: 'Publication order', exact: true }).click()
    await expect(page.locator('[data-publication-selection-active="true"]')).toHaveCount(1)
    await view.click()
    await page.getByRole('option', { name: 'By post', exact: true }).click()
    await page.reload()
    await expect(groups).toHaveCount(2)
    await page.getByRole('tab', { name: /^Drafts/ }).click()
    await expect(groups).toHaveCount(1)
    await expect(groups.first()).toContainText('1 destination in these results')
    await expect(selectionToggles).toHaveCount(1)
    await page.getByRole('tab', { name: /^All / }).click()
    await expect(groups).toHaveCount(2)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(groups.first().getByRole('link', { name: 'View post', exact: true })).toBeVisible()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({ path: '/tmp/herald-content382-narrow.png', fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({ path: '/tmp/herald-content382-wide.png', fullPage: true })
    await view.click()
    await page.getByRole('option', { name: 'Publication order', exact: true }).click()
    await expect(groups).toHaveCount(0)
    await expect(selectionToggles).toHaveCount(3)
    const queueBulkActionBar = page.locator('[data-bulk-action-bar="true"]')
    await expect(queueBulkActionBar).toBeVisible()
    await expect(
        queueBulkActionBar.getByRole('button', { name: 'Reschedule', exact: true })
    ).toHaveCount(0)
    const publicationTable = page.locator('[data-publication-table-header="true"]')
    const initialTableTop = await publicationTable.evaluate(
        element => element.getBoundingClientRect().top
    )
    const selectAllControl = page.locator('[data-queue-select-all="true"]')
    const selectAllCheckbox = selectAllControl.locator('input[type="checkbox"]')
    await expect(selectAllControl).toBeVisible()
    await selectAllControl.click()
    await expect(page.locator('[data-publication-selection-active="true"]')).toHaveCount(3)
    await expect(selectAllCheckbox).toBeChecked()
    await expect
        .poll(async () => {
            const tableTop = await publicationTable.evaluate(
                element => element.getBoundingClientRect().top
            )
            return Math.abs(tableTop - initialTableTop)
        })
        .toBeLessThanOrEqual(1)
    await selectAllControl.click()
    await expect(page.locator('[data-publication-selection-active="true"]')).toHaveCount(0)
    await expect(selectAllCheckbox).not.toBeChecked()
    await expect(
        queueBulkActionBar.getByRole('button', { name: 'Reschedule', exact: true })
    ).toHaveCount(0)

    await selectionToggles.nth(0).click()
    await selectionToggles.nth(1).click()
    await expect(page.locator('[data-bulk-action-bar="true"]')).toContainText('2 selected')
    const rescheduleButton = page.getByRole('button', { name: 'Reschedule', exact: true })
    await expect(rescheduleButton).toBeEnabled()

    await selectionToggles.nth(2).click()
    await expect(rescheduleButton).toBeDisabled()
    await selectionToggles.nth(2).click()
    await rescheduleButton.click()

    await expect(
        page.getByRole('heading', { name: 'Reschedule 2 publications', exact: true })
    ).toBeVisible()
    await page.getByLabel('Deliver at', { exact: true }).click()
    await expect(page.getByLabel('Time', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Apply schedule', exact: true }).click()

    await expect
        .poll(() => reschedulePayload)
        .toEqual({
            publicationIds: [firstPublication.id, secondPublication.id],
            scheduledAt: expect.any(Number),
        })
    await expect(queueBulkActionBar).toBeVisible()
    await expect(
        queueBulkActionBar.getByRole('button', { name: 'Reschedule', exact: true })
    ).toHaveCount(0)

    await selectionToggles.nth(0).click()
    const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancelButton).toBeEnabled()
    await cancelButton.click()
    await expect(
        page.getByRole('heading', { name: 'Cancel 1 publication', exact: true })
    ).toBeVisible()
    await expect.poll(() => cancelPayload).toBeNull()
    await page.getByRole('button', { name: 'Cancel publications', exact: true }).click()
    await expect
        .poll(() => cancelPayload)
        .toEqual({
            publicationIds: [firstPublication.id],
        })
    await expect(queueBulkActionBar).toBeVisible()
    await expect(
        queueBulkActionBar.getByRole('button', { name: 'Reschedule', exact: true })
    ).toHaveCount(0)
})

function publicationFixture(input: {
    readonly id: string
    readonly postTitle: string
    readonly projectId: string
    readonly scheduledAt: number | null
    readonly state: 'draft' | 'scheduled'
}) {
    return {
        channelId: `${input.id}-channel`,
        channelName: 'E2E queue destination',
        createdAt: input.scheduledAt ?? 1,
        createdByActorId: 'e2e-queue-bulk-actor',
        deliveryMode: 'automatic' as const,
        draftDiffersFromTarget: false,
        draftReviewState: 'compatible' as const,
        draftRevision: 1,
        errorMessage: null,
        externalId: null,
        externalUrl: null,
        id: input.id,
        lastAssessedProfileVersionId: 'e2e-queue-bulk-profile',
        postId: `${input.id}-post`,
        postTitle: input.postTitle,
        profileAssessmentIssues: [],
        publishedAt: null,
        publishedByActorId: null,
        projectId: input.projectId,
        reviewState: 'compatible' as const,
        scheduledAt: input.scheduledAt,
        scheduledByActorId: 'e2e-queue-bulk-actor',
        state: input.state,
        stateChangedByActorId: 'e2e-queue-bulk-actor',
        targetRevisionId: `${input.id}-target`,
        updatedAt: input.scheduledAt ?? 1,
    }
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E queue bulk ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-queue-bulk-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-queue-bulk-password')
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
        .fill(`E2E queue bulk project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
