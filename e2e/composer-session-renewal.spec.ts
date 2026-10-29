import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import { accounts, login } from './composer-account-fixture'

for (const sameAuthor of [false, true]) {
    test(`revalidating the same project ${sameAuthor ? 'preserves the same author composition' : 'resets composition for a different author'}`, async ({
        page,
    }) => {
        const data = await accounts(page)
        try {
            await page.goto(data.url)
            const form = page.locator('[data-new-publication-form]')
            await expect(form).not.toHaveAttribute('inert', '')
            const content = page.getByRole('textbox', { name: 'Content', exact: true })
            const saved = page.waitForResponse(
                response =>
                    new URL(response.url()).pathname === data.endpoint &&
                    response.request().method() === 'PUT' &&
                    response.ok()
            )
            const text = 'Original author in-memory composition'
            await content.fill(text)
            await saved
            // Renew the same account or switch accounts without unmounting this tab.
            const changed = await page.request.post('/api/auth/sign-in/email', {
                data: {
                    email: sameAuthor ? data.ownerEmail : data.memberEmail,
                    password: data.password,
                },
            })
            expect(changed.status()).toBe(200)
            await page.getByRole('link', { name: 'Channels', exact: true }).click()
            await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
            await page.evaluate(projectId => {
                const url = new URL(location.href)
                url.searchParams.set('projectId', projectId)
                history.pushState(history.state, '', url)
                dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
            }, data.project.id)
            await expect(
                page
                    .getByText(sameAuthor ? 'Original author' : 'Second author', { exact: true })
                    .first()
            ).toBeVisible()
            await page.getByRole('link', { name: 'New publication', exact: true }).click()
            await expect(form).not.toHaveAttribute('inert', '')
            await expect(content).toHaveText(sameAuthor ? text : '')
            if (!sameAuthor) {
                expect(
                    (await (await data.member.request.get(data.endpoint)).json()).draft
                ).toBeNull()
                const key = `postdot:publication-composer:v1:${encodeURIComponent(data.project.id)}:user:${encodeURIComponent(data.second.id)}`
                expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
            }
        } finally {
            await data.close()
        }
    })
}

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    for (const action of ['autosave', 'create'] as const) {
        test(`an expired composer session offers sign-in and retains the author copy after ${action} in ${locale}`, async ({
            page,
        }, info) => {
            test.setTimeout(90_000)
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
                const form = page.locator('[data-new-publication-form]')
                await expect(form).not.toHaveAttribute('inert', '')
                const content = page.getByRole('textbox', {
                    name: copy.publication_new_source_content,
                    exact: true,
                })
                // Revoke the current cookie's server session while leaving the mounted UI in place.
                expect((await page.request.post('/api/auth/sign-out')).status()).toBe(200)
                const text = 'Keep my text through session renewal'
                const refused = page.waitForResponse(
                    response =>
                        response.status() === 401 &&
                        response.request().method() === (action === 'autosave' ? 'PUT' : 'POST') &&
                        new URL(response.url()).pathname ===
                            (action === 'autosave'
                                ? data.endpoint
                                : `/api/projects/${data.project.id}/posts`)
                )
                await content.fill(text)
                if (action === 'create')
                    await page
                        .getByRole('button', {
                            name: copy.publication_new_create_draft,
                            exact: true,
                        })
                        .click()
                await refused
                await expect(
                    page.getByRole('button', {
                        name: copy.composer_session_ended_sign_in,
                        exact: true,
                    })
                ).toBeVisible()
                await expect(form).toHaveAttribute('inert', '')
                if (action === 'autosave') {
                    await expect(page.locator('[data-channel-selected]')).toHaveCSS(
                        'transform',
                        'none'
                    )
                    await page.screenshot({ path: info.outputPath('session-ended-desktop.png') })
                    await page.setViewportSize({ width: 390, height: 844 })
                    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                    expect(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth
                        )
                    ).toBe(true)
                    await page.screenshot({ path: info.outputPath('session-ended-mobile.png') })
                }
                await page
                    .getByRole('button', { name: copy.composer_session_ended_sign_in, exact: true })
                    .click()
                await expect(page).toHaveURL(/\/login\?continue=/)
                await login(page, data.ownerEmail, data.password, {
                    email: copy.auth_email,
                    password: copy.auth_password,
                    submit: copy.auth_sign_in_button,
                })
                await expect(page).toHaveURL(data.url)
                const recovery = page.locator('[data-new-publication-recovery]')
                await expect(recovery).toContainText(text)
                await recovery
                    .getByRole('button', {
                        name: copy.publication_new_recovery_restore,
                        exact: true,
                    })
                    .click()
                await expect(content).toHaveValue(text)
            } finally {
                await data.close()
            }
        })
    }
}
