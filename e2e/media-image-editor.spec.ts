import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

// UX-690: the crop editor runs on the zriz engine. Saving still creates a new media item, and
// the chosen ratio is the ratio of the saved file.
test('crops a photo to a square, straightens it and saves it as new media', async ({ page }) => {
    test.setTimeout(60_000)
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Image editor',
                    email: `crop-${randomUUID()}@example.test`,
                    password: 'image-editor-password',
                },
            })
        ).status()
    ).toBe(200)
    const created = await page.request.post('/api/projects', { data: { name: 'Crop desk' } })
    expect(created.status()).toBe(201)
    const { project } = (await created.json()) as { project: { id: string } }
    // A landscape photo stand-in, so a square crop visibly changes the shape.
    const bytes = Buffer.from(
        await page.evaluate(async () => {
            const canvas = new OffscreenCanvas(1200, 800)
            const context = canvas.getContext('2d')!
            const gradient = context.createLinearGradient(0, 0, 1200, 800)
            gradient.addColorStop(0, '#f2b880')
            gradient.addColorStop(1, '#2457d6')
            context.fillStyle = gradient
            context.fillRect(0, 0, 1200, 800)
            context.fillStyle = '#ffffff'
            context.beginPath()
            context.arc(600, 400, 180, 0, Math.PI * 2)
            context.fill()
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
            return [...new Uint8Array(await blob.arrayBuffer())]
        })
    )
    const upload = await page.request.post(`/api/projects/${project.id}/media/uploads`, {
        data: {
            originalFilename: 'landscape.jpg',
            contentType: 'image/jpeg',
            expectedSize: bytes.length,
        },
    })
    expect(upload.status()).toBe(201)
    const { upload: intent } = await upload.json()
    await page.request.put(`/api/projects/${project.id}/media/uploads/${intent.intentId}`, {
        data: bytes,
    })
    expect(
        (
            await page.request.post(
                `/api/projects/${project.id}/media/uploads/${intent.intentId}/finalize`
            )
        ).status()
    ).toBe(200)

    await page.goto(`/dashboard/projects/${project.id}/media`)
    await page.locator('[data-media-asset-actions="true"]').first().click()
    await page.getByRole('menuitem', { name: 'Edit image' }).click()
    const editor = page.getByRole('dialog').filter({ hasText: 'landscape.jpg' })
    await expect(editor.getByRole('radio', { name: 'Original', exact: true })).toHaveAttribute(
        'aria-checked',
        'true'
    )
    // Nothing changed yet, so there is nothing to reset.
    await expect(editor.getByRole('button', { name: 'Reset', exact: true })).toBeHidden()

    await editor.getByRole('radio', { name: '1:1', exact: true }).click()
    const dial = editor.getByRole('slider', { name: 'Straighten' })
    await dial.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(dial).not.toHaveAttribute('aria-valuenow', '0')
    await expect(editor.getByRole('button', { name: 'Reset', exact: true })).toBeVisible()

    await editor.getByRole('button', { name: 'Save as new media', exact: true }).click()
    await expect(editor).toHaveCount(0)

    await expect
        .poll(async () => {
            const response = await page.request.get(`/api/projects/${project.id}/media`)
            const { media } = (await response.json()) as {
                media: {
                    asset: { originalFilename: string }
                    representations: {
                        kind: string
                        width: number | null
                        height: number | null
                        detectedContentType: string | null
                    }[]
                }[]
            }
            const edited = media.find(
                item => item.asset.originalFilename === 'landscape-edited.jpg'
            )
            const original = edited?.representations.find(item => item.kind === 'original')
            return original
                ? {
                      square: original.width === original.height,
                      type: original.detectedContentType,
                  }
                : null
        })
        .toEqual({ square: true, type: 'image/jpeg' })
})
