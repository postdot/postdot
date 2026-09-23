import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { frenchTranslation } from './locale'

test('keeps failed and ambiguous publications legible across queue and overview', async ({
    page,
}) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const scheduledAt = currentMonthNoon()
    const failedTitle = `E2E-124 failed ${suffix}`
    const ambiguousTitle = `E2E-124 ambiguous ${suffix}`
    const publications = [
        publicationFixture({
            channelName: 'Failed destination',
            errorMessage: 'The provider rejected this publication',
            id: `e2e-124-failed-${suffix}`,
            postTitle: failedTitle,
            projectId,
            scheduledAt,
            state: 'failed',
        }),
        publicationFixture({
            channelName: 'Review destination',
            errorMessage: 'The provider outcome is unknown',
            id: `e2e-124-ambiguous-${suffix}`,
            postTitle: ambiguousTitle,
            projectId,
            scheduledAt,
            state: 'ambiguous',
        }),
    ]
    await createTestChannel(page, projectId, `E2E-124 outcome channel ${suffix}`)

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

            const response = await route.fetch()
            await response.body()
            await route.fulfill({
                status: response.status(),
                contentType: 'application/json',
                body: JSON.stringify({
                    publications,
                    nextCursor: null,
                    summary: { total: 2, manual: 0, automatic: 2, scheduled: 2 },
                }),
            })
        }
    )

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()

    const failedPublication = page.getByRole('link').filter({ hasText: failedTitle })
    const ambiguousPublication = page.getByRole('link').filter({ hasText: ambiguousTitle })
    const ambiguousCard = page
        .locator('[data-publication-selection-card="true"]')
        .filter({ hasText: ambiguousTitle })
    await expect(failedPublication).toContainText('Failed')
    await expect(ambiguousPublication).toContainText('Needs review')
    await expect(
        ambiguousCard.getByRole('button', { name: 'Review outcome', exact: true })
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Needs attention (2)', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: failedTitle })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toBeVisible()

    for (const viewport of [
        { height: 720, width: 1280 },
        { height: 900, width: 768 },
        { height: 844, width: 390 },
    ]) {
        await page.setViewportSize(viewport)
        const layout = await page.locator('[data-dashboard-scroll]').evaluate(scrollRegion => ({
            clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
            scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
        }))
        expect(
            layout.scrollWidth,
            `horizontal overflow at ${viewport.width}px`
        ).toBeLessThanOrEqual(layout.clientWidth)
        await expect(page.getByRole('link').filter({ hasText: failedTitle })).toBeVisible()
        await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(page.getByRole('link').filter({ hasText: failedTitle })).toContainText(
        frenchTranslation('publication_state_failed')
    )
    await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toContainText(
        frenchTranslation('publication_state_needs_review')
    )

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('link', { name: 'Vue d’ensemble', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible()
    const overviewCalendar = page.locator('[data-calendar="reui"]')
    await expect(overviewCalendar).toBeVisible()
    await expect(
        overviewCalendar.getByRole('button', { name: new RegExp(failedTitle) })
    ).toBeVisible()
    await expect(
        overviewCalendar.getByRole('button', { name: new RegExp(ambiguousTitle) })
    ).toBeVisible()
})

function publicationFixture(input: {
    readonly channelName: string
    readonly errorMessage: string
    readonly id: string
    readonly postTitle: string
    readonly projectId: string
    readonly scheduledAt: number
    readonly state: 'ambiguous' | 'failed'
}) {
    return {
        channelId: `${input.id}-channel`,
        channelName: input.channelName,
        createdAt: input.scheduledAt - 60_000,
        createdByActorId: 'e2e-124-actor',
        deliveryMode: 'automatic' as const,
        draftDiffersFromTarget: false,
        draftReviewState: 'compatible' as const,
        draftRevision: 1,
        errorMessage: input.errorMessage,
        externalId: null,
        externalUrl: null,
        id: input.id,
        lastAssessedProfileVersionId: 'e2e-124-profile',
        postId: `${input.id}-post`,
        postTitle: input.postTitle,
        profileAssessmentIssues: [],
        publishedAt: null,
        publishedByActorId: null,
        projectId: input.projectId,
        reviewState: 'compatible' as const,
        scheduledAt: input.scheduledAt,
        scheduledByActorId: 'e2e-124-actor',
        state: input.state,
        stateChangedByActorId: 'e2e-124-actor',
        targetRevisionId: `${input.id}-target`,
    }
}

async function createTestChannel(page: Page, projectId: string, name: string): Promise<void> {
    const response = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name, profile: 'manual-message' },
    })
    expect(response.status()).toBe(201)
}

function currentMonthNoon() {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 12)
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-124 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-124-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-124-password')
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
        .fill(`E2E-124 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
