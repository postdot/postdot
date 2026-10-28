import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../../apps/web/messages/en.json' with { type: 'json' }
import fr from '../../apps/web/messages/fr.json' with { type: 'json' }

test.use({ timezoneId: 'UTC' })

for (const [locale, copy] of [
    ['en', en],
    ['fr', fr],
] as const) {
    test(`reviews destination colours and contextual guidance in ${locale}`, async ({
        page,
    }, info) => {
        test.setTimeout(120_000)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.addInitScript(value => localStorage.setItem('PARAGLIDE_LOCALE', value), locale)
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Navigation reviewer',
                email: `guidance-${randomUUID()}@example.test`,
                password: 'navigation-guidance-password',
            },
        })
        expect(signup.status()).toBe(200)
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: 'Editorial desk', timeZone: 'Pacific/Auckland' },
        })
        expect(projectResponse.status()).toBe(201)
        const { project } = (await projectResponse.json()) as {
            project: { id: string; workspaceId: string }
        }
        const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
            data: { name: 'Community bulletin', profile: 'manual-message' },
        })
        expect(channelResponse.status()).toBe(201)
        await page.goto(`/dashboard/projects/${project.id}/overview`)
        const observations: unknown[] = []
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => localStorage.setItem('postdot-theme', value), theme)
            await page.reload()
            await expect(page.locator('html')).toHaveClass(new RegExp(theme))
            for (const width of [1440, 820, 390]) {
                await page.setViewportSize({ width, height: 900 })
                if (width === 390) {
                    await page.getByRole('button', { name: copy.nav_toggle, exact: true }).click()
                }
                const nav = page.getByRole('navigation', {
                    name: copy.nav_work_navigation,
                    exact: true,
                })
                await expect(nav).toBeVisible()
                observations.push({
                    theme,
                    width,
                    destinations: await page
                        .locator('[data-navigation-destination]')
                        .evaluateAll(nodes =>
                            nodes.map(node => ({
                                destination: node.getAttribute('data-navigation-destination'),
                                label: node.textContent?.trim(),
                                color: node.querySelector('svg')
                                    ? getComputedStyle(node.querySelector('svg')!).color
                                    : null,
                            }))
                        ),
                })
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
                ).toBe(true)
                expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                await page.screenshot({
                    path: info.outputPath(`navigation-${theme}-${width}.png`),
                    animations: 'disabled',
                })
                if (width === 390) await page.keyboard.press('Escape')
            }
            await page.setViewportSize({ width: 1440, height: 900 })
            await page.goto(
                `/dashboard/preferences?workspaceId=${project.workspaceId}&projectId=${project.id}`
            )
            await expect(
                page.getByRole('heading', { name: copy.nav_preferences_general, exact: true })
            ).toBeVisible()
            await page.screenshot({
                path: info.outputPath(`settings-${theme}.png`),
                animations: 'disabled',
            })
            await page.goto(`/dashboard/projects/${project.id}/overview`)
        }
        await writeFile(
            info.outputPath('navigation-observations.json'),
            JSON.stringify(observations, null, 2)
        )

        // The project zone must be visible at the choice, independently of the browser zone.
        await page.goto(`/dashboard/projects/${project.id}/publications/new`)
        await page.locator('[data-publication-schedule-disclosure] > summary').click()
        await page.locator('#publication-default-schedule').click()
        const picker = page.getByRole('dialog', { name: copy.date_time_picker_date, exact: true })
        await expect(picker.locator('[data-schedule-time-zone]')).toHaveText(
            copy.date_time_picker_time_zone.replace('{timeZone}', 'Pacific/Auckland')
        )
        expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
            'UTC'
        )
        await page.screenshot({
            path: info.outputPath('scheduling-zone.png'),
            animations: 'disabled',
        })
        await page.keyboard.press('Escape')

        await page.goto(
            `/dashboard/workspace/channels?workspaceId=${project.workspaceId}&projectId=${project.id}`
        )
        await page.getByRole('button', { name: copy.channel_add, exact: true }).click()
        await expect(
            page.getByRole('combobox', {
                name: copy.workspace_channel_initial_project,
                exact: true,
            })
        ).toHaveAccessibleDescription(copy.channel_transfer_description)
        await page.screenshot({
            path: info.outputPath('initial-management.png'),
            animations: 'disabled',
        })
        await page.goto(`/dashboard/projects/${project.id}/channels`)
        await page
            .getByRole('button', {
                name: copy.channel_manage.replace('{channel}', 'Community bulletin'),
                exact: true,
            })
            .click()
        await page.getByRole('menuitem', { name: copy.channel_share_action, exact: true }).click()
        const sharing = page.getByRole('dialog')
        await expect(
            sharing.getByText(copy.channel_share_withdraw_consequence, { exact: true })
        ).toBeVisible()
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({
                path: info.outputPath(`withdrawal-${width}.png`),
                animations: 'disabled',
            })
        }
    })
}
