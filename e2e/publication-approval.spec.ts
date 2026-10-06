import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('shows an API-prepared publication for human approval before it is scheduled', async ({
    page,
}) => {
    test.setTimeout(60_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: `Approval destination ${suffix}` },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }

    const keyResponse = await page.request.post('/api/api-keys', {
        data: {
            projectIds: [projectId],
            actionAccess: ['publication:manage'],
        },
    })
    expect(keyResponse.status()).toBe(201)
    const { token } = (await keyResponse.json()) as { token: string }

    const title = `Agent proposal ${suffix}`
    const proposedScheduledAt = Date.now() + 60 * 60 * 1_000
    const draftResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        headers: { authorization: `Bearer ${token}` },
        data: {
            title,
            sourceContent: {
                body: { text: `Prepared without dispatch ${suffix}`, format: 'plain_text' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(draftResponse.status()).toBe(201)
    const draftBody = (await draftResponse.json()) as {
        publications: Array<{ id: string; state: string }>
    }
    const publication = draftBody.publications[0]
    if (publication === undefined) throw new Error('The agent draft was not returned')
    expect(publication.state).toBe('draft')

    const requestResponse = await page.request.post(
        `/api/projects/${projectId}/publications/${publication.id}/approval-request`,
        {
            headers: { authorization: `Bearer ${token}` },
            data: { expectedDraftRevision: 1, proposedScheduledAt },
        }
    )
    expect(requestResponse.status()).toBe(201)

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    const approvalSection = page.getByRole('region', { name: 'Awaiting approval' })
    await expect(approvalSection).toBeVisible()
    await expect(approvalSection.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(approvalSection).toContainText('Proposed for')
    await expect(
        approvalSection.getByRole('button', { name: 'Approve & schedule', exact: true })
    ).toBeEnabled()

    for (const width of [1280, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(approvalSection).toBeVisible()
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        expect(
            await page
                .locator('[data-dashboard-scroll]')
                .evaluate(element => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
    }
    await page.locator('[data-slot="language-switcher-trigger"]').click()
    await page.getByRole('menuitem', { name: en.language_french, exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    const translatedSection = page.getByRole('region', { name: fr.approval_requests_title })
    await expect(translatedSection).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    const approve = translatedSection.getByRole('button', {
        name: fr.approval_requests_approve,
        exact: true,
    })
    // Exercise presentation of a refused legacy request. Actual profile activation
    // supersedes pending requests, so this UI boundary uses the server error contract.
    const approvalUrl = `**/api/projects/${projectId}/publications/${publication.id}/approval-request/approve`
    await page.route(approvalUrl, route =>
        route.fulfill({
            status: 400,
            json: {
                error: {
                    code: 'invalid_content',
                    message:
                        'Publication target content is incompatible with the active channel profile fixture v2 while it satisfies fixture v1: Content too long',
                },
            },
        })
    )
    await approve.click()
    await expect(translatedSection.getByRole('alert')).toHaveText(
        fr.approval_requests_active_profile_mismatch
    )
    await expect(approve).toBeEnabled()
    const retainedResponse = await page.request.get(
        `/api/projects/${projectId}/publications/${publication.id}/editor`
    )
    expect(retainedResponse.status()).toBe(200)
    expect(await retainedResponse.json()).toMatchObject({
        editor: { publication: { state: 'draft', scheduledAt: null } },
    })
    await page.unroute(approvalUrl)
    await approve.focus()
    await page.keyboard.press('Enter')
    await expect(translatedSection).toHaveCount(0)

    const publicationsResponse = await page.request.get(
        `/api/projects/${projectId}/publications?state=scheduled`
    )
    expect(publicationsResponse.status()).toBe(200)
    expect(await publicationsResponse.json()).toMatchObject({
        publications: [
            {
                id: publication.id,
                state: 'scheduled',
                scheduledAt: proposedScheduledAt,
            },
        ],
    })
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E approval ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(`e2e-approval-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-approval-owner-password')
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
    const projectDialog = page.getByRole('dialog')
    await projectDialog
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E approval project ${suffix}`)
    await projectDialog.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
