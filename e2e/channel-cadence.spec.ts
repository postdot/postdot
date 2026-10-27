import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`configures optional cadence and explicitly confirms a planning exception in ${locale}`, async ({
        page,
    }) => {
        const suffix = randomUUID().slice(0, 8)
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'Cadence operator',
                        email: `cadence-${suffix}@example.test`,
                        password: 'cadence-browser-password-123',
                    },
                })
            ).status()
        ).toBe(200)
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: `Cadence ${suffix}` },
        })
        const { project } = (await projectResponse.json()) as { project: { id: string } }
        const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name: `Newsroom ${suffix}` },
        })
        const { channel } = (await channelResponse.json()) as {
            channel: { id: string; name: string }
        }
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${project.id}/channels`)
        await page
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.cadence_action }).click()
        const dialog = page.getByRole('dialog')
        await expect(
            dialog.getByRole('heading', {
                name: messages.cadence_title.replace('{channel}', channel.name),
            })
        ).toBeVisible()
        await dialog.getByLabel(messages.cadence_daily, { exact: true }).fill('1')
        await dialog.getByLabel(messages.cadence_weekly, { exact: true }).fill('1')
        await dialog.getByLabel(messages.cadence_spacing, { exact: true }).fill('60')
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            if (locale === 'en' && width !== 820)
                await page.screenshot({ path: `/tmp/postdot-cadence-${width}.png` })
        }
        await dialog.getByRole('button', { name: messages.cadence_save, exact: true }).click()
        await expect(dialog).toHaveCount(0)
        const rules = await page.request.get(
            `/api/projects/${project.id}/channels/${channel.id}/cadence`
        )
        expect(
            ((await rules.json()) as { rules: { dailyMax: number; minimumIntervalMs: number } })
                .rules
        ).toMatchObject({ dailyMax: 1, minimumIntervalMs: 3600000 })
        // A concurrent rule edit requires an explicit reload of the saved configuration.
        await page
            .getByRole('button', {
                name: messages.channel_manage.replace('{channel}', channel.name),
            })
            .click()
        await page.getByRole('menuitem', { name: messages.cadence_action }).click()
        await expect(dialog.getByLabel(messages.cadence_spacing, { exact: true })).toHaveValue('60')
        expect(
            (
                await page.request.put(
                    `/api/projects/${project.id}/channels/${channel.id}/cadence`,
                    {
                        data: {
                            expectedRevision: 1,
                            dailyMax: 1,
                            weeklyMax: 1,
                            minimumIntervalMs: 300000,
                        },
                    }
                )
            ).status()
        ).toBe(200)
        await dialog.getByRole('button', { name: messages.cadence_save, exact: true }).click()
        await expect(dialog.getByRole('alert')).toBeVisible()
        await dialog.getByRole('button', { name: messages.cadence_reload, exact: true }).click()
        await expect(dialog.getByLabel(messages.cadence_spacing, { exact: true })).toHaveValue('5')
        await dialog.getByRole('button', { name: messages.cadence_save, exact: true }).click()
        await expect(dialog).toHaveCount(0)
        const scheduledAt = Date.now() + 86400000
        const create = async (scheduled: boolean) => {
            const response = await page.request.post(`/api/projects/${project.id}/posts`, {
                data: {
                    title: `Launch ${suffix}`,
                    sourceContent: { body: { format: 'plain_text', text: 'Launch' }, media: [] },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'manual',
                            ...(scheduled ? { scheduledAt } : {}),
                        },
                    ],
                },
            })
            expect(response.status()).toBe(201)
            return (await response.json()) as { publications: { id: string }[] }
        }
        await create(true)
        const draft = await create(false)
        const publicationId = draft.publications[0]!.id
        expect(
            (
                await page.request.post(
                    `/api/projects/${project.id}/publications/${publicationId}/approval-request`,
                    { data: { expectedDraftRevision: 1, proposedScheduledAt: scheduledAt } }
                )
            ).status()
        ).toBe(201)
        await page.goto(`/dashboard/projects/${project.id}/queue`)
        await page
            .getByRole('button', { name: messages.approval_requests_approve, exact: true })
            .click()
        const confirmation = page.getByRole('dialog')
        await expect(
            confirmation.getByRole('heading', { name: messages.cadence_conflict_title })
        ).toBeVisible()
        await expect(confirmation).toContainText(channel.name)
        await expect(confirmation.locator('li')).toHaveCount(2)
        await confirmation
            .getByRole('button', { name: messages.cadence_cancel, exact: true })
            .click()
        const stillDraft = await page.request.get(
            `/api/projects/${project.id}/publications/${publicationId}/editor`
        )
        expect(
            ((await stillDraft.json()) as { editor: { publication: { state: string } } }).editor
                .publication.state
        ).toBe('draft')
        await page
            .getByRole('button', { name: messages.approval_requests_approve, exact: true })
            .click()
        await expect(confirmation).toBeVisible()
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await confirmation
            .getByRole('button', { name: messages.cadence_confirm, exact: true })
            .click()
        await expect(confirmation).toHaveCount(0)
        const scheduled = await page.request.get(
            `/api/projects/${project.id}/publications/${publicationId}/editor`
        )
        expect(
            ((await scheduled.json()) as { editor: { publication: { state: string } } }).editor
                .publication.state
        ).toBe('scheduled')
    })
}
