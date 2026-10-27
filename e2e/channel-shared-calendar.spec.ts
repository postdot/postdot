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

test('shows another project’s time anonymously to a member who cannot read that project', async ({
    page,
}) => {
    test.setTimeout(120_000)
    const suffix = randomUUID().slice(0, 6)
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Shared calendar owner',
            email: `shared-calendar-owner-${suffix}@example.test`,
            password: 'shared-calendar-browser-password-123',
        },
    })
    expect(signup.status()).toBe(200)
    const createProject = async (name: string) => {
        const response = await page.request.post('/api/projects', { data: { name } })
        return ((await response.json()) as { project: { id: string } }).project.id
    }
    const sourceName = `Anonymous source ${suffix}`
    const targetName = `Hidden target ${suffix}`
    const source = await createProject(sourceName)
    const target = await createProject(targetName)
    const channelName = `Anonymous news ${suffix}`
    const channel = (
        (await (
            await page.request.post(`/api/projects/${source}/channels`, {
                data: { name: channelName },
            })
        ).json()) as { channel: { id: string; revision: number } }
    ).channel
    expect(
        (
            await page.request.post(`/api/projects/${source}/channels/${channel.id}/attachments`, {
                data: { projectId: target, expectedRevision: channel.revision },
            })
        ).status()
    ).toBe(200)
    const title = `Secret launch ${suffix}`
    expect(
        (
            await page.request.post(`/api/projects/${target}/posts`, {
                data: {
                    title,
                    sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
                    publications: [
                        {
                            channelId: channel.id,
                            deliveryMode: 'manual',
                            scheduledAt: Date.now() + 36 * 3_600_000,
                        },
                    ],
                },
            })
        ).status()
    ).toBe(201)

    // A second account belongs to the source project only.
    const email = `shared-calendar-viewer-${suffix}@example.test`
    const invited = await page.request.post(`/api/projects/${source}/invitations`, {
        data: { email, role: 'viewer' },
    })
    expect(invited.status()).toBe(201)
    const invitation = (
        (await invited.json()) as {
            invitation: { id: string; organizationId: string }
        }
    ).invitation
    const browser = page.context().browser()
    if (browser === null) throw new Error('The second browser context was not created')
    const context = await browser.newContext()
    const viewer = await context.newPage()
    try {
        await viewer.goto(
            `/invite?invitationId=${invitation.id}&organizationId=${invitation.organizationId}&projectId=${source}`
        )
        await expect(viewer).toHaveURL(/\/login\?continue=/)
        await viewer.getByRole('button', { name: 'Create an account instead' }).click()
        await viewer.getByLabel('Name', { exact: true }).fill('Calendar viewer')
        await viewer.getByLabel('Email', { exact: true }).fill(email)
        await viewer.getByLabel('Password', { exact: true }).fill('shared-calendar-viewer-123')
        await Promise.all([
            viewer.waitForResponse(
                response => response.url().includes('/api/auth/sign-up/email') && response.ok()
            ),
            viewer.getByRole('button', { name: 'Create account', exact: true }).click(),
        ])
        await viewer.getByRole('button', { name: 'Join project', exact: true }).click()
        await expect(viewer).toHaveURL(new RegExp(`/dashboard/projects/${source}/overview$`))

        // The viewer cannot read the other project at all.
        expect((await viewer.request.get(`/api/projects/${target}`)).status()).toBe(404)

        await viewer.goto(`/dashboard/projects/${source}/overview?view=agenda`)
        const taken = viewer.locator('[data-occupancy="true"]')
        await expect(taken).toHaveCount(1)
        await expect(taken).toContainText(channelName)
        await expect(viewer.getByText(targetName)).toHaveCount(0)
        await expect(viewer.getByText(title)).toHaveCount(0)
    } finally {
        await context.close()
    }
})
