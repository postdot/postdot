import { expect, test } from '@playwright/test'

import { accounts } from './composer-account-fixture'

test('copies a canonical internal link from Queue and publication details', async ({ page }) => {
    const fixture = await accounts(page)
    try {
        const { channels } = await (
            await page.request.get(`/api/projects/${fixture.project.id}/channels`)
        ).json()
        const created = await page.request.post(`/api/projects/${fixture.project.id}/posts`, {
            data: {
                sourceContent: {
                    body: { format: 'plain_text', text: 'A publication to share with the team' },
                    media: [],
                },
                publications: [{ channelId: channels[0].id, deliveryMode: 'manual' }],
            },
        })
        expect(created.status()).toBe(201)
        const { publications } = await created.json()
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async (value: string) => {
                        Object.assign(window, { copiedPublicationUrl: value })
                    },
                },
            })
        })
        const path = `/dashboard/projects/${fixture.project.id}/publications/${publications[0].id}`
        await page.goto(`/dashboard/projects/${fixture.project.id}/queue?filter=all`)
        const expected = new URL(path, page.url()).href
        await page.getByRole('button', { name: 'Copy publication link', exact: true }).click()
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        (window as unknown as { copiedPublicationUrl: string }).copiedPublicationUrl
                )
            )
            .toBe(expected)
        await expect(page.getByText('Publication link copied', { exact: true })).toBeVisible()
        await page.goto(expected)
        await expect(
            page.getByRole('heading', { name: 'A publication to share with the team', exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: 'Copy publication link', exact: true }).click()
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        (window as unknown as { copiedPublicationUrl: string }).copiedPublicationUrl
                )
            )
            .toBe(expected)
    } finally {
        await fixture.close()
    }
})

test('readers can copy manually when clipboard permission is denied, in French', async ({
    page,
}, testInfo) => {
    const fixture = await accounts(page)
    try {
        const { channels } = await (
            await page.request.get(`/api/projects/${fixture.project.id}/channels`)
        ).json()
        const created = await page.request.post(`/api/projects/${fixture.project.id}/posts`, {
            data: {
                sourceContent: {
                    body: { format: 'plain_text', text: 'A publication for a reader' },
                    media: [],
                },
                publications: [{ channelId: channels[0].id, deliveryMode: 'manual' }],
            },
        })
        expect(created.status()).toBe(201)
        const { publications } = await created.json()
        const { members } = await (
            await fixture.admin.request.get(`/api/projects/${fixture.project.id}/members`)
        ).json()
        const member = members.find((item: { userId: string }) => item.userId === fixture.second.id)
        expect(
            (
                await fixture.admin.request.patch(
                    `/api/projects/${fixture.project.id}/members/${member.id}`,
                    { data: { role: 'viewer' } }
                )
            ).status()
        ).toBe(200)
        await fixture.member.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async () => {
                        throw new DOMException('Clipboard unavailable', 'NotAllowedError')
                    },
                },
            })
        })
        const reader = await fixture.member.newPage()
        const path = `/dashboard/projects/${fixture.project.id}/publications/${publications[0].id}`
        await reader.goto(path)
        await reader.getByRole('button', { name: 'Switch language to French', exact: true }).click()
        await reader.getByRole('menuitem', { name: 'French', exact: true }).click()
        await reader
            .getByRole('button', { name: 'Copier le lien de la publication', exact: true })
            .click()
        const dialog = reader.getByRole('dialog', {
            name: 'Copier le lien de la publication',
            exact: true,
        })
        await expect(dialog).toBeVisible()
        const input = dialog.getByRole('textbox', { name: 'Lien de la publication', exact: true })
        await expect(input).toHaveValue(new URL(path, reader.url()).href)
        await expect(input).toHaveJSProperty('readOnly', true)
        await expect(input).toBeFocused()
        await reader.screenshot({ path: testInfo.outputPath('manual-copy-fr.png') })
        // cspell:disable-next-line
        await dialog.getByRole('button', { name: 'Fermer', exact: true }).click()
        await expect(dialog).toHaveCount(0)
    } finally {
        await fixture.close()
    }
})
