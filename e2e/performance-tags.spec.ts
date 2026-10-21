import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { frenchTranslation } from './locale'

test('filters real publication cohorts by current tags and retains selection across reload', async ({
    page,
}, info) => {
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Tag performance operator',
            email: `tag-performance-${randomUUID()}@postbot.local`,
            password: 'tag-performance-fixture-password',
        },
    })
    expect(signup.status()).toBe(200)
    const { project } = await (
        await page.request.post('/api/projects', {
            data: { name: 'Current tag results', timeZone: 'UTC' },
        })
    ).json()
    const base = `/api/projects/${project.id}`
    const { channel } = await (
        await page.request.post(`${base}/channels`, {
            data: { name: 'Mastodon report', profile: 'mastodon' },
        })
    ).json()
    const tags = []
    for (const name of ['Release', 'Docs', 'Legacy']) {
        const response = await page.request.post(`${base}/tags`, { data: { name } })
        expect(response.status()).toBe(201)
        tags.push((await response.json()).tag)
    }
    const publications: string[] = []
    for (const [index, title] of ['Release with docs', 'Release only', 'Legacy work'].entries()) {
        const made = await page.request.post(`${base}/posts`, {
            data: {
                title,
                sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(made.status()).toBe(201)
        const id = (await made.json()).publications[0].id
        publications.push(id)
        const path = `${base}/publications/${id}`
        const editor = (await (await page.request.get(`${path}/editor`)).json()).editor
        expect(
            (
                await page.request.post(`${path}/draft/promote`, {
                    data: {
                        expectedRevision: editor.draft.revision,
                        scheduledAt: Date.now() + 1_000,
                    },
                })
            ).status()
        ).toBe(200)
        // Manual completion is available only once the scheduled publication is due.
        await expect
            .poll(async () => {
                const response = await page.request.get(`${base}/publications/due`)
                expect(response.status()).toBe(200)
                const { publications: due } = await response.json()
                return due.some((publication: { id: string }) => publication.id === id)
            })
            .toBe(true)
        expect(
            (
                await page.request.post(`${path}/publish`, {
                    data: {
                        externalId: String(1000 + index),
                        externalUrl: `https://social.example/@owner/${1000 + index}`,
                    },
                })
            ).status()
        ).toBe(200)
        expect(
            (
                await page.request.put(`${path}/tags`, {
                    data: {
                        tagIds:
                            index === 0 ? [tags[0].id, tags[1].id] : [tags[index === 1 ? 0 : 2].id],
                    },
                })
            ).status()
        ).toBe(200)
    }
    expect((await page.request.post(`${base}/tags/${tags[2].id}/archive`)).ok()).toBe(true)
    let collectCalls = 0
    page.on('request', request => {
        if (request.url().includes('/analytics/provider/') && request.url().endsWith('/collect'))
            collectCalls++
    })
    await page.route(`**${base}/analytics/provider/mastodon/latest?*`, async route => {
        const ids = new URL(route.request().url()).searchParams.getAll('publicationIds')
        await route.fulfill({
            json: {
                contractVersion: 1,
                projectId: project.id,
                provider: 'mastodon',
                limit: 500,
                hasMore: false,
                observations: ids.map(id => ({
                    id: `metric-${id}`,
                    postbotEntityId: id,
                    postbotEntityType: 'publication',
                    metricName: 'favourites_count',
                    availability: 'measured',
                    value: 0,
                    fetchedAt: Date.now(),
                })),
            },
        })
    })
    await page.goto(
        `/dashboard/projects/${project.id}/channels?publisher=invalid_callback&publisher_channel=${channel.id}`
    )
    await page.getByRole('link', { name: 'Go to channel', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#publisher-connection-${channel.id}$`))
    await expect(page.locator(`#publisher-connection-${channel.id}`)).toBeVisible()
    const path = `/dashboard/projects/${project.id}/performance`
    await page.goto(path)
    const rows = page.locator('[data-performance-publication]')
    const trigger = page.locator('[data-performance-tag-filter]')
    await expect(rows).toHaveCount(3)
    await trigger.click()
    await expect(page.locator(`[data-performance-tag-option="${tags[2].id}"]`)).toHaveCount(0)
    await page.locator(`[data-performance-tag-option="${tags[0].id}"]`).click()
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(2)
    await expect(page).toHaveURL(new RegExp(tags[0].id))
    await trigger.click()
    await page.locator(`[data-performance-tag-option="${tags[1].id}"]`).click()
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(1)
    await expect(page.locator(`[data-performance-publication="${publications[0]}"]`)).toBeVisible()
    await page.reload()
    await expect(rows).toHaveCount(1)
    await expect(trigger).toContainText('2')
    // Current attribution deliberately moves an already published item when its tags change.
    expect(
        (
            await page.request.put(`${base}/publications/${publications[0]}/tags`, {
                data: { tagIds: [tags[0].id] },
            })
        ).status()
    ).toBe(200)
    await expect(rows).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear tags', exact: true }).click()
    await expect(rows).toHaveCount(3)
    await trigger.click()
    await page.locator('[data-performance-tag-archived-toggle]').click()
    await page.locator(`[data-performance-tag-option="${tags[2].id}"]`).click()
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(1)
    await expect(page.locator(`[data-performance-publication="${publications[2]}"]`)).toBeVisible()
    await page.screenshot({
        path: info.outputPath('performance-tags-desktop-en.png'),
        fullPage: true,
        animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(
        page.getByText(frenchTranslation('performance_tag_filter_scope'), { exact: true })
    ).toBeVisible()
    await expect(rows).toHaveCount(1)
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({
        path: info.outputPath('performance-tags-mobile-fr.png'),
        fullPage: true,
        animations: 'disabled',
    })
    expect(collectCalls).toBe(0)
})
