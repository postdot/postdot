import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

test('retains and reorders a mixed Telegram album through reload and target selection', async ({
    page,
}, info) => {
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Album editor',
                    email: `album-${randomUUID()}@postbot.local`,
                    password: 'album-fixture-password',
                },
            })
        ).ok()
    ).toBe(true)
    const { project } = await (
        await page.request.post('/api/projects', {
            data: { name: 'Telegram album', timeZone: 'UTC' },
        })
    ).json()
    const base = `/api/projects/${project.id}`
    const { channel } = await (
        await page.request.post(`${base}/channels`, {
            data: { name: 'Album channel', profile: 'telegram' },
        })
    ).json()
    const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    )
    const video = await readFile(
        new URL('../packages/db/src/fixtures/video-h264.mp4', import.meta.url)
    )
    const references: { assetId: string }[] = []
    for (const [filename, type, bytes] of [
        ['album-photo.png', 'image/png', image],
        ['album-video.mp4', 'video/mp4', video],
    ] as const) {
        const reserved = await page.request.post(`${base}/media/uploads`, {
            data: { originalFilename: filename, contentType: type, expectedSize: bytes.length },
        })
        expect(reserved.status()).toBe(201)
        const { upload } = await reserved.json()
        expect(
            (
                await page.request.put(`${base}/media/uploads/${upload.intentId}`, { data: bytes })
            ).status()
        ).toBe(200)
        const finalized = await page.request.post(
            `${base}/media/uploads/${upload.intentId}/finalize`
        )
        expect(finalized.status()).toBe(200)
        const { media } = await finalized.json()
        references.push({ assetId: media.asset.id })
    }
    const caption = 'One caption for our photo and video'
    const made = await page.request.post(`${base}/posts`, {
        data: {
            title: 'Mixed album',
            sourceContent: { body: { format: 'plain_text', text: caption }, media: references },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'manual',
                    targetContent: { text: caption, media: references },
                },
            ],
        },
    })
    expect(made.status()).toBe(201)
    const id = (await made.json()).publications[0].id
    const path = `${base}/publications/${id}`
    await page.goto(`/dashboard/projects/${project.id}/publications/${id}`)
    const details = page.locator('[data-publication-customization]')
    await details.locator(':scope > summary').click()
    await expect(details.locator('[data-media-reorderable="true"]')).toHaveCount(2)
    await details
        .getByRole('button', { name: 'Reorder album-photo.png', exact: true })
        .press('ArrowRight')
    const editor = async () => (await (await page.request.get(path + '/editor')).json()).editor
    const reversed = [references[1], references[0]]
    await expect
        .poll(async () =>
            (await editor()).draft.content.media.map((item: { assetId: string }) => ({
                assetId: item.assetId,
            }))
        )
        .toEqual(reversed)
    await expect.poll(async () => (await editor()).draft.validationIssues).toEqual([])
    await page.reload()
    const preview = page.locator('[data-preview-platform="telegram"]')
    await expect(preview.locator('video')).toHaveCount(1)
    await expect(preview).toContainText(caption)
    await preview.screenshot({
        path: info.outputPath('telegram-album-desktop.png'),
        animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await preview.screenshot({
        path: info.outputPath('telegram-album-mobile.png'),
        animations: 'disabled',
    })
    const selected = await editor()
    expect(selected.profile.profile.execution.revision).toBe('message-v3')
    expect(
        selected.draft.content.media.map((item: { assetId: string }) => ({ assetId: item.assetId }))
    ).toEqual(reversed)
    expect(
        (
            await page.request.post(path + '/draft/promote', {
                data: { expectedRevision: selected.draft.revision, scheduledAt: null },
            })
        ).status()
    ).toBe(200)
    const after = await editor()
    expect(after.selectedTarget.content.media).toEqual(selected.draft.content.media)
    expect(after.publication.state).toBe('draft')
})
