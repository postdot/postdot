import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`moves pending work explicitly while retaining its schedule and history in ${locale}`, async ({
        page,
    }) => {
        test.setTimeout(90000)
        const suffix = randomUUID().slice(0, 8)
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'Move operator',
                        email: `move-${suffix}@example.test`,
                        password: 'move-browser-password-123',
                    },
                })
            ).status()
        ).toBe(200)
        const workspaceResponse = await page.request.post('/api/workspaces', {
            data: { name: `Moves ${suffix}` },
        })
        const { workspace } = (await workspaceResponse.json()) as { workspace: { id: string } }
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: `Moves ${suffix}`, workspaceId: workspace.id },
        })
        const { project } = (await projectResponse.json()) as { project: { id: string } }
        const createChannel = async (name: string) => {
            const response = await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name },
            })
            expect(response.status()).toBe(201)
            return ((await response.json()) as { channel: { id: string; name: string } }).channel
        }
        const source = await createChannel(`Source ${suffix}`)
        const target = await createChannel(`Target ${suffix}`)
        const scheduledAt = Date.now() + 86400000
        const created = await page.request.post(`/api/projects/${project.id}/posts`, {
            data: {
                title: `Announcement ${suffix}`,
                sourceContent: {
                    body: { format: 'plain_text', text: 'Retained announcement' },
                    media: [],
                },
                publications: [{ channelId: source.id, deliveryMode: 'manual', scheduledAt }],
            },
        })
        expect(created.status()).toBe(201)
        const { publications } = (await created.json()) as {
            publications: { id: string; postId: string }[]
        }
        const original = publications[0]!
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        await page.goto(`/dashboard/projects/${project.id}/publications/${original.id}`)
        await page
            .getByRole('button', { name: messages.publication_move_action, exact: true })
            .click()
        const dialog = page.getByRole('dialog').filter({
            has: page.getByRole('heading', {
                name: messages.publication_move_title,
                exact: true,
            }),
        })
        await expect(
            dialog.getByRole('button', { name: messages.publication_move_confirm, exact: true })
        ).toBeDisabled()
        await dialog.getByRole('combobox', { name: messages.publication_move_channel }).click()
        await page.getByRole('option', { name: target.name, exact: true }).click()
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            if (locale === 'en' && width !== 820)
                await page.screenshot({ path: `/tmp/postdot-move-${width}.png` })
        }
        const responsePromise = page.waitForResponse(
            response =>
                response.url().endsWith(`/publications/${original.id}/move`) &&
                response.request().method() === 'POST'
        )
        await dialog
            .getByRole('button', { name: messages.publication_move_confirm, exact: true })
            .click()
        const response = await responsePromise
        expect(response.status()).toBe(201)
        const { editor } = (await response.json()) as {
            editor: {
                publication: {
                    id: string
                    postId: string
                    channelId: string
                    scheduledAt: number
                    state: string
                }
                movement: { fromPublicationId: string }
                draft: { content: unknown }
            }
        }
        expect(editor.publication).toMatchObject({
            postId: original.postId,
            channelId: target.id,
            scheduledAt,
            state: 'scheduled',
        })
        expect(editor.movement.fromPublicationId).toBe(original.id)
        expect(editor.draft.content).toMatchObject({ body: 'Retained announcement' })
        await expect(page).toHaveURL(new RegExp(`/publications/${editor.publication.id}$`))
        await page
            .getByRole('link', { name: messages.publication_move_original, exact: true })
            .click()
        await expect(page).toHaveURL(new RegExp(`/publications/${original.id}$`))
        await expect(
            page.getByRole('link', { name: messages.publication_move_replacement, exact: true })
        ).toBeVisible()
        const previousResponse = await page.request.get(
            `/api/projects/${project.id}/publications/${original.id}/editor`
        )
        const previous = (await previousResponse.json()) as {
            editor: {
                publication: { state: string; scheduledAt: number }
                movement: { canMove: boolean; toPublicationId: string }
            }
        }
        expect(previous.editor.publication).toMatchObject({ state: 'cancelled', scheduledAt })
        expect(previous.editor.movement).toMatchObject({
            canMove: false,
            toPublicationId: editor.publication.id,
        })
    })
}
