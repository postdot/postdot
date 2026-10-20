import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { frenchTranslation } from './locale'

test('authors a Mastodon poll, retains it through reload and selects an immutable target without publishing', async ({
    page,
}, info) => {
    await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Poll editor',
            email: `poll-${randomUUID()}@postbot.local`,
            password: 'poll-fixture-password',
        },
    })
    const { project } = await (
        await page.request.post('/api/projects', {
            data: { name: 'Poll planning', timeZone: 'UTC' },
        })
    ).json()
    const { channel } = await (
        await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name: 'Mastodon community', profile: 'mastodon' },
        })
    ).json()
    const made = await page.request.post(`/api/projects/${project.id}/posts`, {
        data: {
            title: 'Community poll',
            sourceContent: {
                body: { format: 'plain_text', text: 'Which topic should we cover next?' },
                media: [],
            },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(made.status()).toBe(201)
    const id = (await made.json()).publications[0].id
    const path = `/api/projects/${project.id}/publications/${id}`
    await page.goto(`/dashboard/projects/${project.id}/publications/${id}`)
    const details = page.locator('[data-publication-customization]')
    await details.locator(':scope > summary').click()
    await details.getByRole('checkbox', { name: 'Add a poll', exact: true }).check()
    await details.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Product updates')
    await details.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Tutorials')
    await details.getByRole('button', { name: 'Add option', exact: true }).click()
    await details.getByRole('textbox', { name: 'Option 3', exact: true }).fill('Community stories')
    await details.getByRole('checkbox', { name: 'Allow multiple selections', exact: true }).check()
    await details
        .getByRole('checkbox', { name: 'Hide totals until the poll closes', exact: true })
        .check()
    await details.getByRole('combobox', { name: 'Duration after publication', exact: true }).click()
    await page.getByRole('option', { name: '7 days', exact: true }).click()
    const preview = page.locator('[data-mastodon-poll-preview]')
    await expect(preview).toContainText('Product updates')
    await expect(preview).toContainText('Closes 7 days after publication')
    await expect(preview.getByRole('button')).toHaveCount(0)
    await expect
        .poll(
            async () =>
                (await (await page.request.get(path + '/editor')).json()).editor.draft.content.poll
        )
        .toEqual({
            options: ['Product updates', 'Tutorials', 'Community stories'],
            expiresIn: 604800,
            multiple: true,
            hideTotals: true,
        })
    await page.reload()
    await details.locator(':scope > summary').click()
    await expect(details.getByRole('textbox', { name: 'Option 3', exact: true })).toHaveValue(
        'Community stories'
    )
    await details.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Product updates')
    await expect
        .poll(async () => {
            const { editor } = await (await page.request.get(path + '/editor')).json()
            return editor.draft.validationIssues.some(
                (issue: { code: string }) => issue.code === 'schema.uniqueItems'
            )
        })
        .toBe(true)
    await details.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Tutorials')
    await expect
        .poll(async () => {
            const { editor } = await (await page.request.get(path + '/editor')).json()
            return (
                editor.draft.content.poll.options[1] === 'Tutorials' &&
                editor.draft.validationIssues.length === 0
            )
        })
        .toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(
        details.getByRole('checkbox', { name: frenchTranslation('poll_multiple'), exact: true })
    ).toBeChecked()
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({
        path: info.outputPath('mastodon-poll-mobile-fr.png'),
        fullPage: true,
        animations: 'disabled',
    })
    const selected = await (await page.request.get(path + '/editor')).json()
    expect(selected.editor.profile.profile.execution.revision).toBe('status-v3')
    const promoted = await page.request.post(path + '/draft/promote', {
        data: { expectedRevision: selected.editor.draft.revision, scheduledAt: null },
    })
    expect(promoted.status()).toBe(200)
    const after = (await (await page.request.get(path + '/editor')).json()).editor
    expect(after.selectedTarget.content.poll).toEqual(selected.editor.draft.content.poll)
    expect(after.publication.state).toBe('draft')
})
