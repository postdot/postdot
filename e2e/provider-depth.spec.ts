import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page, profile: string) {
    await page.addInitScript(() => {
        localStorage.setItem('PARAGLIDE_LOCALE', 'en')
        localStorage.setItem('postdot-theme', 'dark')
    })
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Provider editor',
            email: `depth-${randomUUID()}@example.test`,
            password: 'provider-depth-password',
        },
    })
    expect(signup.status()).toBe(200)
    const made = await page.request.post('/api/projects', {
        data: { name: 'Provider depth', timeZone: 'UTC' },
    })
    expect(made.status()).toBe(201)
    const { project } = await made.json()
    const connected = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: `${profile} destination`, profile },
    })
    expect(connected.status()).toBe(201)
    const { channel } = await connected.json()
    return { projectId: project.id as string, channelId: channel.id as string }
}

async function image(page: Page, projectId: string, filename: string) {
    const bytes = await readFile(
        new URL('../apps/web/src/assets/sample-social-portrait.jpg', import.meta.url)
    )
    const response = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
        data: {
            originalFilename: filename,
            contentType: 'image/jpeg',
            expectedSize: bytes.length,
            defaultAccessibilityText: filename,
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
    const result = await finalized.json()
    expect(result.status).toBe('ready')
    return result.media.asset.id as string
}

for (const profile of ['instagram', 'facebook'])
    test(`authors ordered ${profile} images with the new native profile`, async ({
        page,
    }, info) => {
        const { projectId, channelId } = await setup(page, profile)
        const ids = [
            await image(page, projectId, 'first-photo.jpg'),
            await image(page, projectId, 'second-photo.jpg'),
        ]
        const media = ids.map((assetId, index) => ({
            assetId,
            accessibilityText: `Image ${index + 1}`,
        }))
        const response = await page.request.post(`/api/projects/${projectId}/posts`, {
            data: {
                title: 'Two images in order',
                sourceContent: {
                    body: { format: 'plain_text', text: 'One caption for both images' },
                    media,
                },
                publications: [{ channelId, deliveryMode: 'manual' }],
            },
        })
        expect(response.status(), await response.text()).toBe(201)
        const { publications } = await response.json()
        const path = `/dashboard/projects/${projectId}/publications/${publications[0].id}`
        const state = await (
            await page.request.get(
                `/api/projects/${projectId}/publications/${publications[0].id}/editor`
            )
        ).json()
        expect(state.editor.profile.profile.version).toBe(2)
        expect(
            state.editor.draft.content.media.map((item: { assetId: string }) => item.assetId)
        ).toEqual(ids)
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(path)
        const preview = page.locator('[data-publication-draft-preview]')
        await expect(preview).toContainText('One caption for both images')
        if (profile === 'instagram') {
            await expect(preview).toContainText('1 of 2')
            await expect(preview.getByRole('img', { name: 'Image 1', exact: true })).toBeVisible()
            await preview.getByRole('button', { name: 'Next media', exact: true }).click()
            await expect(preview).toContainText('2 of 2')
            await expect(preview.getByRole('img', { name: 'Image 2', exact: true })).toBeVisible()
            await preview.getByRole('button', { name: 'Previous media', exact: true }).focus()
            await page.keyboard.press('Enter')
            await expect(preview).toContainText('1 of 2')
        } else await expect(preview.getByRole('img')).toHaveCount(2)
        await page.screenshot({ path: info.outputPath(`${profile}-desktop.png`), fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        await preview.scrollIntoViewIfNeeded()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: info.outputPath(`${profile}-mobile.png`), fullPage: true })
    })

test('edits and retains a Bluesky link card with a thumbnail and blocks credentialed URLs from selection', async ({
    page,
}, info) => {
    const { projectId, channelId } = await setup(page, 'bluesky')
    const assetId = await image(page, projectId, 'link-thumbnail.jpg')
    const media = [{ assetId, accessibilityText: 'Article cover' }]
    const data = {
        title: 'Bluesky article',
        sourceContent: {
            body: { format: 'plain_text', text: 'Read https://example.com/article' },
            media,
        },
        publications: [
            {
                channelId,
                deliveryMode: 'manual',
                targetContent: {
                    text: 'Read https://example.com/article',
                    media,
                    external: {
                        uri: 'https://example.com/article',
                        title: 'Article title',
                        description: 'Stored article description',
                    },
                },
            },
        ],
    }
    const rejected = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            ...data,
            publications: [
                {
                    ...data.publications[0],
                    targetContent: {
                        ...data.publications[0]!.targetContent,
                        external: {
                            ...data.publications[0]!.targetContent.external,
                            uri: 'https://user:secret@example.com',
                        },
                    },
                },
            ],
        },
    })
    // Invalid working drafts remain saveable; selecting a publishable version must refuse them.
    expect(rejected.status()).toBe(201)
    const invalid = await rejected.json()
    const invalidBase = `/api/projects/${projectId}/publications/${invalid.publications[0].id}`
    const invalidEditor = (await (await page.request.get(`${invalidBase}/editor`)).json()).editor
    expect(invalidEditor.draft.validationIssues).toContainEqual(
        expect.objectContaining({ path: '/external', code: 'bluesky.external_invalid' })
    )
    const selection = await page.request.post(`${invalidBase}/draft/promote`, {
        data: { expectedRevision: invalidEditor.draft.revision },
    })
    expect(selection.status()).toBe(400)
    expect((await selection.json()).error.code).toBe('invalid_content')
    const created = await page.request.post(`/api/projects/${projectId}/posts`, { data })
    expect(created.status(), await created.text()).toBe(201)
    const { publications } = await created.json()
    const base = `/api/projects/${projectId}/publications/${publications[0].id}`
    await page.goto(`/dashboard/projects/${projectId}/publications/${publications[0].id}`)
    const card = page.locator('[data-bluesky-link-card]')
    await expect(card).toContainText('Article title')
    await expect(card.getByRole('img', { name: 'Article cover' })).toBeVisible()
    const disclosure = page.locator('[data-publication-customization]')
    if ((await disclosure.getAttribute('open')) === null)
        await disclosure.locator(':scope > summary').click()
    const field = page.getByRole('group', { name: 'Link card', exact: true })
    await expect(field.getByRole('checkbox', { name: 'Link card', exact: true })).toBeChecked()
    await field.getByLabel('Title', { exact: true }).fill('Edited article title')
    await expect(card).toContainText('Edited article title')
    await expect
        .poll(
            async () =>
                (await (await page.request.get(`${base}/editor`)).json()).editor.draft.content
                    .external.title
        )
        .toBe('Edited article title')
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await page.reload()
    await expect(card).toContainText('Edited article title')
    await page.screenshot({ path: info.outputPath('bluesky-card-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await card.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath('bluesky-card-mobile.png'), fullPage: true })
})
