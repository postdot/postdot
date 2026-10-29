import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import { accounts } from './composer-account-fixture'
import { file, waitForStoredUpload } from './media-upload-fixture'

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    test(`retains a failed file for retry and attaches it once in ${locale}`, async ({
        page,
    }, info) => {
        await page.addInitScript(
            ({ locale, theme }) => {
                localStorage.setItem('PARAGLIDE_LOCALE', locale)
                localStorage.setItem('postdot-theme', theme)
            },
            { locale, theme }
        )
        const data = await accounts(page)
        try {
            await page.goto(data.url)
            await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute(
                'inert',
                ''
            )
            const endpoint = `**/api/projects/${data.project.id}/media/uploads/**`
            let cut = true
            await page.route(endpoint, route =>
                route.request().method() === 'PUT' && cut ? route.abort('failed') : route.continue()
            )
            await page.locator('input[type=file]').setInputFiles(file)
            const retry = page.getByRole('button', {
                name: copy.media_upload_retry_file.replace('{filename}', file.name),
                exact: true,
            })
            await expect(retry).toBeVisible()
            await page.setViewportSize({ width: 390, height: 844 })
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
            ).toBe(true)
            await page.screenshot({ path: info.outputPath('failed-upload-mobile.png') })
            cut = false
            await retry.click()
            await expect(
                page.getByRole('button', {
                    name: copy.media_remove.replace('{filename}', file.name),
                    exact: true,
                })
            ).toBeVisible()
            await expect(retry).toHaveCount(0)
            const listed = await page.request.get(`/api/projects/${data.project.id}/media`)
            expect(listed.status()).toBe(200)
            expect((await listed.json()).media).toHaveLength(1)
        } finally {
            await data.close()
        }
    })
}

test('retries after a lost finalization response without reserving a duplicate', async ({
    page,
}) => {
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        let reservations = 0
        page.on('request', request => {
            if (
                new URL(request.url()).pathname ===
                    `/api/projects/${data.project.id}/media/uploads` &&
                request.method() === 'POST'
            )
                reservations++
        })
        let loseResponse = true
        await page.route(
            `**/api/projects/${data.project.id}/media/uploads/*/finalize`,
            async route => {
                if (!loseResponse) return route.continue()
                loseResponse = false
                const response = await route.fetch()
                expect(response.ok()).toBe(true)
                await route.abort('failed')
            }
        )
        await page.locator('input[type=file]').setInputFiles(file)
        const retry = page.getByRole('button', { name: `Retry upload ${file.name}`, exact: true })
        await expect(retry).toBeVisible()
        await retry.click()
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(1)
        expect(reservations).toBe(1)
        expect(
            (await (await page.request.get(`/api/projects/${data.project.id}/media`)).json()).media
        ).toHaveLength(1)
    } finally {
        await data.close()
    }
})

test('cancels a held upload response and ignores its late completion', async ({ page }) => {
    const data = await accounts(page)
    let release: () => void = () => {}
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        const gate = new Promise<void>(resolve => {
            release = resolve
        })
        let stored: () => void = () => {}
        const serverStored = new Promise<void>(resolve => {
            stored = resolve
        })
        let finalizations = 0
        page.on('request', request => {
            if (request.url().endsWith('/finalize')) finalizations++
        })
        await page.route(`**/api/projects/${data.project.id}/media/uploads/**`, async route => {
            if (route.request().method() !== 'PUT') return route.continue()
            const response = await route.fetch()
            expect(response.ok()).toBe(true)
            stored()
            await gate
            try {
                await route.fulfill({ response })
            } catch {
                /* The browser already cancelled this request. */
            }
        })
        const started = page.waitForRequest(
            request => request.method() === 'PUT' && request.url().includes('/media/uploads/')
        )
        await page.locator('input[type=file]').setInputFiles(file)
        await started
        await serverStored
        const cancel = page.getByRole('button', { name: `Cancel upload ${file.name}`, exact: true })
        await expect(cancel).toBeVisible()
        await cancel.click()
        release()
        await expect(page.locator('[data-media-upload-queue]')).toHaveCount(0)
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(0)
        await page.reload()
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        await expect(page.locator('[data-media-upload-recovery]')).toHaveCount(0)
        expect(finalizations).toBe(0)
        const remaining = (
            await (await page.request.get(`/api/projects/${data.project.id}/media`)).json()
        ).media
        expect(remaining).toHaveLength(1)
        expect(remaining[0].asset.state).toBe('stored')
    } finally {
        release()
        await data.close()
    }
})

test('recovers a failed file across navigation only for its original author', async ({ page }) => {
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        let cut = true
        await page.route(`**/api/projects/${data.project.id}/media/uploads/**`, route =>
            route.request().method() === 'PUT' && cut ? route.abort('failed') : route.continue()
        )
        await page.locator('input[type=file]').setInputFiles(file)
        await expect(
            page.getByRole('button', { name: `Retry upload ${file.name}`, exact: true })
        ).toBeVisible()
        await waitForStoredUpload(page, data.owner.id)
        await page.getByRole('link', { name: 'Channels', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
        await page.getByRole('link', { name: 'New publication', exact: true }).click()
        await expect(page.locator('[data-media-upload-recovery]')).toBeVisible()
        await page.request.post('/api/auth/sign-out')
        await page.request.post('/api/auth/sign-in/email', {
            data: { email: data.memberEmail, password: data.password },
        })
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        await expect(page.locator('[data-media-upload-recovery]')).toHaveCount(0)
        await expect(page.locator('[data-media-upload-queue]')).toHaveCount(0)
        await page.request.post('/api/auth/sign-out')
        await page.request.post('/api/auth/sign-in/email', {
            data: { email: data.ownerEmail, password: data.password },
        })
        await page.goto(data.url)
        const recovery = page.locator('[data-media-upload-recovery]')
        await expect(recovery).toBeVisible()
        cut = false
        await recovery.getByRole('button', { name: 'Resume', exact: true }).click()
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(1)
        expect(
            (await (await page.request.get(`/api/projects/${data.project.id}/media`)).json()).media
        ).toHaveLength(1)
    } finally {
        await data.close()
    }
})

test('leaving during finalization requires explicit resume and keeps one ready asset', async ({
    page,
}) => {
    const data = await accounts(page)
    let release: () => void = () => {}
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        let committed: () => void = () => {}
        const serverCommitted = new Promise<void>(resolve => {
            committed = resolve
        })
        const responseGate = new Promise<void>(resolve => {
            release = resolve
        })
        let held = true
        await page.route(
            `**/api/projects/${data.project.id}/media/uploads/*/finalize`,
            async route => {
                if (!held) return route.continue()
                held = false
                const response = await route.fetch()
                expect(response.ok()).toBe(true)
                committed()
                await responseGate
                try {
                    await route.fulfill({ response })
                } catch {
                    /* Navigation aborted the old request. */
                }
            }
        )
        await page.locator('input[type=file]').setInputFiles(file)
        await serverCommitted
        await waitForStoredUpload(page, data.owner.id)
        await page.getByRole('link', { name: 'Channels', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
        release()
        await page.getByRole('link', { name: 'New publication', exact: true }).click()
        const recovery = page.locator('[data-media-upload-recovery]')
        await expect(recovery).toBeVisible()
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(0)
        expect((await (await page.request.get(data.endpoint)).json()).draft).toBeNull()
        await recovery.getByRole('button', { name: 'Resume', exact: true }).click()
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toHaveCount(1)
        expect(
            (await (await page.request.get(`/api/projects/${data.project.id}/media`)).json()).media
        ).toHaveLength(1)
    } finally {
        release()
        await data.close()
    }
})
