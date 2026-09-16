import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('reschedules a selected group of scheduled publications from Queue', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    let currentScheduledAt = Date.now() + 60 * 60 * 1_000
    let reschedulePayload: { publicationIds: string[]; scheduledAt: number } | null = null
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
                    publications: publications.map(publication =>
                        publication.state === 'scheduled'
                            ? { ...publication, scheduledAt: currentScheduledAt }
                            : publication
                    ),
                    summary: { total: 3, manual: 0, automatic: 3, scheduled: 2 },
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

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    const selectionToggles = page.locator('[data-publication-selection-toggle="true"]')
    await expect(selectionToggles).toHaveCount(3)

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
    const nextSchedule = Date.now() + 2 * 60 * 60 * 1_000
    await page.getByLabel('Deliver at', { exact: true }).fill(toDateTimeLocal(nextSchedule))
    await page.getByRole('button', { name: 'Apply schedule', exact: true }).click()

    await expect
        .poll(() => reschedulePayload)
        .toEqual({
            publicationIds: [firstPublication.id, secondPublication.id],
            scheduledAt: expect.any(Number),
        })
    await expect(page.locator('[data-bulk-action-bar="true"]')).toHaveCount(0)
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

function toDateTimeLocal(timestamp: number): string {
    const date = new Date(timestamp)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E queue bulk ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-queue-bulk-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-queue-bulk-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E queue bulk project ${suffix}`)
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
