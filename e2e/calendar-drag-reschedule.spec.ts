import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

const DAY = 24 * 60 * 60 * 1000

async function scheduledAt(page: Page, projectId: string, publicationId: string) {
    const response = await page.request.get(
        `/api/projects/${projectId}/publications/${publicationId}/editor`
    )
    expect(response.ok()).toBe(true)
    const { editor } = (await response.json()) as {
        editor: { publication: { scheduledAt: number } }
    }
    return editor.publication.scheduledAt
}

async function dragEntry(page: Page, from: string, toDay: number) {
    const entry = page.locator(from).first()
    const target = page.locator(`[data-slot="event-calendar-month-cell"][data-ec-day="${toDay}"]`)
    await target.scrollIntoViewIfNeeded()
    await entry.scrollIntoViewIfNeeded()
    const start = (await entry.boundingBox())!
    const end = (await target.boundingBox())!
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 })
    await page.mouse.up()
}

// UX-689: a scheduled post moves by dragging it to another day, keeping its time and the
// offsets between its channels, and the move can be undone.
test('reschedules a post by dragging it in the month calendar, then undoes it', async ({
    page,
}) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1280, height: 1000 })
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Calendar planner',
                    email: `drag-${randomUUID()}@example.test`,
                    password: 'calendar-planner-password',
                },
            })
        ).status()
    ).toBe(200)
    const created = await page.request.post('/api/projects', { data: { name: 'Drag desk' } })
    expect(created.status()).toBe(201)
    const { project } = (await created.json()) as { project: { id: string } }
    const channelIds: string[] = []
    for (const name of ['First hand', 'Second hand']) {
        const response = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name },
        })
        expect(response.status()).toBe(201)
        channelIds.push(((await response.json()) as { channel: { id: string } }).channel.id)
    }
    // Two days ahead at 10:00 UTC (the project's time zone), the second channel 15 minutes later.
    const today = new Date()
    const sourceDay =
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + 2 * DAY
    const first = sourceDay + 10 * 60 * 60 * 1000
    const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
        data: {
            sourceContent: { body: { format: 'plain_text', text: 'Move me' }, media: [] },
            publications: [
                { channelId: channelIds[0], deliveryMode: 'manual', scheduledAt: first },
                {
                    channelId: channelIds[1],
                    deliveryMode: 'manual',
                    scheduledAt: first + 15 * 60 * 1000,
                },
            ],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const ids = (
        (await postResponse.json()) as { publications: { id: string }[] }
    ).publications.map(publication => publication.id)
    const dateKey = new Date(sourceDay).toISOString().slice(0, 10)

    await page.goto(`/dashboard/projects/${project.id}/overview?date=${dateKey}&view=month`)
    const sourceCell = `[data-slot="event-calendar-month-cell"][data-ec-day="${sourceDay}"] [data-slot="event-calendar-event"]`
    // One entry for the post, carrying both channels.
    await expect(page.locator('[data-calendar-entry-channels="2"]')).toHaveCount(1)

    await dragEntry(page, '[data-calendar-entry-channels="2"]', sourceDay + DAY)
    const toast = page.locator('[data-slot="toast-action"]')
    await expect(toast).toHaveText('Undo')
    await expect.poll(() => scheduledAt(page, project.id, ids[0]!)).toBe(first + DAY)
    expect(await scheduledAt(page, project.id, ids[1]!)).toBe(first + DAY + 15 * 60 * 1000)
    await expect(page.locator(sourceCell)).toHaveCount(0)

    await toast.click()
    await expect.poll(() => scheduledAt(page, project.id, ids[0]!)).toBe(first)
    expect(await scheduledAt(page, project.id, ids[1]!)).toBe(first + 15 * 60 * 1000)
    await expect(page.locator(sourceCell)).toHaveCount(1)

    // The past is not a destination.
    const yesterday =
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DAY
    if ((await page.locator(`[data-ec-day="${yesterday}"]`).count()) > 0) {
        await dragEntry(page, '[data-calendar-entry-channels="2"]', yesterday)
        await page.waitForTimeout(500)
        expect(await scheduledAt(page, project.id, ids[0]!)).toBe(first)
    }
})
