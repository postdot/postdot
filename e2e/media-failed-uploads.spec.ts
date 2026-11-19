import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { switchTheme } from './locale'

async function createSampleImageBytes(page: Page, startColor: string, endColor: string) {
    return Buffer.from(
        await page.evaluate(
            async ({ from, to }) => {
                const canvas = new OffscreenCanvas(960, 720)
                const context = canvas.getContext('2d')!
                const gradient = context.createLinearGradient(0, 0, 960, 720)
                gradient.addColorStop(0, from)
                gradient.addColorStop(1, to)
                context.fillStyle = gradient
                context.fillRect(0, 0, 960, 720)
                const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
                return [...new Uint8Array(await blob.arrayBuffer())]
            },
            { from: startColor, to: endColor }
        )
    )
}

async function uploadMediaViaApi(
    page: Page,
    projectId: string,
    filename: string,
    contentType: string,
    bytes: Buffer
) {
    const reserve = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
        data: {
            originalFilename: filename,
            contentType,
            expectedSize: bytes.length,
        },
    })
    expect(reserve.status()).toBe(201)
    const { upload: intent } = (await reserve.json()) as { upload: { intentId: string } }
    const put = await page.request.put(
        `/api/projects/${projectId}/media/uploads/${intent.intentId}`,
        { data: bytes }
    )
    expect(put.status()).toBe(200)
    const finalized = await page.request.post(
        `/api/projects/${projectId}/media/uploads/${intent.intentId}/finalize`
    )
    expect(finalized.status()).toBe(200)
    return (await finalized.json()) as {
        status: 'ready' | 'failed'
        media: {
            asset: {
                id: string
                state: string
                failureCode: string | null
                failureMessage: string | null
            }
        }
    }
}

test('shows failed uploads in a compact notice outside the media grid and composer picker', async ({
    page,
}) => {
    test.setTimeout(90_000)

    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Media reviewer',
            email: `failed-media-${randomUUID()}@example.test`,
            password: 'failed-media-password',
        },
    })
    expect(signup.status()).toBe(200)

    const createdProject = await page.request.post('/api/projects', {
        data: { name: 'Failed uploads studio' },
    })
    expect(createdProject.status()).toBe(201)
    const { project } = (await createdProject.json()) as { project: { id: string } }

    const createdChannel = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Manual desk' },
    })
    expect(createdChannel.status()).toBe(201)

    await page.goto('/')

    const firstReadyBytes = await createSampleImageBytes(page, '#f2b880', '#2457d6')
    const secondReadyBytes = await createSampleImageBytes(page, '#84d2c5', '#3b5249')
    const readyFirst = await uploadMediaViaApi(
        page,
        project.id,
        'studio-cover.jpg',
        'image/jpeg',
        firstReadyBytes
    )
    const readySecond = await uploadMediaViaApi(
        page,
        project.id,
        'campaign-still.jpg',
        'image/jpeg',
        secondReadyBytes
    )
    expect(readyFirst.status).toBe('ready')
    expect(readySecond.status).toBe('ready')

    const failedFilenames = [
        'corrupt-clip.png',
        'broken-notes.png',
        'bad-frame.png',
        'fourth-broken.png',
    ]
    const rawFailureMessages: string[] = []
    for (const filename of failedFilenames) {
        const result = await uploadMediaViaApi(
            page,
            project.id,
            filename,
            'image/png',
            Buffer.from('not-a-valid-image-payload')
        )
        expect(result.status).toBe('failed')
        expect(result.media.asset.state).toBe('failed')
        if (result.media.asset.failureMessage) {
            rawFailureMessages.push(result.media.asset.failureMessage)
        }
    }

    await page.goto(`/dashboard/projects/${project.id}/media`)

    const cards = page.locator('article[data-media-card-layout]')
    await expect(cards).toHaveCount(2)
    await expect(cards.filter({ hasText: 'studio-cover.jpg' })).toHaveCount(1)
    await expect(cards.filter({ hasText: 'campaign-still.jpg' })).toHaveCount(1)
    for (const filename of failedFilenames) {
        await expect(cards.filter({ hasText: filename })).toHaveCount(0)
    }

    const notice = page.locator('[data-media-failed-uploads-notice="true"]')
    await expect(notice).toBeVisible()
    await expect(notice.locator('[data-media-failed-upload-item]')).toHaveCount(3)
    await expect(notice).toContainText('4 failed uploads')
    await expect(notice).toContainText('Unsupported file type')
    for (const rawMessage of rawFailureMessages) {
        await expect(notice).not.toContainText(rawMessage)
    }

    const toggle = notice.locator('[data-media-failed-toggle="true"]')
    await expect(toggle).toHaveText('Show 1 more')

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await switchTheme(page, 'dark')
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(notice).toBeVisible()
    const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(horizontalOverflow).toBeLessThanOrEqual(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await switchTheme(page, 'light')
    await expect(page.locator('html')).toHaveClass(/\blight\b/)

    await toggle.click()
    await expect(notice.locator('[data-media-failed-upload-item]')).toHaveCount(4)
    await expect(toggle).toHaveText('Show fewer')
    for (const filename of failedFilenames) {
        await expect(notice).toContainText(filename)
    }

    await page.goto(`/dashboard/projects/${project.id}/publications/new`)
    await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('aria-busy', 'false')
    await page.getByRole('button', { name: 'Add media', exact: true }).click()

    const attachmentDialog = page.locator('[data-media-library="true"]')
    await expect(attachmentDialog).toBeVisible()
    const pickerCards = attachmentDialog.locator('article[data-media-card-layout]')
    await expect(pickerCards).toHaveCount(2)
    for (const filename of failedFilenames) {
        await expect(attachmentDialog).not.toContainText(filename)
    }
    await attachmentDialog.getByRole('button', { name: 'Done', exact: true }).click()

    await page.goto(`/dashboard/projects/${project.id}/media`)
    await expect(notice).toBeVisible()

    for (let remaining = 4; remaining > 0; remaining--) {
        const removeButton = notice.locator('[data-media-failed-remove="true"]').first()
        await removeButton.click()
        if (remaining > 1) {
            await expect(notice).toContainText(
                remaining - 1 === 1 ? '1 failed upload' : `${remaining - 1} failed uploads`
            )
        }
    }

    await expect(notice).toHaveCount(0)
    await expect(cards).toHaveCount(2)

    await page.reload()
    await expect(cards).toHaveCount(2)
    await expect(notice).toHaveCount(0)
})
