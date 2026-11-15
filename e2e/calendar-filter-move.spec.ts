import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'
test('persists channel filtering and moves a selected schedule', async ({ page }) => {
    await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Calendar operator',
            email: `calendar-${randomUUID()}@example.test`,
            password: 'calendar-evidence-password',
        },
    })
    const { project } = await (
        await page.request.post('/api/projects', { data: { name: 'Editorial calendar' } })
    ).json()
    for (const name of ['Newsroom', 'Community']) {
        const { channel } = await (
            await page.request.post(`/api/projects/${project.id}/channels`, { data: { name } })
        ).json()
        for (let i = 0; i < 2; i++)
            await page.request.post(`/api/projects/${project.id}/posts`, {
                data: {
                    title: `${name} update ${i + 1}`,
                    sourceContent: {
                        body: { format: 'plain_text', text: 'An update for our readers.' },
                        media: [],
                    },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'manual',
                            scheduledAt: Date.now() + (i + 1) * 86400000,
                        },
                    ],
                },
            })
    }
    const channelList = await (
        await page.request.get(`/api/projects/${project.id}/channels`)
    ).json()
    const community = channelList.channels.find((c: { name: string }) => c.name === 'Community')
    const created = await (
        await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: 'Published announcement',
                sourceContent: {
                    body: { format: 'plain_text', text: 'Already shared.' },
                    media: [],
                },
                publications: [
                    {
                        channelId: community.id,
                        deliveryMode: 'manual',
                        scheduledAt: Date.now() + 500,
                    },
                ],
            },
        })
    ).json()
    await expect
        .poll(async () =>
            (
                await page.request.post(
                    `/api/projects/${project.id}/publications/${created.publications[0].id}/publish`,
                    { data: {} }
                )
            ).status()
        )
        .toBe(200)
    await page.goto(`/dashboard/projects/${project.id}/overview`)
    await expect(page.locator('[data-channel-marks="true"]').first()).toBeVisible()
    await page.getByRole('button', { name: /^Filter/ }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Newsroom', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/channelIds=/)
    await expect(page.locator('[data-active-filters]')).toContainText('Newsroom')
    await page.reload()
    await expect(page.locator('[data-active-filters]')).toContainText('Newsroom')
    await page.getByRole('button', { name: /^Filter/ }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Published', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/states=published/)
    await expect(page.locator('[data-active-filters]')).toContainText('Published')
    await page.getByRole('button', { name: /^Filter/ }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Published', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await page.locator('[data-channel-marks="true"]').first().click()
    await page.getByRole('button', { name: 'Select all visible', exact: true }).click()
    await page.getByRole('button', { name: 'Move by…', exact: true }).click()
    await expect(page.locator('[data-move-preview]')).toBeVisible()
    await page.getByLabel('Amount', { exact: true }).fill('100')
    await page.getByLabel('Direction', { exact: true }).click()
    await page.getByRole('option', { name: 'earlier', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Nothing was moved.')
    await expect(
        page.getByRole('button', { name: 'Move 2 publications', exact: true })
    ).toBeDisabled()
    await page.getByLabel('Direction', { exact: true }).click()
    await page.getByRole('option', { name: 'later', exact: true }).click()
    await page.getByLabel('Amount', { exact: true }).fill('1')
    const before = (
        await (await page.request.get(`/api/projects/${project.id}/publications`)).json()
    ).publications
    const response = page.waitForResponse(
        r => r.url().endsWith('/publications/schedule') && r.request().method() === 'PATCH'
    )
    await page.getByRole('button', { name: 'Move 2 publications', exact: true }).click()
    const moved = await response
    expect(moved.status()).toBe(200)
    const body = moved.request().postDataJSON()
    expect(Object.keys(body.scheduledTimes)).toHaveLength(2)
    const updated = (await moved.json()).publications
    expect(updated).toHaveLength(2)
    for (const item of updated) {
        const previous = before.find((p: { id: string }) => p.id === item.id)
        expect(item.scheduledAt - previous.scheduledAt).toBe(86400000)
    }
    expect(Math.abs(updated[1].scheduledAt - updated[0].scheduledAt)).toBeGreaterThanOrEqual(
        86400000
    )

    await expect(page.getByRole('dialog')).toHaveCount(0)
})
