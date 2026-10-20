import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { frenchTranslation } from './locale'

for (const provider of ['bluesky', 'mastodon'] as const) {
    const platform = provider === 'mastodon' ? 'Mastodon' : 'Bluesky'
    test(`${provider}: composes a public reply, safely repeats a lost request and displays sent and uncertain history`, async ({
        page,
    }, testInfo) => {
        await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Reply operator',
                email: `reply-${randomUUID()}@postbot.local`,
                password: 'reply-fixture-password',
            },
        })
        const { project } = await (
            await page.request.post('/api/projects', {
                data: { name: 'Reply review', timeZone: 'UTC' },
            })
        ).json()
        const { channel } = await (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: `${platform} community`, profile: provider },
            })
        ).json()
        const made = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: 'Community conversation',
                sourceContent: { body: { format: 'plain_text', text: 'Announcement' }, media: [] },
                publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
            },
        })
        expect(made.status()).toBe(201)
        const publicationId = (await made.json()).publications[0].id
        const path = `/api/projects/${project.id}/publications/${publicationId}`
        const root =
            provider === 'mastodon'
                ? 'https://social.example/api/v1/statuses/100'
                : 'at://did:plc:community/app.bsky.feed.post/source'
        const parent =
            provider === 'mastodon'
                ? 'https://social.example/api/v1/statuses/200'
                : 'at://did:plc:reader/app.bsky.feed.post/comment'
        await page.route(`**${path}/editor`, async route => {
            const actual = await route.fetch()
            const body = await actual.json()
            body.editor.publication = {
                ...body.editor.publication,
                state: 'published',
                externalId: provider === 'mastodon' ? '100' : root,
                ...(provider === 'mastodon'
                    ? { externalUrl: 'https://social.example/@owner/100' }
                    : {}),
                publishedAt: Date.now(),
            }
            await route.fulfill({ response: actual, json: body })
        })
        await page.route(`**${path}/comments`, route =>
            route.fulfill({
                json: {
                    publicationId,
                    provider,
                    lastAttemptAt: Date.now(),
                    lastError: null,
                    snapshot: {
                        rootUri: root,
                        fetchedAt: Date.now(),
                        availability: 'available',
                        truncated: false,
                        comments: [
                            {
                                id: parent,
                                parentUri: root,
                                depth: 0,
                                availability: 'available',
                                authorDid: 'did:plc:reader',
                                authorHandle: 'reader.test',
                                text: 'Will there be a follow-up?',
                                createdAt: Date.now(),
                                externalUrl: null,
                            },
                        ],
                    },
                },
            })
        )
        type Reply = {
            id: string
            parentUri: string
            text: string
            state: string
            authorName: string
            createdAt: number
            updatedAt: number
            externalUrl: string | null
            lastError: string | null
        }
        const outgoing: Reply[] = []
        const requests: Array<{ requestId: string; text: string; parentUri: string }> = []
        let reads = 0,
            viewer = false,
            ready = false,
            pendingReads = 0
        const history = () => ({
            replies: outgoing,
            nextBefore: null,
            canReply: !viewer,
            provider,
            textLimit: provider === 'mastodon' ? 500 : 300,
            instanceOrigin: provider === 'mastodon' ? 'https://social.example' : null,
            accountName: 'owner.test',
        })
        await page.route(`**${path}/comments/replies**`, async route => {
            if (route.request().method() === 'GET') {
                reads++
                if (ready && outgoing[0]?.state === 'pending' && ++pendingReads >= 2) {
                    outgoing[0].state = 'sent'
                    outgoing[0].externalUrl =
                        provider === 'mastodon'
                            ? 'https://social.example/@owner/300'
                            : 'https://bsky.app/profile/owner.test/post/response'
                }
            } else {
                const body = route.request().postDataJSON()
                requests.push(body)
                if (!outgoing.some(reply => reply.id === body.requestId))
                    outgoing.unshift({
                        id: body.requestId,
                        text: body.text,
                        parentUri: body.parentUri,
                        state: outgoing.length ? 'ambiguous' : 'pending',
                        authorName: 'Reply operator',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        externalUrl: null,
                        lastError: null,
                    })
                // cspell:disable-next-line
                if (requests.length === 1) return route.abort('connectionreset')
                ready = true
            }
            await route.fulfill({ json: history() })
        })
        await page.route(`**/api/projects/${project.id}/membership`, async route => {
            const actual = await route.fetch()
            const body = await actual.json()
            if (viewer) body.membership.role = 'viewer'
            await route.fulfill({ response: actual, json: body })
        })
        await page.goto(`/dashboard/projects/${project.id}/publications/${publicationId}`)
        const panel = page
            .locator('details')
            .filter({ has: page.locator('summary').filter({ hasText: /^Comments$/ }) })
        await expect(panel).toBeVisible()
        expect(reads).toBe(0)
        await panel.locator('summary').click()
        await panel.getByRole('button', { name: 'Reply', exact: true }).click()
        const field = panel.getByRole('textbox', { name: 'Reply to @reader.test', exact: true })
        await expect(field).toBeFocused()
        await expect(
            panel.getByText('Public reply from owner.test.', { exact: true })
        ).toBeVisible()
        await field.fill('x'.repeat(provider === 'mastodon' ? 500 : 301))
        if (provider === 'bluesky')
            await expect(
                panel.getByRole('button', { name: 'Send reply', exact: true })
            ).toBeDisabled()
        else await expect(field).toHaveAttribute('maxlength', '500')
        await field.fill('Thank you! <script>Plain text</script>')
        await panel.getByRole('button', { name: 'Send reply', exact: true }).click()
        await expect(panel.getByRole('alert')).toContainText('The request could not be confirmed.')
        await panel.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(panel.getByRole('status').filter({ hasText: /^Sent$/ })).toBeVisible({
            timeout: 10000,
        })
        expect(requests).toHaveLength(2)
        expect(requests[0]).toEqual(requests[1])
        expect(outgoing).toHaveLength(1)
        await expect(
            panel.getByRole('link', { name: `Open on ${platform}`, exact: true })
        ).toBeVisible()
        await panel.getByRole('button', { name: 'Reply', exact: true }).click()
        await field.fill('A second reply')
        await panel.getByRole('button', { name: 'Send reply', exact: true }).click()
        await expect(
            panel.getByRole('status').filter({ hasText: /^Outcome uncertain$/ })
        ).toBeVisible()
        await expect(
            panel.getByText('The reply may have been sent.', { exact: false })
        ).toBeVisible()
        expect(requests).toHaveLength(3)
        await expect(panel.locator('script')).toHaveCount(0)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
        await page.getByRole('menuitem', { name: 'French', exact: true }).click()
        const frenchPanel = page.locator('details').filter({
            has: page
                .locator('summary')
                .filter({ hasText: new RegExp(`^${frenchTranslation('comments_title')}$`) }),
        })
        await expect(
            frenchPanel.getByText(
                frenchTranslation('replies_ambiguous_help').replace('{platform}', platform),
                { exact: true }
            )
        ).toBeVisible()
        const width = await frenchPanel.evaluate(element => ({
            scroll: element.scrollWidth,
            client: element.clientWidth,
        }))
        expect(width.scroll).toBeLessThanOrEqual(width.client)
        await page.screenshot({
            path: testInfo.outputPath('replies-mobile-fr.png'),
            fullPage: true,
            animations: 'disabled',
        })
        viewer = true
        await page.reload()
        await frenchPanel.locator('summary').click()
        await expect(frenchPanel.getByText('A second reply', { exact: true })).toBeVisible()
        await expect(
            frenchPanel.getByRole('button', {
                name: frenchTranslation('replies_reply'),
                exact: true,
            })
        ).toHaveCount(0)
        expect(requests).toHaveLength(3)
    })
}
