import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../../apps/web/messages/en.json' with { type: 'json' }
import fr from '../../apps/web/messages/fr.json' with { type: 'json' }

test.use({ reducedMotion: 'reduce' })

// Opt-in evidence collection. Review findings against SPEC-010 rather than
// turning a particular visual composition into a regression assertion.
for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    test(`collects composer failure and recovery evidence in ${locale}`, async ({
        page,
        context,
    }) => {
        test.setTimeout(180_000)
        const directory = join(
            process.cwd(),
            'test-results/experience-audit/composer-recovery',
            `${locale}-${theme}`
        )
        await mkdir(directory, { recursive: true })
        await context.addInitScript(
            ({ locale, theme }) => {
                localStorage.setItem('PARAGLIDE_LOCALE', locale)
                localStorage.setItem('postdot-theme', theme)
            },
            { locale, theme }
        )
        const observations: Record<string, unknown>[] = []
        async function capture(tab: Page, state: string) {
            for (const width of [1440, 820, 390]) {
                await tab.setViewportSize({ width, height: 900 })
                await tab.screenshot({ path: join(directory, `${state}-${width}.png`) })
                const measurement = await tab.evaluate(() => ({
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    title: document.querySelector('h1')?.textContent,
                    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
                        element => element.textContent
                    ),
                    statuses: Array.from(document.querySelectorAll('[aria-live="polite"]')).map(
                        element => ({
                            text: element.textContent,
                            title: element.getAttribute('title'),
                            top: element.getBoundingClientRect().top,
                        })
                    ),
                    disabled: Array.from(document.querySelectorAll('button:disabled')).map(
                        element => ({
                            text: element.textContent,
                            title: element.getAttribute('title'),
                            description: element.getAttribute('aria-describedby'),
                        })
                    ),
                }))
                const accessibility = await new AxeBuilder({ page: tab }).analyze()
                observations.push({
                    state,
                    width,
                    ...measurement,
                    accessibility: accessibility.violations.map(({ id, impact, nodes }) => ({
                        id,
                        impact,
                        nodes: nodes.map(({ target, failureSummary }) => ({
                            target,
                            failureSummary,
                        })),
                    })),
                })
            }
            await writeFile(
                join(directory, 'observations.json'),
                JSON.stringify(observations, null, 2)
            )
            await tab.setViewportSize({ width: 1440, height: 900 })
        }

        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Composer audit',
                email: `composer-audit-${randomUUID()}@example.test`,
                password: 'composer-audit-password',
            },
        })
        expect(signup.status()).toBe(200)
        const created = await page.request.post('/api/projects', {
            data: { name: 'Recovery desk' },
        })
        expect(created.status()).toBe(201)
        const { project } = await created.json()
        expect(
            (
                await page.request.post(`/api/projects/${project.id}/channels`, {
                    data: { name: 'Community bulletin' },
                })
            ).status()
        ).toBe(201)
        for (const name of ['Release', 'Maintenance'])
            expect(
                (
                    await page.request.post(`/api/projects/${project.id}/tags`, {
                        data: { name },
                    })
                ).status()
            ).toBe(201)
        const path = `/dashboard/projects/${project.id}/publications/new`
        const endpoint = `/api/projects/${project.id}/publication-composer-draft`
        const matcher = `**${endpoint}*`
        function nextSave(tab: Page) {
            return tab.waitForResponse(
                response =>
                    new URL(response.url()).pathname === endpoint &&
                    response.request().method() === 'PUT' &&
                    response.ok()
            )
        }
        const form = page.locator('[data-new-publication-form]')
        const editor = page.getByRole('textbox', {
            name: copy.publication_new_source_content,
            exact: true,
        })
        const unavailable = {
            status: 503,
            json: { error: { code: 'unavailable', message: 'Temporary failure' } },
        }
        await page.goto(path)
        await expect(form).not.toHaveAttribute('inert', '')
        await expect(editor).toHaveAttribute('contenteditable', 'true')
        await page.route(matcher, route =>
            route.request().method() === 'PUT' ? route.fulfill(unavailable) : route.continue()
        )
        await editor.fill('A community update preserved through interrupted work.')
        await expect(page.getByText(copy.publication_new_autosave_unavailable)).toBeVisible()
        await capture(page, 'autosave-unavailable')
        await page.unroute(matcher)
        const saved = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === endpoint &&
                response.request().method() === 'PUT' &&
                response.ok()
        )
        await editor.fill('A community update preserved through interrupted work. Continued.')
        await saved
        const before = (await (await page.request.get(endpoint)).json()).draft

        const postMatcher = `**/api/projects/${project.id}/posts`
        await page.route(postMatcher, route => route.fulfill(unavailable))
        await page
            .getByRole('button', { name: copy.publication_new_create_draft, exact: true })
            .click()
        await expect(page.getByText(copy.publication_new_action_failed)).toBeVisible()
        await expect(editor).toContainText(before.content.postContent)
        await capture(page, 'creation-refused')
        await page.unroute(postMatcher)

        await page.route(matcher, route =>
            route.request().method() === 'GET' ? route.fulfill(unavailable) : route.continue()
        )
        await page.reload()
        const recovery = page.locator('[data-new-publication-recovery]')
        await expect(recovery.getByRole('button', { name: copy.common_retry })).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
        await capture(page, 'recovery-read-unavailable')
        await page.unroute(matcher)
        await recovery.getByRole('button', { name: copy.common_retry }).click()
        const restore = recovery.getByRole('button', {
            name: copy.publication_new_recovery_restore,
            exact: true,
        })
        await expect(restore).toBeEnabled()
        await page.route(matcher, route =>
            route.request().method() === 'DELETE' ? route.fulfill(unavailable) : route.continue()
        )
        await recovery
            .getByRole('button', { name: copy.publication_new_recovery_discard, exact: true })
            .click()
        await expect(recovery.getByRole('alert')).toBeVisible()
        expect((await (await page.request.get(endpoint)).json()).draft).toEqual(before)
        await capture(page, 'discard-refused')
        await page.unroute(matcher)
        const restored = nextSave(page)
        await restore.click()
        await restored

        const other = await context.newPage()
        await other.goto(path)
        const otherRestored = nextSave(other)
        await other
            .locator('[data-new-publication-recovery]')
            .getByRole('button', { name: copy.publication_new_recovery_restore, exact: true })
            .click()
        await otherRestored
        async function selectTag(tab: Page, name: string) {
            await tab.getByRole('button', { name: copy.taxonomy_select_tags, exact: true }).click()
            await tab.getByRole('menuitemcheckbox', { name, exact: true }).click()
            await tab.keyboard.press('Escape')
        }
        const tagged = nextSave(other)
        await selectTag(other, 'Release')
        await tagged
        const refused = page.waitForResponse(
            response => new URL(response.url()).pathname === endpoint && response.status() === 409
        )
        await selectTag(page, 'Maintenance')
        await refused
        await page.getByRole('button', { name: copy.composer_conflict_review }).click()
        const comparison = page.locator('[data-composer-conflict]')
        await expect(
            comparison.getByRole('button', { name: copy.composer_conflict_use_saved })
        ).toBeEnabled()
        observations.push({
            state: 'tag-only-conflict',
            local: await comparison
                .getByRole('region', { name: copy.composer_conflict_local })
                .innerText(),
            saved: await comparison
                .getByRole('region', { name: copy.composer_conflict_saved })
                .innerText(),
        })
        await capture(page, 'tag-only-conflict')
        await page.route(matcher, route =>
            route.request().method() === 'GET' ? route.fulfill(unavailable) : route.continue()
        )
        await comparison.getByRole('button', { name: copy.composer_conflict_refresh }).click()
        await expect(comparison.getByRole('alert')).toBeVisible()
        await capture(page, 'comparison-read-unavailable')
        await page.unroute(matcher)
        await comparison.getByRole('button', { name: copy.composer_conflict_refresh }).click()
        await comparison.getByRole('button', { name: copy.composer_conflict_use_saved }).click()
        await expect(
            page.getByRole('textbox', { name: copy.publication_new_source_content })
        ).toContainText(before.content.postContent)
        await other.close()
    })
}
