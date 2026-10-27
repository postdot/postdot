import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

const fill = (template: string, values: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`shows time taken by another project on a shared channel in ${locale}`, async ({
        page,
    }) => {
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Shared calendar operator',
                email: `shared-calendar-${randomUUID()}@example.test`,
                password: 'shared-calendar-browser-password-123',
            },
        })
        expect(signup.status()).toBe(200)
        const suffix = randomUUID().slice(0, 6)
        const createProject = async (name: string) => {
            const response = await page.request.post('/api/projects', { data: { name } })
            return ((await response.json()) as { project: { id: string } }).project.id
        }
        const sourceName = `Calendar source ${suffix}`
        const targetName = `Calendar target ${suffix}`
        const source = await createProject(sourceName)
        const target = await createProject(targetName)
        const channelName = `Shared news ${suffix}`
        const channel = (
            (await (
                await page.request.post(`/api/projects/${source}/channels`, {
                    data: { name: channelName },
                })
            ).json()) as { channel: { id: string; revision: number } }
        ).channel
        const attached = await page.request.post(
            `/api/projects/${source}/channels/${channel.id}/attachments`,
            { data: { projectId: target, expectedRevision: channel.revision } }
        )
        expect(attached.status()).toBe(200)

        // Work scheduled by the other project, and a draft that must occupy nothing.
        const scheduledAt = Date.now() + 36 * 3_600_000
        const create = async (title: string, withTime: boolean) =>
            page.request.post(`/api/projects/${target}/posts`, {
                data: {
                    title,
                    sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'manual',
                            ...(withTime ? { scheduledAt } : {}),
                        },
                    ],
                },
            })
        expect((await create(`Launch ${suffix}`, true)).status()).toBe(201)
        expect((await create(`Draft ${suffix}`, false)).status()).toBe(201)

        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${source}/overview?view=agenda`)

        const taken = page.locator('[data-occupancy="true"]')
        await expect(taken).toHaveCount(1)
        // The owner can read the other project, so it is described; the draft occupies nothing.
        await expect(taken).toContainText(`Launch ${suffix} · ${targetName}`)
        await expect(page.getByText(`Draft ${suffix}`)).toHaveCount(0)
        await expect(page.getByText(messages.calendar_occupied_note)).toBeVisible()

        // Another project's time is never selectable or openable from this calendar.
        await taken.click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${source}/overview`))
        await expect(page.getByRole('dialog')).toHaveCount(0)

        // The time-grid views describe it the same way, still without making it interactive.
        const dayKey = new Date(scheduledAt).toISOString().slice(0, 10)
        await page.goto(`/dashboard/projects/${source}/overview?view=day&date=${dayKey}`)
        await expect(page.locator('[data-occupancy="true"]')).toContainText(
            `Launch ${suffix} · ${targetName}`
        )

        // The other project sees the source's work as nothing here: it owns the scheduled item itself.
        await page.goto(`/dashboard/projects/${target}/overview?view=agenda`)
        await expect(page.locator('[data-occupancy="true"]')).toHaveCount(0)
        await expect(
            page.getByText(fill(messages.calendar_occupied, { channel: channelName }))
        ).toHaveCount(0)
    })
}
