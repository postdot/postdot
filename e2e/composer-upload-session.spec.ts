import { expect, test } from '@playwright/test'

import { accounts, login } from './composer-account-fixture'
import { file, waitForStoredUpload } from './media-upload-fixture'

test('a session refusal during an upload keeps the file and text and resumes after sign-in', async ({
    page,
}) => {
    test.setTimeout(120_000)
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        const form = page.locator('[data-new-publication-form]')
        await expect(form).not.toHaveAttribute('inert', '')
        const text = 'Text kept while the upload session ends'
        await page.getByRole('textbox', { name: 'Content', exact: true }).fill(text)
        const uploads = `**/api/projects/${data.project.id}/media/uploads/**`
        await page.route(uploads, route =>
            route.request().method() === 'PUT' ? route.abort('failed') : route.continue()
        )
        await page.locator('input[type=file]').setInputFiles(file)
        const retry = page.getByRole('button', { name: `Retry upload ${file.name}`, exact: true })
        await expect(retry).toBeVisible()
        await waitForStoredUpload(page, data.owner.id)
        await page.unroute(uploads)

        // The session ends while the interrupted file is still waiting for a retry.
        expect((await page.request.post('/api/auth/sign-out')).status()).toBe(200)
        await retry.click()

        const signIn = page.getByRole('button', { name: 'Sign in again', exact: true })
        await expect(signIn).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
        await signIn.click()
        await expect(page).toHaveURL(/\/login\?continue=/)
        await login(page, data.ownerEmail, data.password)
        await expect(page).toHaveURL(data.url)

        const recovery = page.locator('[data-new-publication-recovery]')
        await expect(recovery).toContainText(text)
        await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
        await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(text)
        const files = page.locator('[data-media-upload-recovery]')
        await expect(files).toBeVisible()
        await files.getByRole('button', { name: /^Resume/ }).click()
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(1)
        const created = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/projects/${data.project.id}/posts` &&
                response.request().method() === 'POST'
        )
        await page.getByRole('button', { name: 'Create draft', exact: true }).click()
        const response = await created
        expect(response.status()).toBe(201)
        expect(response.request().postDataJSON().sourceContent.media).toHaveLength(1)
        const library = await page.request.get(`/api/projects/${data.project.id}/media`)
        expect((await library.json()).media).toHaveLength(1)
    } finally {
        await data.close()
    }
})

test('a session that ends mid-upload offers sign-in without losing the held creation', async ({
    page,
}) => {
    test.setTimeout(120_000)
    const data = await accounts(page)
    let release: () => void = () => {}
    try {
        await page.goto(data.url)
        const form = page.locator('[data-new-publication-form]')
        await expect(form).not.toHaveAttribute('inert', '')
        const text = 'Text held while the upload is running'
        await page.getByRole('textbox', { name: 'Content', exact: true }).fill(text)
        const gate = new Promise<void>(resolve => {
            release = resolve
        })
        await page.route(`**/api/projects/${data.project.id}/media/uploads/**`, async route => {
            if (route.request().method() !== 'PUT') return route.continue()
            await gate
            await route.continue()
        })
        await page.locator('input[type=file]').setInputFiles(file)
        await expect(page.getByRole('button', { name: 'Create draft', exact: true })).toBeDisabled()

        expect((await page.request.post('/api/auth/sign-out')).status()).toBe(200)
        release()

        // The refused upload, or the next autosave, must surface the sign-in continuation.
        await page.getByRole('textbox', { name: 'Content', exact: true }).fill(`${text}!`)
        const signIn = page.getByRole('button', { name: 'Sign in again', exact: true })
        await expect(signIn).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
        await signIn.click()
        await login(page, data.ownerEmail, data.password)
        await expect(page).toHaveURL(data.url)
        const recovery = page.locator('[data-new-publication-recovery]')
        await expect(recovery).toContainText(text)
    } finally {
        release()
        await data.close()
    }
})

test('an upload refused by an ended session alone offers sign-in without another edit', async ({
    page,
}) => {
    test.setTimeout(120_000)
    const data = await accounts(page)
    let release: () => void = () => {}
    try {
        await page.goto(data.url)
        const form = page.locator('[data-new-publication-form]')
        await expect(form).not.toHaveAttribute('inert', '')
        await page
            .getByRole('textbox', { name: 'Content', exact: true })
            .fill('Text before the upload is refused')
        // Let the autosave settle so the refusal can only come from the upload.
        await expect
            .poll(async () => (await (await page.request.get(data.endpoint)).json()).draft)
            .not.toBeNull()
        const gate = new Promise<void>(resolve => {
            release = resolve
        })
        await page.route(`**/api/projects/${data.project.id}/media/uploads/**`, async route => {
            if (route.request().method() !== 'PUT') return route.continue()
            await gate
            await route.continue()
        })
        await page.locator('input[type=file]').setInputFiles(file)
        expect((await page.request.post('/api/auth/sign-out')).status()).toBe(200)
        release()

        await expect(page.getByRole('button', { name: 'Sign in again', exact: true })).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
    } finally {
        release()
        await data.close()
    }
})

test('a library read refused by an ended session offers sign-in from the composer', async ({
    page,
}) => {
    test.setTimeout(120_000)
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        const form = page.locator('[data-new-publication-form]')
        await expect(form).not.toHaveAttribute('inert', '')
        await page.locator('input[type=file]').setInputFiles(file)
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(1)
        await page.getByRole('button', { name: 'Add media', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByText(file.name)).toBeVisible()

        expect((await page.request.post('/api/auth/sign-out')).status()).toBe(200)
        await dialog.getByRole('searchbox', { name: 'Search media' }).fill('pixel')

        await expect(page.getByRole('button', { name: 'Sign in again', exact: true })).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
    } finally {
        await data.close()
    }
})
