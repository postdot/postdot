import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const profile of ['x', 'bluesky', 'mastodon']) {
    test(`authors, reorders and retains a ${profile} thread with per-message validation`, async ({
        page,
    }, info) => {
        await page.addInitScript(() => {
            localStorage.setItem('PARAGLIDE_LOCALE', 'en')
            localStorage.setItem('postdot-theme', 'dark')
        })
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'Thread editor',
                        email: `thread-${randomUUID()}@example.test`,
                        password: 'thread-editor-password',
                    },
                })
            ).status()
        ).toBe(200)
        const { project } = await (
            await page.request.post('/api/projects', {
                data: { name: 'Thread authoring', timeZone: 'UTC' },
            })
        ).json()
        const { channel } = await (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: profile, profile },
            })
        ).json()
        const made = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: 'A complete thread',
                sourceContent: {
                    body: { text: 'The first message', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(made.status()).toBe(201)
        const publication = (await made.json()).publications[0]
        const base = `/api/projects/${project.id}/publications/${publication.id}`
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.goto(`/dashboard/projects/${project.id}/publications/${publication.id}`)
        const thread = page.locator('[data-thread-editor]')
        await expect(thread).toBeVisible()
        await thread.getByRole('button', { name: 'Add a reply', exact: true }).click()
        if (profile === 'mastodon') {
            await page.getByRole('combobox', { name: /visibility/i }).click()
            await page.getByRole('option', { name: 'public', exact: true }).click()
        }
        await expect(thread.getByLabel('Message 2', { exact: true })).toHaveAttribute(
            'aria-invalid',
            'true'
        )
        const overLimit =
            profile === 'x'
                ? '日'.repeat(141)
                : profile === 'bluesky'
                  ? 'é'.repeat(301)
                  : 'a'.repeat(501)
        await thread.getByLabel('Message 2', { exact: true }).fill(overLimit)
        await expect(thread.getByLabel('Message 2', { exact: true })).toHaveAttribute(
            'aria-invalid',
            'true'
        )
        await expect
            .poll(async () =>
                (
                    await (await page.request.get(`${base}/editor`)).json()
                ).editor.draft.validationIssues.some((issue: { path: string }) =>
                    issue.path.startsWith('/thread')
                )
            )
            .toBe(true)
        const invalid = (await (await page.request.get(`${base}/editor`)).json()).editor
        const selection = await page.request.post(`${base}/draft/promote`, {
            data: { expectedRevision: invalid.draft.revision },
        })
        expect(selection.status()).toBe(400)
        await thread.getByLabel('Message 2', { exact: true }).fill('The second message')
        await thread.getByRole('button', { name: 'Add a reply', exact: true }).click()
        await thread.getByLabel('Message 3', { exact: true }).fill('The third message')
        const preview = page.locator('[data-thread-preview]')
        await expect(preview).toContainText('The second message')
        await expect(preview).toContainText('The third message')
        await thread.getByRole('button', { name: 'Move message 3 up', exact: true }).focus()
        await page.keyboard.press('Enter')
        await expect(thread.getByLabel('Message 2', { exact: true })).toHaveValue(
            'The third message'
        )
        await expect(preview.locator('li').first()).toContainText('The third message')
        await expect
            .poll(
                async () =>
                    (await (await page.request.get(`${base}/editor`)).json()).editor.draft.content
                        .thread
            )
            .toEqual([{ text: 'The third message' }, { text: 'The second message' }])
        await expect(page.getByText('Saved', { exact: true })).toBeVisible()
        await page.reload()
        await expect(thread.getByLabel('Message 2', { exact: true })).toHaveValue(
            'The third message'
        )
        await expect(thread.getByLabel('Message 3', { exact: true })).toHaveValue(
            'The second message'
        )
        await page.screenshot({
            path: info.outputPath(`${profile}-thread-desktop.png`),
            fullPage: true,
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await thread.scrollIntoViewIfNeeded()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({
            path: info.outputPath(`${profile}-thread-mobile.png`),
            fullPage: true,
        })
        await thread.getByRole('button', { name: 'Remove message 2', exact: true }).click()
        await expect(thread.getByLabel('Message 2', { exact: true })).toHaveValue(
            'The second message'
        )
        await thread.getByRole('button', { name: 'Remove message 2', exact: true }).click()
        await expect(thread.getByRole('textbox')).toHaveCount(0)
        await expect(preview).toHaveCount(0)
        await expect
            .poll(
                async () =>
                    (await (await page.request.get(`${base}/editor`)).json()).editor.draft.content
                        .thread ?? null
            )
            .toBeNull()
    })
}
