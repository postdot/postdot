import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    for (const localCopy of [false, true]) {
        test(`protects a stored draft after initial read failure in ${locale} with local recovery ${localCopy}`, async ({
            page,
        }, info) => {
            await page.addInitScript(
                ({ locale, theme }) => {
                    localStorage.setItem('PARAGLIDE_LOCALE', locale)
                    localStorage.setItem('postdot-theme', theme)
                },
                { locale, theme }
            )
            expect(
                (
                    await page.request.post('/api/auth/sign-up/email', {
                        data: {
                            name: 'Draft recovery reviewer',
                            email: `draft-${randomUUID()}@example.test`,
                            password: 'draft-recovery-password',
                        },
                    })
                ).status()
            ).toBe(200)
            const created = await page.request.post('/api/projects', {
                data: { name: 'Recovery desk' },
            })
            expect(created.status()).toBe(201)
            const { project } = await created.json()
            expect(
                (
                    await page.request.post(`/api/projects/${project.id}/channels`, {
                        data: { name: 'Manual destination' },
                    })
                ).status()
            ).toBe(201)
            const path = `/dashboard/projects/${project.id}/publications/new?editor=legacy`
            const draftPath = `/api/projects/${project.id}/publication-composer-draft`
            const form = page.locator('[data-new-publication-form="true"]')
            const editor = page.getByRole('textbox', {
                name: copy.publication_new_source_content,
                exact: true,
            })
            let releaseRead: () => void = () => {}
            const readGate = new Promise<void>(resolve => {
                releaseRead = resolve
            })
            const initialEndpoint = `**${draftPath}*`
            await page.route(initialEndpoint, async route => {
                await readGate
                await route.continue()
            })
            const readStarted = page.waitForRequest(
                request => request.url().endsWith(draftPath) && request.method() === 'GET'
            )
            await page.goto(path)
            await readStarted
            await expect(form).toHaveAttribute('inert', '')
            releaseRead()
            await expect(form).not.toHaveAttribute('inert', '')
            await page.unroute(initialEndpoint)
            const text = '  Protected announcement 👋\n\n**literal**\n'
            const saved = page.waitForResponse(
                response =>
                    response.url().endsWith(draftPath) &&
                    response.request().method() === 'PUT' &&
                    response.ok()
            )
            await editor.fill(text)
            await saved
            const before = (await (await page.request.get(draftPath)).json()).draft
            if (!localCopy)
                await page.evaluate(id => {
                    localStorage.removeItem(`postdot:publication-composer:v1:${id}`)
                    sessionStorage.removeItem(`postdot:publication-composer:v1:${id}`)
                }, project.id)
            const endpoint = `**${draftPath}*`
            let writes = 0
            page.on('request', request => {
                if (
                    new URL(request.url()).pathname === draftPath &&
                    ['PUT', 'DELETE'].includes(request.method())
                )
                    writes++
            })
            await page.route(endpoint, route =>
                route.request().method() === 'GET'
                    ? route.fulfill({
                          status: 503,
                          json: { error: { code: 'unavailable', message: 'Temporary failure' } },
                      })
                    : route.continue()
            )
            await page.reload()
            await expect(
                page.getByRole('button', { name: copy.common_retry, exact: true })
            ).toBeVisible()
            await expect(form).toHaveAttribute('inert', '')
            const recovery = page.locator('[data-new-publication-recovery="true"]')
            if (localCopy) {
                await expect(
                    recovery.getByRole('button', {
                        name: copy.publication_new_recovery_restore,
                        exact: true,
                    })
                ).toBeDisabled()
                await expect(
                    recovery.getByRole('button', {
                        name: copy.publication_new_recovery_discard,
                        exact: true,
                    })
                ).toBeDisabled()
            } else await expect(recovery).toHaveCount(0)
            await page.setViewportSize({ width: 390, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath('draft-read-error.png') })
            expect(writes).toBe(0)
            await page.unroute(endpoint)
            await page.getByRole('button', { name: copy.common_retry, exact: true }).click()
            await expect(
                recovery.getByRole('button', {
                    name: copy.publication_new_recovery_restore,
                    exact: true,
                })
            ).toBeEnabled()
            expect((await (await page.request.get(draftPath)).json()).draft).toEqual(before)
            await recovery
                .getByRole('button', { name: copy.publication_new_recovery_restore, exact: true })
                .click()
            await expect(editor).toHaveValue(text)
            await expect(form).not.toHaveAttribute('inert', '')
            const savedAgain = page.waitForResponse(
                response =>
                    response.url().endsWith(draftPath) &&
                    response.request().method() === 'PUT' &&
                    response.ok()
            )
            await editor.fill(`${text}Continued after recovery`)
            await savedAgain
            const after = (await (await page.request.get(draftPath)).json()).draft
            expect(after.content.postContent).toBe(`${text}Continued after recovery`)
            expect(after.revision).toBeGreaterThan(before.revision)
        })
    }
}

