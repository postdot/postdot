import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('searches across projects, opens source posts and keeps failures inside the palette', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    await page.addInitScript(() => localStorage.setItem('postbot-theme', 'dark'))
    await page.goto('/')
    const signup = await page.request.post('/api/auth/sign-up/email', {
        headers: { origin: new URL(page.url()).origin },
        data: {
            name: 'Search operator',
            email: `search-${suffix}@postbot.local`,
            password: 'search-test-password',
        },
    })
    expect(signup.ok()).toBe(true)
    const projects: string[] = []
    let firstPostId = ''
    for (const name of ['First', 'Second']) {
        const created = await page.request.post('/api/projects', {
            data: { name: `${name} search project ${suffix}` },
        })
        expect(created.status()).toBe(201)
        const { project } = await created.json()
        projects.push(project.id)
        const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name: `Search destination ${suffix}` },
        })
        expect(channelResponse.status()).toBe(201)
        const { channel } = await channelResponse.json()
        const postResponse = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: `${name} searchable post ${suffix}`,
                sourceContent: {
                    body: { text: `A shared constellation source ${suffix}`, format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(postResponse.status()).toBe(201)
        if (name === 'First') firstPostId = (await postResponse.json()).post.id
    }
    const projectId = projects[0]!
    const mediaName = `search-photo-${suffix}.png`
    const mediaId = await createMediaAsset(page, projectId, mediaName)
    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await page.getByRole('button', { name: 'Search Postdot', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Search Postdot', exact: true })
    const input = dialog.getByRole('combobox', { name: 'Search Postdot', exact: true })
    await expect(input).toHaveAttribute('placeholder', 'Search…')
    await expect(dialog.getByText(/Navigate/)).toBeVisible()
    let releaseSearch!: () => void
    const pendingSearch = new Promise<void>(resolve => {
        releaseSearch = resolve
    })
    await page.route('**/api/search?*', async route => {
        await pendingSearch
        await route.continue()
    })
    await input.fill('constellation')
    const loading = dialog.getByRole('status', { name: 'Searching…', exact: true })
    await expect(loading).toBeVisible()
    await expect(loading).toHaveText('')
    const listBox = await dialog.getByRole('listbox').boundingBox()
    const loaderBox = await loading.locator('svg').boundingBox()
    expect(
        Math.abs(loaderBox!.y + loaderBox!.height / 2 - (listBox!.y + listBox!.height / 2))
    ).toBeLessThan(8)
    await page.screenshot({ path: '/tmp/postbot-search-loading.png' })
    releaseSearch()
    await page.unrouteAll({ behavior: 'wait' })
    await expect(dialog.getByRole('option', { name: new RegExp('searchable post') })).toHaveCount(2)
    const initialGeometry = await input.boundingBox()
    const initialPanel = await dialog.boundingBox()
    await dialog.getByRole('switch', { name: 'All projects', exact: true }).click()
    await expect(dialog.getByRole('option', { name: new RegExp('searchable post') })).toHaveCount(1)
    await expect(dialog.getByText(`First search project ${suffix}`, { exact: false })).toBeVisible()
    await input.fill('zzzz-not-found')
    await expect(dialog.getByText('No results found.', { exact: true })).toBeVisible()
    expect((await input.boundingBox())?.y).toBe(initialGeometry?.y)
    expect((await dialog.boundingBox())?.height).toBe(initialPanel?.height)
    await page.screenshot({ path: '/tmp/postbot-search-empty.png' })
    await input.fill('constellation')
    await expect(dialog.getByRole('option', { name: /searchable post/ })).toHaveCount(1)
    await page.screenshot({ path: '/tmp/postbot-search-wide.png' })
    const darkSurface = await dialog.evaluate(element => getComputedStyle(element).backgroundColor)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click()
    await page.keyboard.press('Control+k')
    await expect(dialog).toBeVisible()
    await expect
        .poll(() => dialog.evaluate(element => getComputedStyle(element).backgroundColor))
        .not.toBe(darkSurface)
    await expect(dialog.getByRole('option', { name: /searchable post/ })).toHaveCount(1)
    await page.screenshot({ path: '/tmp/postbot-search-light.png' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click()
    await page.keyboard.press('Control+k')
    await expect(dialog.getByRole('option', { name: /searchable post/ })).toHaveCount(1)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
        .poll(() => dialog.evaluate(element => element.getBoundingClientRect().width))
        .toBeLessThan(359)
    await page.screenshot({ path: '/tmp/postbot-search-narrow.png' })
    await input.focus()
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/posts/${firstPostId}$`))
    await expect(dialog).not.toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(dialog).toBeVisible()
    await input.fill('api')
    await dialog.getByRole('option', { name: 'API keys', exact: true }).click()
    await expect(page).toHaveURL(/\/preferences\/api-keys/)
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
    await page.keyboard.press('Control+k')
    await input.fill('zzzz-not-found')
    await expect(dialog.getByText('No results found.', { exact: true })).toBeVisible()
    await expect(dialog.locator('[data-empty-illustration="result"]')).toBeVisible()
    await page.route('**/api/search?*', async route => {
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'internal_error', message: 'Unavailable' } }),
        })
    })
    await input.fill('constellation')
    await expect(dialog.getByRole('alert')).toHaveText(/Search is unavailable/)
    await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await page.unroute('**/api/search?*')
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(dialog.getByRole('option', { name: new RegExp('searchable post') })).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.keyboard.press('Control+k')
        await input.fill(mediaName)
        const mediaResult = dialog.getByRole('option', { name: new RegExp(mediaName) })
        await expect(mediaResult.locator('img')).toBeVisible()
        await expect
            .poll(() =>
                mediaResult
                    .locator('img')
                    .evaluate(image => (image as HTMLImageElement).naturalWidth)
            )
            .toBeGreaterThan(0)
        await mediaResult.click()
        await expect(page).toHaveURL(new RegExp(`/media\\?assetId=${mediaId}$`))
        const information = page.locator('[data-media-viewer="true"]')
        await expect(
            information.getByRole('heading', { name: mediaName, exact: true })
        ).toBeVisible()
        await page.screenshot({ path: '/tmp/postbot-search-media.png' })
        await page.keyboard.press('Escape')
        await expect(information).not.toBeVisible()
        await expect(page).toHaveURL(new RegExp('/media$'))
    }
})

const previewPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
)

async function createMediaAsset(page: Page, projectId: string, filename: string): Promise<string> {
    const reserved = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
        data: {
            originalFilename: filename,
            contentType: 'image/png',
            expectedSize: previewPng.byteLength,
            defaultAccessibilityText: `Alt text for ${filename}`,
        },
    })
    expect(reserved.status()).toBe(201)
    const intent = (await reserved.json()) as { upload: { intentId: string } }

    const uploaded = await page.request.put(
        `/api/projects/${projectId}/media/uploads/${intent.upload.intentId}`,
        { data: previewPng }
    )
    expect(uploaded.status()).toBe(200)

    const finalized = await page.request.post(
        `/api/projects/${projectId}/media/uploads/${intent.upload.intentId}/finalize`
    )
    expect(finalized.status()).toBe(200)
    const finalized_ = (await finalized.json()) as {
        status: 'ready' | 'failed'
        media: { asset: { id: string } }
    }
    expect(finalized_.status).toBe('ready')
    return finalized_.media.asset.id
}
