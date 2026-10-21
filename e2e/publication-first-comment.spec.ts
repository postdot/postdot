import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { frenchTranslation } from './locale'

for (const provider of ['bluesky', 'mastodon'] as const) {
    test(`${provider}: explicitly enables one first comment, retains local edits across a concurrent change and cancels without publishing`, async ({
        page,
    }, info) => {
        await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'First comment editor',
                email: `first-comment-${randomUUID()}@postbot.local`,
                password: 'first-comment-fixture-password',
            },
        })
        const { project } = await (
            await page.request.post('/api/projects', {
                data: { name: 'Prepared follow-up', timeZone: 'UTC' },
            })
        ).json()
        const { channel } = await (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: `${provider} community`, profile: provider },
            })
        ).json()
        const made = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: 'Community announcement',
                sourceContent: {
                    body: { format: 'plain_text', text: 'Our parent announcement.' },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'automatic' }],
            },
        })
        expect(made.status()).toBe(201)
        const publicationId = (await made.json()).publications[0].id
        const path = `/api/projects/${project.id}/publications/${publicationId}/first-comment`
        await page.goto(`/dashboard/projects/${project.id}/publications/${publicationId}`)
        const section = page
            .locator('details')
            .filter({
                has: page.locator('summary', {
                    hasText: new RegExp(
                        `First comment|${frenchTranslation('first_comment_title')}`
                    ),
                }),
            })
            .last()
        await section.locator(':scope > summary').click()
        const text = section.getByRole('textbox', { name: 'Comment text', exact: true })
        const initialText = provider === 'mastodon' ? 'a'.repeat(400) : 'The promised extra detail.'
        await text.fill(initialText)
        expect((await (await page.request.get(path)).json()).firstComment).toBeNull()
        await section.getByRole('combobox', { name: 'Send after', exact: true }).click()
        await page.getByRole('option', { name: '5 minutes', exact: true }).click()
        await section.getByRole('button', { name: 'Save and enable', exact: true }).click()
        await expect(section.getByText('First comment enabled.', { exact: true })).toBeVisible()
        const saved = await (await page.request.get(path)).json()
        expect(saved.firstComment).toMatchObject({
            text: initialText,
            delaySeconds: 300,
            state: 'waiting',
        })
        await page.reload()
        await expect(text).toHaveValue(initialText)
        await text.fill('My unsaved edit must survive.')
        const refreshed = page.waitForResponse(
            response => response.url().endsWith(path) && response.request().method() === 'GET'
        )
        const concurrent = await page.request.put(path, {
            data: {
                text: 'Another editor saved this.',
                delaySeconds: 1800,
                expectedRevision: saved.firstComment.revision,
            },
        })
        expect(concurrent.status()).toBe(200)
        await refreshed
        await expect(text).toHaveValue('My unsaved edit must survive.')
        await expect(
            section.getByRole('combobox', { name: 'Send after', exact: true })
        ).toContainText('5 minutes')
        const conflict = page.waitForResponse(
            response =>
                response.url().endsWith(path) &&
                response.request().method() === 'PUT' &&
                response.status() === 409
        )
        await section.getByRole('button', { name: 'Save and enable', exact: true }).click()
        await conflict
        await expect(text).toHaveValue('My unsaved edit must survive.')
        await expect(section).toContainText('Another editor saved this.')
        await section.screenshot({
            path: info.outputPath('first-comment-concurrent-desktop-en.png'),
            animations: 'disabled',
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
        await page.getByRole('menuitem', { name: 'French', exact: true }).click()
        await expect(
            section.getByRole('textbox', {
                name: frenchTranslation('first_comment_text_label'),
                exact: true,
            })
        ).toHaveValue('My unsaved edit must survive.')
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await section.screenshot({
            path: info.outputPath('first-comment-concurrent-mobile-fr.png'),
            animations: 'disabled',
        })
        await section
            .getByRole('button', { name: frenchTranslation('first_comment_cancel'), exact: true })
            .click()
        await expect(
            section.getByText(frenchTranslation('first_comment_canceled'), { exact: true })
        ).toBeVisible()
        expect((await (await page.request.get(path)).json()).firstComment.state).toBe('cancelled')
        const editor = (
            await (await page.request.get(path.replace('/first-comment', '/editor'))).json()
        ).editor
        expect(editor.publication.state).toBe('draft')
        expect(editor.publication.externalId).toBeNull()
    })
}
