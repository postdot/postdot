import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

test('searches across projects, opens source posts and keeps failures inside the palette', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    await page.goto('/')
    const signup = await page.request.post('/api/auth/sign-up/email', {
        headers: { origin: new URL(page.url()).origin },
        data: {
            name: 'Search operator',
            email: `search-${suffix}@herald.local`,
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
    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await page.getByRole('button', { name: 'Search Herald', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Search Herald', exact: true })
    const input = dialog.getByRole('combobox', { name: 'Search Herald', exact: true })
    await input.fill('constellation')
    await expect(dialog.getByRole('option', { name: new RegExp('searchable post') })).toHaveCount(2)
    await dialog.getByRole('combobox', { name: 'Search scope' }).click()
    await page.getByRole('option', { name: 'Current project', exact: true }).click()
    await expect(dialog.getByRole('option', { name: new RegExp('searchable post') })).toHaveCount(1)
    await expect(dialog.getByText(`First search project ${suffix}`, { exact: false })).toBeVisible()
    await page.screenshot({ path: '/tmp/herald-search-wide.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
        .poll(() => dialog.evaluate(element => element.getBoundingClientRect().width))
        .toBeLessThan(359)
    await page.screenshot({ path: '/tmp/herald-search-narrow.png' })
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
})
