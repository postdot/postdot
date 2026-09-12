import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('uses the calendar as the project overview and keeps Queue distinct', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const scheduledAt = currentMonthNoon()
    const publications = Array.from({ length: 8 }, (_, index) =>
        publicationFixture({
            channelName: index % 2 === 0 ? 'Editorial channel' : 'Community channel',
            deliveryMode: index % 2 === 0 ? 'automatic' : 'manual',
            id: `e2e-122-publication-${index + 1}-${suffix}`,
            postTitle: `E2E-122 publication ${index + 1} ${suffix}`,
            projectId,
            scheduledAt: index < 4 ? scheduledAt + index * 3_600_000 : null,
            state: index === 0 ? 'ready' : index < 4 ? 'scheduled' : 'draft',
        })
    )
    const duePublication = {
        ...publications[0],
        deliveryMode: 'manual' as const,
        state: 'ready' as const,
        targetContent: { body: 'A publication waiting for a human confirmation.' },
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
                    publications,
                    nextCursor: null,
                    summary: { total: 8, manual: 4, automatic: 4, scheduled: 4 },
                }),
            })
        }
    )
    await page.route(`**/api/projects/${projectId}/publications/due`, async route => {
        const requestUrl = new URL(route.request().url())
        if (
            route.request().method() !== 'GET' ||
            requestUrl.pathname !== `/api/projects/${projectId}/publications/due`
        ) {
            await route.continue()
            return
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ publications: [duePublication] }),
        })
    })

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const overviewSummary = page.getByLabel('Overview summary', { exact: true })
    await expect(overviewSummary).toContainText('4 scheduled')
    await expect(overviewSummary).toContainText('4 unscheduled')
    await expect(overviewSummary).toContainText('1 needs attention')
    const overviewCalendar = page.locator('[data-calendar-view="month"]')
    await expect(overviewCalendar).toBeVisible()
    await expect(overviewCalendar.locator('a[href*="/publications/"]')).toHaveCount(3)
    await expect(overviewCalendar.getByText('+1', { exact: true })).toBeVisible()
    await expect(
        overviewCalendar.getByText(`E2E-122 publication 7 ${suffix}`, { exact: true })
    ).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-calendar-view="agenda"]')).toBeVisible()

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'All (8)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Needs attention (1)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Scheduled (4)', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Manual (4)', exact: true })).toBeVisible()
    await expect(page.locator('a[href*="/publications/"]')).toHaveCount(8)

    const queueAttentionBox = await page
        .getByRole('heading', { name: 'Needs attention', exact: true })
        .boundingBox()
    const queuePublicationsBox = await page
        .getByRole('heading', { name: 'Publications', exact: true })
        .boundingBox()
    expect(queueAttentionBox?.y).toBeLessThan(queuePublicationsBox?.y ?? Number.POSITIVE_INFINITY)

    await page.getByRole('tab', { name: 'Needs attention (1)', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 1' })).toHaveCount(1)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Scheduled (4)', exact: true }).click()
    await expect(page.locator('a[href*="/publications/"]')).toHaveCount(4)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 1' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 4' })).toBeVisible()

    await page.getByRole('tab', { name: 'Manual (4)', exact: true }).click()
    await expect(page.locator('a[href*="/publications/"]')).toHaveCount(4)
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 2' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: 'E2E-122 publication 8' })).toBeVisible()
})

function publicationFixture(input: {
    readonly channelName: string
    readonly deliveryMode: 'automatic' | 'manual'
    readonly id: string
    readonly postTitle: string
    readonly projectId: string
    readonly scheduledAt: number | null
    readonly state: 'draft' | 'ready' | 'scheduled'
}) {
    return {
        channelId: `${input.id}-channel`,
        channelName: input.channelName,
        createdAt: input.scheduledAt ?? 1,
        createdByActorId: 'e2e-122-actor',
        deliveryMode: input.deliveryMode,
        draftDiffersFromTarget: false,
        draftReviewState: 'compatible' as const,
        draftRevision: 1,
        errorMessage: null,
        externalId: null,
        externalUrl: null,
        id: input.id,
        lastAssessedProfileVersionId: 'e2e-122-profile',
        postId: `${input.id}-post`,
        postTitle: input.postTitle,
        profileAssessmentIssues: [],
        publishedAt: null,
        publishedByActorId: null,
        projectId: input.projectId,
        reviewState: 'compatible' as const,
        scheduledAt: input.scheduledAt,
        scheduledByActorId: 'e2e-122-actor',
        state: input.state,
        stateChangedByActorId: 'e2e-122-actor',
        targetRevisionId: `${input.id}-target`,
        updatedAt: input.scheduledAt ?? 1,
    }
}

function currentMonthNoon() {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 12)
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-122 populated ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-122-populated-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-122-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E-122 populated project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
