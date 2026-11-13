import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import type { ReleaseIdentity } from '../apps/web/src/lib/release-identity'

const studio: ReleaseIdentity =
    process.env.POSTDOT_E2E_PRODUCTION_WEB === 'true'
        ? JSON.parse(
              readFileSync(new URL('../apps/web/dist/studio-build.json', import.meta.url), 'utf8')
          )
        : { version: null, revision: null }

for (const [locale, messages] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`installation Studio/API identity comparison and recovery in ${locale}`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(90_000)
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Release acceptance',
                email: `release-${randomUUID()}@example.test`,
                password: 'release-acceptance-password-123',
            },
        })
        expect(signup.status()).toBe(200)
        await page.addInitScript(value => {
            localStorage.setItem('PARAGLIDE_LOCALE', value)
            localStorage.setItem('postdot-theme', value === 'en' ? 'dark' : 'light')
        }, locale)
        // An operator may replace this HTTP file while an old tab remains open.
        // It must never relabel the JavaScript actually loaded by that tab.
        await page.route('**/studio-build.json', route =>
            route.fulfill({ json: { version: '999.0.0', revision: 'f'.repeat(40) } })
        )
        const initial: ReleaseIdentity = {
            version: studio.version ?? '0.1.0-alpha.3',
            revision: studio.revision ?? 'a'.repeat(40),
        }
        let api: ReleaseIdentity = { ...initial }
        let unavailable = false
        let waiting = true
        const gate = Promise.withResolvers<void>()
        await page.route('**/api/version', async route => {
            if (waiting) await gate.promise
            await route.fulfill(
                unavailable ? { status: 503, json: { error: 'Unavailable' } } : { json: api }
            )
        })
        await page.goto('/dashboard/settings')
        await expect(
            page.getByRole('heading', { name: messages.nav_instance, exact: true })
        ).toBeVisible()
        const section = page.getByRole('region', { name: messages.release_title })
        const versionCells = section
            .getByRole('row', { name: new RegExp(`^${messages.release_version} `) })
            .getByRole('cell')
        const revisionCells = section
            .getByRole('row', { name: new RegExp(`^${messages.release_revision} `) })
            .getByRole('cell')
        const assertStudio = async () => {
            await expect(versionCells.nth(0)).toHaveText(
                studio.version ?? messages.release_unversioned
            )
            await expect(revisionCells.nth(0)).toHaveText(
                studio.revision ?? messages.release_unknown_revision
            )
        }
        const capture = async (state: string) => {
            for (const width of [1440, 820, 390]) {
                await page.setViewportSize({ width, height: 960 })
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
                ).toBe(false)
                await section.screenshot({
                    path: testInfo.outputPath(`release-${state}-${width}.png`),
                })
            }
        }
        await assertStudio()
        await expect(section.getByRole('status')).toHaveText(messages.release_checking)
        await capture('loading')
        waiting = false
        gate.resolve()
        await expect(versionCells.nth(1)).toHaveText(initial.version!)
        await expect(revisionCells.nth(1)).toHaveText(initial.revision!)
        await expect(section.getByRole('status')).toHaveText(
            studio.version && studio.revision ? messages.release_match : messages.release_unknown
        )
        await capture('initial')
        expect(
            (
                await new AxeBuilder({ page })
                    .include('section[aria-labelledby="release-title"]')
                    .analyze()
            ).violations
        ).toEqual([])

        if (studio.version !== null) {
            api = { ...initial, version: initial.version === '999.0.0' ? '998.0.0' : '999.0.0' }
            await section
                .getByRole('button', { name: messages.release_check_api, exact: true })
                .click()
            await expect(section.getByRole('alert')).toContainText(messages.release_mismatch_title)
            await expect(versionCells.nth(1)).toHaveText(api.version!)
            await assertStudio()
            await capture('version-mismatch')
        }
        if (studio.revision !== null) {
            api = {
                ...initial,
                revision: studio.revision === 'b'.repeat(40) ? 'c'.repeat(40) : 'b'.repeat(40),
            }
            await section
                .getByRole('button', { name: messages.release_check_api, exact: true })
                .click()
            await expect(section.getByRole('alert')).toContainText(messages.release_mismatch_title)
            await expect(revisionCells.nth(1)).toHaveText(api.revision!)
            await assertStudio()
            await capture('revision-mismatch')
            expect(
                (
                    await new AxeBuilder({ page })
                        .include('section[aria-labelledby="release-title"]')
                        .analyze()
                ).violations
            ).toEqual([])
        }
        if (studio.version !== null && studio.revision !== null) {
            api = { ...initial }
            await section
                .getByRole('button', { name: messages.release_check_api, exact: true })
                .click()
            await expect(section.getByRole('status')).toHaveText(messages.release_match)
            await expect(section.getByRole('alert')).toHaveCount(0)
            await assertStudio()
        }
        unavailable = true
        await section.getByRole('button', { name: messages.release_check_api, exact: true }).click()
        await expect(section.getByRole('alert')).toHaveText(messages.release_load_failed, {
            timeout: 15_000,
        })
        await assertStudio()
        await capture('error')
        unavailable = false
        api = { version: null, revision: null }
        await section.getByRole('button', { name: messages.common_retry, exact: true }).click()
        await expect(versionCells.nth(1)).toHaveText(messages.release_unversioned)
        await expect(revisionCells.nth(1)).toHaveText(messages.release_unknown_revision)
        await expect(section.getByRole('status')).toHaveText(messages.release_unknown)
        await expect(section.getByRole('alert')).toHaveCount(0)
        await assertStudio()
        await capture('unversioned')
    })
}
