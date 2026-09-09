import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps failed and ambiguous publications legible across queue and calendar', async ({
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

    await page.route(`**/api/projects/${projectId}/publications`, async route => {
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
            body: JSON.stringify({ publications }),
        })
    })

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()

    const failedPublication = page.getByRole('link').filter({ hasText: failedTitle })
    const ambiguousPublication = page.getByRole('link').filter({ hasText: ambiguousTitle })
    await expect(failedPublication).toContainText('Failed')
    await expect(ambiguousPublication).toContainText('Needs review')

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
    await expect(page.getByRole('link').filter({ hasText: failedTitle })).toContainText('Échec')
    await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toContainText(
        'À vérifier'
    )

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('link', { name: 'Calendrier', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Calendrier', exact: true })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: failedTitle })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: ambiguousTitle })).toBeVisible()
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

function currentMonthNoon() {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 12)
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-124 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-124-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-124-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByText('Create project', { exact: true }).click()
    await page.locator('#new-project').fill(`E2E-124 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