for (const [locale, copy] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`retains the recovery decision and local copy when discard fails in ${locale}`, async ({
        page,
    }, info) => {
        await page.addInitScript(locale => localStorage.setItem('PARAGLIDE_LOCALE', locale), locale)
        expect(
            (
                await page.request.post('/api/auth/sign-up/email', {
                    data: {
                        name: 'Discard reviewer',
                        email: `discard-${randomUUID()}@example.test`,
                        password: 'draft-recovery-password',
                    },
                })
            ).status()
        ).toBe(200)
        const response = await page.request.post('/api/projects', {
            data: { name: 'Discard desk' },
        })
        expect(response.status()).toBe(201)
        const { project } = await response.json()
        expect(
            (
                await page.request.post(`/api/projects/${project.id}/channels`, {
                    data: { name: 'Manual destination' },
                })
            ).status()
        ).toBe(201)
        const draftPath = `/api/projects/${project.id}/publication-composer-draft`
        await page.goto(`/dashboard/projects/${project.id}/publications/new?editor=legacy`)
        const form = page.locator('[data-new-publication-form="true"]')
        await expect(form).not.toHaveAttribute('inert', '')
        const editor = page.getByRole('textbox', {
            name: copy.publication_new_source_content,
            exact: true,
        })
        const saved = page.waitForResponse(
            response =>
                response.url().endsWith(draftPath) &&
                response.request().method() === 'PUT' &&
                response.ok()
        )
        await editor.fill('Keep this draft until discard succeeds')
        await saved
        await page.reload()
        const recovery = page.locator('[data-new-publication-recovery="true"]')
        await expect(
            recovery.getByRole('button', {
                name: copy.publication_new_recovery_discard,
                exact: true,
            })
        ).toBeEnabled()
        const before = (await (await page.request.get(draftPath)).json()).draft
        const endpoint = `**${draftPath}*`
        await page.route(endpoint, route =>
            route.request().method() === 'DELETE'
                ? route.fulfill({
                      status: 503,
                      json: { error: { code: 'unavailable', message: 'Temporary failure' } },
                  })
                : route.continue()
        )
        await recovery
            .getByRole('button', { name: copy.publication_new_recovery_discard, exact: true })
            .click()
        await expect(recovery.getByRole('alert')).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
        expect((await (await page.request.get(draftPath)).json()).draft).toEqual(before)
        expect(
            await page.evaluate(
                id => localStorage.getItem(`postdot:publication-composer:v1:${id}`),
                project.id
            )
        ).toContain('Keep this draft until discard succeeds')
        await page.setViewportSize({ width: 390, height: 900 })
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        await page.screenshot({ path: info.outputPath('discard-error.png') })
        await page.unroute(endpoint)
        await recovery
            .getByRole('button', { name: copy.publication_new_recovery_discard, exact: true })
            .click()
        await expect(recovery).toHaveCount(0)
        await expect(editor).toHaveValue('')
        expect((await (await page.request.get(draftPath)).json()).draft).toBeNull()
    })
}
