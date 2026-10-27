import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

test('loads a shipped template locally and preserves explicit impact and activation', async ({
    page,
}) => {
    await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Profile operator',
            email: `profile-${randomUUID()}@postdot.local`,
            password: 'profile-fixture-password',
        },
    })
    const projectResponse = await page.request.post('/api/projects', {
        data: { name: 'Template updates', timeZone: 'UTC' },
    })
    const { project } = await projectResponse.json()
    const response = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Bluesky updates', profile: 'bluesky' },
    })
    expect(response.status()).toBe(201)
    const { channel } = await response.json()
    const profileUrl = `/api/projects/${project.id}/channels/${channel.id}/profile`
    const original = (await (await page.request.get(profileUrl)).json()).active
    const publicationIds: string[] = []
    for (const length of [280, 180]) {
        const post = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                sourceContent: {
                    body: { format: 'plain_text', text: 'a'.repeat(length) },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'automatic' }],
            },
        })
        expect(post.status()).toBe(201)
        publicationIds.push((await post.json()).publications[0].id)
    }
    await page.route('**/api/channel-profile-presets', async route => {
        const actual = await route.fetch()
        const catalog = await actual.json()
        const preset = catalog.presets.find((item: { id: string }) => item.id === 'bluesky')
        preset.profile.contentSchema.properties.text.maxLength = 200
        preset.profile.capabilities.textFields[0].maxLength = 200
        preset.profile.capabilities.textFields[0].maxGraphemes = 200
        await route.fulfill({ response: actual, json: catalog })
    })
    await page.goto(`/dashboard/projects/${project.id}/channels`)
    await page.getByRole('button', { name: 'Manage Bluesky updates', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Load shipped template', exact: true }).click()
    let state = await (await page.request.get(profileUrl)).json()
    expect(state.active).toEqual(original)
    expect(state.draft).toBeNull()
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    state = await (await page.request.get(profileUrl)).json()
    expect(state.active).toEqual(original)
    expect(state.draft.profile.capabilities.textFields[0].maxGraphemes).toBe(200)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Manage Bluesky updates', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Preview impact', exact: true })).toBeEnabled()
    await expect(
        dialog.getByRole('button', { name: 'Load shipped template', exact: true })
    ).toHaveCount(0)
    const preview = page.waitForResponse(
        reply => reply.url().endsWith('/preview') && reply.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Preview impact', exact: true }).click()
    const { assessment } = await (await preview).json()
    expect(assessment.workingDrafts).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ id: publicationIds[0], state: 'review_required' }),
            expect.objectContaining({ id: publicationIds[1], state: 'compatible' }),
        ])
    )
    await dialog.getByRole('button', { name: 'Review activation', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirm activation', exact: true }).click()
    await expect(
        dialog.getByRole('heading', { name: 'Bluesky updates profile activated', exact: true })
    ).toBeVisible()
    state = await (await page.request.get(profileUrl)).json()
    expect(state.active.profile.capabilities.textFields[0].maxGraphemes).toBe(200)
    expect(state.active.id).not.toBe(original.id)
})
