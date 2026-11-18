import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

// ISSUE-208: a manual publication is recreated by hand, so its text and media leave Postdot in
// one action each, from the post page.
async function uploadImage(page: Page, projectId: string, filename: string) {
    const bytes = await readFile(
        new URL('../apps/web/src/assets/sample-social-portrait.jpg', import.meta.url)
    )
    const response = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
        data: {
            originalFilename: filename,
            contentType: 'image/jpeg',
            expectedSize: bytes.length,
            defaultAccessibilityText: 'A portrait in warm light',
        },
    })
    expect(response.status()).toBe(201)
    const { upload } = await response.json()
    expect(
        (
            await page.request.put(`/api/projects/${projectId}/media/uploads/${upload.intentId}`, {
                data: bytes,
            })
        ).status()
    ).toBe(200)
    const finalized = await page.request.post(
        `/api/projects/${projectId}/media/uploads/${upload.intentId}/finalize`
    )
    expect(finalized.status()).toBe(200)
    return (await finalized.json()).media.asset.id as string
}

test('copies the text and media of a manual publication from the post page', async ({
    page,
    browserName,
}) => {
    test.setTimeout(60_000)
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Hand publisher',
                    email: `kit-${randomUUID()}@example.test`,
                    password: 'hand-publisher-password',
                },
            })
        ).status()
    ).toBe(200)
    const created = await page.request.post('/api/projects', { data: { name: 'Hand desk' } })
    expect(created.status()).toBe(201)
    const { project } = (await created.json()) as { project: { id: string } }
    const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Hand channel' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = (await channelResponse.json()) as { channel: { id: string } }
    const assetId = await uploadImage(page, project.id, 'portrait.jpg')
    const text = 'First line\n\nSecond line with a link https://example.test'
    const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
        data: {
            sourceContent: {
                body: { format: 'plain_text', text },
                media: [{ assetId }],
            },
            publications: [
                { channelId: channel.id, deliveryMode: 'manual', scheduledAt: Date.now() + 1_500 },
            ],
        },
    })
    expect(postResponse.ok()).toBe(true)
    const { publications } = (await postResponse.json()) as { publications: { id: string }[] }
    await expect
        .poll(async () => {
            const due = await page.request.get(`/api/projects/${project.id}/publications/due`)
            return ((await due.json()) as { publications: { id: string }[] }).publications.length
        })
        .toBe(1)

    if (browserName === 'chromium') {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    }
    await page.goto(`/dashboard/projects/${project.id}/publications/${publications[0]!.id}`)
    const kit = page.locator('[data-manual-publication-kit="true"]')
    await expect(
        kit.getByRole('heading', { name: 'Content to copy into Hand channel' })
    ).toBeVisible()

    await kit.locator('[data-manual-kit-action="copy-text"]').click()
    await expect(kit.getByRole('status')).toHaveText('Copied')
    if (browserName === 'chromium') {
        // Line breaks survive, so the post reads the same on the platform.
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
    }

    const item = kit.locator(`[data-manual-kit-item="${assetId}"]`)
    const download = page.waitForEvent('download')
    await item.getByRole('button', { name: 'Download portrait.jpg' }).click()
    expect((await download).suggestedFilename()).toBe('portrait.jpg')

    await item.getByRole('button', { name: 'Copy the description of portrait.jpg' }).click()
    if (browserName === 'chromium') {
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
            'A portrait in warm light'
        )
        await item.getByRole('button', { name: 'Copy image portrait.jpg' }).click()
        // The JPEG is converted, because the clipboard only carries PNG images reliably.
        await expect
            .poll(() =>
                page.evaluate(async () =>
                    (await navigator.clipboard.read()).flatMap(entry => [...entry.types])
                )
            )
            .toContain('image/png')
        await expect(kit.getByRole('status')).toHaveText('Copied')
    }

    // One image: no "download all", which would only repeat the single download.
    await expect(kit.locator('[data-manual-kit-action="download-all"]')).toHaveCount(0)

    await page.locator('[data-publication-action="record-published"]').click()
    await expect(page.locator('[data-publication-action="undo-publish"]')).toBeVisible()
    await expect(kit).toHaveCount(0)
})
