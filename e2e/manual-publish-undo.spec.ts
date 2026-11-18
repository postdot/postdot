import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

// ADR-103 §6: a one-click "Mark published" can be undone, from the list and from the page.
test('undoes a mistaken manual publication record from the queue and the publication page', async ({
    page,
}) => {
    test.setTimeout(60_000)
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Undo reviewer',
                    email: `undo-${randomUUID()}@example.test`,
                    password: 'undo-reviewer-password',
                },
            })
        ).status()
    ).toBe(200)
    const created = await page.request.post('/api/projects', { data: { name: 'Undo desk' } })
    expect(created.status()).toBe(201)
    const { project } = (await created.json()) as { project: { id: string } }
    const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Hand channel' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const scheduledAt = Date.now() + 1_500
    const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
        data: {
            sourceContent: { body: { format: 'plain_text', text: 'Undo me' }, media: [] },
            publications: [{ channelId: channel.id, deliveryMode: 'manual', scheduledAt }],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const { publications } = (await postResponse.json()) as { publications: { id: string }[] }
    const publicationId = publications[0]!.id
    await expect
        .poll(async () => {
            const due = await page.request.get(`/api/projects/${project.id}/publications/due`)
            return ((await due.json()) as { publications: { id: string }[] }).publications.length
        })
        .toBe(1)

    await page.goto(`/dashboard/projects/${project.id}/queue`)
    await page.getByRole('button', { name: 'Mark published', exact: true }).click()
    const toastAction = page.locator('[data-slot="toast-action"]')
    await expect(toastAction).toHaveText('Undo')
    await toastAction.click()
    await expect(page.getByRole('button', { name: 'Mark published', exact: true })).toBeVisible()

    // The history tab lists published work, newest first, with undo for manual records.
    await page.getByRole('button', { name: 'Mark published', exact: true }).click()
    await page.getByRole('tab', { name: /^Published/ }).click()
    await expect(page).toHaveURL(/filter=published/)
    const historyUndo = page.locator('[data-publication-action="undo-publish"]')
    await expect(historyUndo).toHaveText('Not published after all')
    await historyUndo.click()
    await expect(page.getByText('Nothing published yet', { exact: true })).toBeVisible()

    await page.goto(`/dashboard/projects/${project.id}/publications/${publicationId}`)
    await page.locator('[data-publication-action="record-published"]').click()
    const undo = page.locator('[data-publication-action="undo-publish"]')
    await expect(undo).toHaveText('Not published after all')
    await undo.click()
    await expect(page.locator('[data-publication-action="record-published"]')).toBeVisible()

    // The same operation is public API surface.
    expect(
        (
            await page.request.post(
                `/api/projects/${project.id}/publications/${publicationId}/publish/undo`
            )
        ).status()
    ).toBe(404)
})
