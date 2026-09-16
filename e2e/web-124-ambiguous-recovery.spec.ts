import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('resolves an ambiguous publication without retrying the provider', async ({ page }) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E-124 recovery channel ${suffix}`
    const publicationTitle = `E2E-124 recovery ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('button', { name: 'New publication', exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill(publicationTitle)
    await page.getByLabel('Content', { exact: true }).fill('E2E recovery content')
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const publicationLink = page.getByRole('link').filter({ hasText: publicationTitle }).first()
    await expect(publicationLink).toBeVisible()
    const publicationHref = await publicationLink.getAttribute('href')
    if (publicationHref === null) throw new Error('Expected a publication editor link')
    const publicationId = publicationHref.split('/').at(-1)
    if (publicationId === undefined || publicationId.length === 0) {
        throw new Error(`Expected a publication id in ${publicationHref}`)
    }

    let editorResponse: { editor: Record<string, unknown> } | undefined
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/editor`,
        async route => {
            if (route.request().method() !== 'GET') {
                await route.continue()
                return
            }

            const response = await route.fetch()
            const body = (await response.json()) as { editor: Record<string, unknown> }
            const publication = body.editor.publication as Record<string, unknown>
            editorResponse = body
            await route.fulfill({
                status: response.status(),
                contentType: 'application/json',
                body: JSON.stringify({
                    editor: {
                        ...body.editor,
                        publication: {
                            ...publication,
                            errorMessage: 'The provider response was lost',
                            state: 'ambiguous',
                        },
                    },
                }),
            })
        }
    )

    let reconcileCalls = 0
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/reconcile`,
        async route => {
            const requestBody = route.request().postDataJSON() as {
                readonly errorMessage?: string
                readonly externalUrl?: string
                readonly resolution: string
            }
            reconcileCalls += 1
            if (reconcileCalls === 1) {
                expect(requestBody).toMatchObject({ resolution: 'failed' })
                await route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: { code: 'request_failed', message: 'Temporary test failure' },
                    }),
                })
                return
            }

            expect(requestBody).toEqual({
                externalUrl: 'https://example.test/herald/recovery',
                resolution: 'published',
            })
            const publication = editorResponse?.editor.publication
            if (publication === undefined) throw new Error('Editor fixture was not loaded')
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    publication: {
                        ...publication,
                        errorMessage: null,
                        externalUrl: requestBody.externalUrl,
                        publishedAt: Date.now(),
                        state: 'published',
                    },
                }),
            })
        }
    )

    await publicationLink.click()
    await expect(page.getByRole('alert')).toContainText('Publication outcome needs your decision')
    await expect(page.getByRole('button', { name: 'Mark as published', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as failed', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Mark as failed', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('The request could not be completed.')
    await expect(page.getByRole('button', { name: 'Mark as published', exact: true })).toBeVisible()

    await page.getByLabel('Published URL (optional)').fill('https://example.test/herald/recovery')
    await page.getByRole('button', { name: 'Mark as published', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(reconcileCalls).toBe(2)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-124 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-124-recovery-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-124-recovery-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E-124 recovery project ${suffix}`)
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
