import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { frenchTranslation } from './locale'

for (const provider of ['bluesky', 'mastodon'] as const)
    test(`${provider}: reads comments on demand, retains a failed refresh, and offers no reply actions`, async ({
        page,
    }, testInfo) => {
        await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Comments operator',
                email: `comments-${randomUUID()}@postbot.local`,
                password: 'comments-fixture-password',
            },
        })
        const made = await page.request.post('/api/projects', {
            data: { name: 'Conversation review', timeZone: 'UTC' },
        })
        const { project } = await made.json()
        const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name: `${provider} community`, profile: provider },
        })
        const { channel } = await channelResponse.json()
        const created = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: 'Community news',
                sourceContent: {
                    body: { format: 'plain_text', text: 'Original announcement' },
                    media: [],
                },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(created.status()).toBe(201)
        const publicationId = (await created.json()).publications[0].id
        const publicationPath = `/api/projects/${project.id}/publications/${publicationId}`
        const platform = provider === 'mastodon' ? 'Mastodon' : 'Bluesky'
        const uri =
            provider === 'mastodon'
                ? 'https://social.example/api/v1/statuses/100'
                : 'at://did:plc:community/app.bsky.feed.post/source'
        await page.route(`**${publicationPath}/editor`, async route => {
            const actual = await route.fetch()
            const body = await actual.json()
            body.editor.publication = {
                ...body.editor.publication,
                state: 'published',
                externalId: provider === 'mastodon' ? '100' : uri,
                externalUrl: provider === 'mastodon' ? 'https://social.example/@owner/100' : null,
                publishedAt: Date.now(),
            }
            await route.fulfill({ response: actual, json: body })
        })
        let commentReads = 0
        let refreshes = 0
        let failRead = false
        let viewer = false
        let releaseRead = () => {}
        const held = new Promise<void>(resolve => {
            releaseRead = resolve
        })
        const snapshot = {
            fetchedAt: Date.now(),
            rootUri: uri,
            availability: 'available',
            truncated: true,
            comments: [
                {
                    id: 'reply-1',
                    parentUri: uri,
                    depth: 0,
                    availability: 'available',
                    authorDid: 'did:plc:reader',
                    authorHandle: 'reader.test',
                    text: 'Thank you! <script>Plain text</script> ' + 'x'.repeat(100),
                    createdAt: Date.now(),
                    externalUrl:
                        provider === 'mastodon'
                            ? 'https://social.example/web/statuses/101'
                            : 'https://bsky.app/profile/reader.test/post/reply',
                },
                {
                    id: 'reply-2',
                    parentUri: 'reply-1',
                    depth: 1,
                    availability: 'blocked',
                    authorDid: null,
                    authorHandle: null,
                    text: null,
                    createdAt: null,
                    externalUrl: null,
                },
            ],
        }
        let response: Record<string, unknown> = {
            publicationId,
            provider,
            snapshot: null,
            lastAttemptAt: null,
            lastError: null,
        }
        await page.route(`**${publicationPath}/comments**`, async route => {
            if (route.request().method() === 'GET') {
                commentReads++
                await held
                if (failRead)
                    return route.fulfill({
                        status: 503,
                        json: { error: { code: 'unavailable', message: 'Unavailable' } },
                    })
            } else {
                refreshes++
                response = {
                    ...response,
                    snapshot,
                    lastAttemptAt: Date.now(),
                    lastError: refreshes > 1 ? 'rate_limited' : null,
                }
            }
            await route.fulfill({ json: response })
        })
        await page.route(`**/api/projects/${project.id}/membership`, async route => {
            const actual = await route.fetch()
            const body = await actual.json()
            if (viewer) body.membership.role = 'viewer'
            await route.fulfill({ response: actual, json: body })
        })
        await page.goto(`/dashboard/projects/${project.id}/publications/${publicationId}`)
        const panel = page.locator('details').filter({
            has: page.locator('summary').filter({
                hasText: new RegExp(`^(Comments|${frenchTranslation('comments_title')})$`),
            }),
        })
        await expect(panel).toBeVisible()
        expect(commentReads).toBe(0)
        await panel.locator('summary').click()
        await expect(panel.getByRole('status')).toBeVisible()
        releaseRead()
        await expect(panel.getByText('No saved comments yet.', { exact: true })).toBeVisible()
        await panel.getByRole('button', { name: 'Refresh comments', exact: true }).click()
        await expect(panel.getByText('@reader.test', { exact: true })).toBeVisible()
        await expect(panel.getByText('This reply is unavailable.', { exact: true })).toBeVisible()
        await expect(
            panel.getByText('The reading limit was reached. Other replies may be missing.', {
                exact: true,
            })
        ).toBeVisible()
        await expect(panel.getByRole('list')).toContainText('<script>Plain text</script>')
        await expect(panel.locator('script, img, textarea')).toHaveCount(0)
        await expect(
            panel.getByRole('link', { name: `Open on ${platform}`, exact: true })
        ).toHaveAttribute('href', snapshot.comments[0]!.externalUrl!)
        await panel.locator('summary').click()
        await expect(panel.getByRole('list')).toHaveCount(0)
        const readsBeforeReopen = commentReads
        await panel.locator('summary').click()
        await expect.poll(() => commentReads).toBeGreaterThan(readsBeforeReopen)
        expect(refreshes).toBe(1)
        await panel.getByRole('button', { name: 'Refresh comments', exact: true }).click()
        await expect(panel.getByRole('alert')).toHaveText(
            'Refresh failed. The previous snapshot is still displayed.'
        )
        await expect(panel.getByText('@reader.test', { exact: true })).toBeVisible()
        expect(refreshes).toBe(2)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
        await page.getByRole('menuitem', { name: 'French', exact: true }).click()
        await expect(panel.getByRole('alert')).toHaveText(
            frenchTranslation('comments_refresh_failed_saved')
        )
        const width = await panel.evaluate(element => ({
            scroll: element.scrollWidth,
            client: element.clientWidth,
        }))
        expect(width.scroll).toBeLessThanOrEqual(width.client)
        await page.screenshot({
            path: testInfo.outputPath(`${provider}-comments-mobile-fr.png`),
            fullPage: true,
            animations: 'disabled',
        })
        failRead = true
        await page.reload()
        const frenchPanel = page.locator('details').filter({
            has: page
                .locator('summary')
                .filter({ hasText: new RegExp(`^${frenchTranslation('comments_title')}$`) }),
        })
        await frenchPanel.locator('summary').click()
        await expect(
            frenchPanel.getByText(frenchTranslation('comments_read_failed'), { exact: true })
        ).toBeVisible()
        failRead = false
        await frenchPanel
            .getByRole('button', { name: frenchTranslation('common_retry'), exact: true })
            .click()
        await expect(frenchPanel.getByText('@reader.test', { exact: true })).toBeVisible()
        viewer = true
        await page.reload()
        await frenchPanel.locator('summary').click()
        await expect(frenchPanel.getByText('@reader.test', { exact: true })).toBeVisible()
        await expect(
            frenchPanel.getByRole('button', {
                name: frenchTranslation('comments_refresh'),
                exact: true,
            })
        ).toHaveCount(0)
    })
