import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test('shows X weighted text feedback in the publication composer', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E X destination ${suffix}`
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: channelName, profile: 'x' },
    })
    expect(channelResponse.status()).toBe(201)

    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    const source = page.getByRole('textbox', { name: 'Content', exact: true })
    const count = page.locator('[data-weighted-count="true"]')
    await expect(source).toBeVisible()
    await expect(count).toHaveText('0 / 280 weighted characters')

    await source.fill(`https://example.com/${'a'.repeat(300)}`)
    await expect(count).toHaveText('23 / 280 weighted characters')

    await source.fill('日'.repeat(141))
    await expect(count).toHaveText('282 / 280 weighted characters')
    await expect(source).toHaveAttribute('aria-invalid', 'true')

    await page.getByRole('button', { name: channelName, exact: true }).click()
    const targetContent = page.getByRole('textbox', { name: 'Channel content', exact: true })
    await targetContent.fill('日'.repeat(140))
    await expect(count).toHaveText('280 / 280 weighted characters')
    await expect(targetContent).not.toHaveAttribute('aria-invalid', 'true')
})

test('inserts emojis at the cursor and keeps destination changes separate', async ({
    page,
}, info) => {
    const id = await createAccountAndProject(page, randomUUID().slice(0, 8))
    expect(
        (
            await page.request.post(`/api/projects/${id}/channels`, {
                data: { name: 'Emoji destination', profile: 'discord' },
            })
        ).ok()
    ).toBe(true)
    await page.goto(`/dashboard/projects/${id}/publications/new`)
    const source = page.getByRole('textbox', { name: 'Content', exact: true })
    await source.fill('Hello world')
    await source.press('Control+End')
    for (let index = 0; index < 5; index++) await source.press('Shift+ArrowLeft')
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Search emojis', exact: true })
    await search.fill('grinning face')
    const emoji = page.locator('[frimousse-emoji]').filter({ hasText: '😀' }).first()
    await expect(emoji).toBeVisible()
    await page.screenshot({ path: info.outputPath('emoji-picker-desktop.png') })
    await emoji.click()
    await expect(source).toHaveText('Hello 😀')
    await expect(source).toBeFocused()
    await source.press('Control+z')
    await expect(source).toHaveText('Hello world')
    await page.getByRole('button', { name: 'Emoji destination', exact: true }).click()
    const target = page.getByRole('textbox', { name: 'Channel content', exact: true })
    await target.fill('Custom ')
    await target.press('End')
    await page.setViewportSize({ width: 390, height: 900 })
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).click()
    await search.fill('grinning face')
    await expect(emoji).toBeVisible()
    await page.screenshot({ path: info.outputPath('emoji-picker-mobile.png') })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await emoji.focus()
    await emoji.press('Enter')
    await expect(target).toHaveText('Custom 😀')
    await page.getByRole('button', { name: 'Common', exact: true }).click()
    await expect(source).toHaveText('Hello world')
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    const frenchData = page.waitForResponse(
        response => response.url().endsWith('/emoji-data/17.0.0/fr/data.json') && response.ok()
    )
    await page.getByRole('button', { name: fr.publication_emoji_insert, exact: true }).click()
    await frenchData
    await page
        .getByRole('searchbox', { name: fr.publication_emoji_search, exact: true })
        .fill('visage')
    await expect(page.getByRole('gridcell').first()).toBeVisible()
    await page.screenshot({ path: info.outputPath('emoji-picker-french-mobile.png') })
    await page.keyboard.press('Escape')
    await expect(
        page.getByRole('textbox', { name: fr.publication_new_source_content, exact: true })
    ).toBeFocused()
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill(`E2E X owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(`e2e-x-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-x-owner-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])

    await page.goto('/dashboard?projectId=none')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    const projectDialog = page.getByRole('dialog')
    await projectDialog
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E X project ${suffix}`)
    await projectDialog.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined)
        throw new Error(`Expected a project route, received ${page.url()}`)
    return match[1]
}
