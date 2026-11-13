import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import de from '../apps/web/messages/de.json' with { type: 'json' }
import en from '../apps/web/messages/en.json' with { type: 'json' }
import es from '../apps/web/messages/es.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test.use({ reducedMotion: 'reduce' })

const unavailable = {
    status: 503,
    json: { error: { code: 'unavailable', message: 'Temporary failure' } },
}

async function setup(page: Page) {
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Save retry reviewer',
                    email: `save-retry-${randomUUID()}@example.test`,
                    password: 'composer-retry-password',
                },
            })
        ).status()
    ).toBe(200)
    const made = await page.request.post('/api/projects', { data: { name: 'Retry desk' } })
    expect(made.status()).toBe(201)
    const { project } = await made.json()
    expect(
        (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: 'Community bulletin' },
            })
        ).status()
    ).toBe(201)
    const path = `/dashboard/projects/${project.id}/publications/new`
    const endpoint = `/api/projects/${project.id}/publication-composer-draft`
    await page.goto(path)
    await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
    return { endpoint, matcher: `**${endpoint}*`, project, path }
}

function nextWrite(page: Page, endpoint: string, method = 'PUT') {
    return page.waitForResponse(
        response =>
            new URL(response.url()).pathname === endpoint && response.request().method() === method
    )
}

for (const [locale, copy, theme] of [
    ['en', en, 'light'],
    ['fr', fr, 'dark'],
    ['de', de, 'light'],
    ['es', es, 'dark'],
] as const) {
    test(`retries the current composition once without creating a post in ${locale}`, async ({
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
        const { endpoint, matcher, project, path } = await setup(page)
        const editor = page.getByRole('textbox', {
            name: copy.publication_new_source_content,
            exact: true,
        })
        let writes = 0
        let creations = 0
        page.on('request', request => {
            const pathname = new URL(request.url()).pathname
            if (pathname === endpoint && request.method() === 'PUT') writes++
            if (pathname === `/api/projects/${project.id}/posts` && request.method() === 'POST')
                creations++
        })
        let retryGate: Promise<void> | undefined
        await page.route(matcher, async route => {
            if (route.request().method() !== 'PUT') return route.continue()
            await retryGate
            await route.fulfill(unavailable)
        })
        await editor.fill('Original unsaved composition')
        const feedback = page.locator('[data-composer-autosave-error]')
        await expect(feedback).toContainText(copy.publication_new_autosave_unavailable)
        await expect(feedback.getByRole('button', { name: copy.common_retry })).toBeVisible()
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await feedback.scrollIntoViewIfNeeded()
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            await page.screenshot({ path: info.outputPath(`save-error-${width}.png`) })
        }
        expect(writes).toBe(1)
        let releaseRetry: () => void = () => {}
        retryGate = new Promise<void>(resolve => {
            releaseRetry = resolve
        })
        const failedAgain = nextWrite(page, endpoint)
        const retryStarted = page.waitForRequest(
            request => new URL(request.url()).pathname === endpoint && request.method() === 'PUT'
        )
        const retry = feedback.getByRole('button', { name: copy.common_retry })
        await retry.click()
        try {
            await retryStarted
            await expect(retry).toBeDisabled()
            await expect(retry).toBeFocused()
            await retry.press('Enter')
            expect(writes).toBe(2)
        } finally {
            releaseRetry()
        }
        expect((await failedAgain).status()).toBe(503)
        await expect(feedback).toBeVisible()
        await expect(retry).toBeEnabled()
        await expect(retry).toBeFocused()
        expect(writes).toBe(2)
        await page.unroute(matcher)

        // A retry must cancel the pending debounce and use the latest editing state.
        await editor.fill('Latest composition before explicit retry')
        const saved = nextWrite(page, endpoint)
        await feedback.getByRole('button', { name: copy.common_retry }).click()
        expect((await saved).ok()).toBe(true)
        await expect(feedback).toHaveCount(0)
        await expect(
            page.getByText(copy.publication_new_autosave_saved, { exact: true })
        ).toBeVisible()
        expect((await (await page.request.get(endpoint)).json()).draft.content.postContent).toBe(
            'Latest composition before explicit retry'
        )
        expect(creations).toBe(0)
        await expect(page).toHaveURL(path)

        // Failed creation uses readable shared error colours in both themes.
        await page.route(`**/api/projects/${project.id}/posts`, route => route.fulfill(unavailable))
        await page
            .getByRole('button', { name: copy.publication_new_create_draft, exact: true })
            .click()
        const alert = page
            .getByRole('alert')
            .filter({ hasText: copy.publication_new_action_failed })
        await expect(alert).toBeVisible()
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            await alert.scrollIntoViewIfNeeded()
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath(`creation-error-${width}.png`) })
        }
        // Reopening must offer recovery of the composition whose retry succeeded.
        await page.reload()
        await expect(page.locator('[data-new-publication-recovery]')).toBeVisible()
        expect(writes).toBe(3)
        expect(creations).toBe(1)
    })
}

test('a retry discovers an accepted write with a lost response as a conflict', async ({ page }) => {
    const { endpoint, matcher } = await setup(page)
    const editor = page.getByRole('textbox', { name: 'Content', exact: true })
    await page.route(matcher, async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        expect((await route.fetch()).ok()).toBe(true)
        await route.fulfill(unavailable)
    })
    await editor.fill('Keep this local composition after the lost acknowledgement')
    const feedback = page.locator('[data-composer-autosave-error]')
    await expect(feedback).toBeVisible()
    await page.unroute(matcher)
    const refused = nextWrite(page, endpoint)
    await feedback.getByRole('button', { name: en.common_retry }).click()
    expect((await refused).status()).toBe(409)
    await expect(feedback).toHaveCount(0)
    await expect(page.getByText(en.composer_conflict_notice, { exact: true })).toBeVisible()
    await expect(editor).toHaveText('Keep this local composition after the lost acknowledgement')
    await expect(page.getByRole('button', { name: en.publication_new_create_draft })).toBeDisabled()
})

for (const refusal of ['session', 'account'] as const) {
    test(`a retry pauses after ${refusal === 'session' ? 'a session' : 'an account'} refusal and preserves local recovery`, async ({
        page,
    }) => {
        const { matcher, project } = await setup(page)
        const editor = page.getByRole('textbox', { name: 'Content', exact: true })
        await page.route(matcher, route =>
            route.request().method() === 'PUT' ? route.fulfill(unavailable) : route.continue()
        )
        const text = 'Keep the author copy after retry is refused'
        await editor.fill(text)
        const feedback = page.locator('[data-composer-autosave-error]')
        await expect(feedback).toBeVisible()
        await page.unroute(matcher)
        await page.route(matcher, route =>
            route.request().method() === 'PUT'
                ? route.fulfill({
                      status: refusal === 'session' ? 401 : 409,
                      json: {
                          error: {
                              code: refusal === 'session' ? 'unauthorized' : 'account_changed',
                              message: 'The author session changed',
                          },
                      },
                  })
                : route.continue()
        )
        await feedback.getByRole('button', { name: en.common_retry }).click()
        await expect(
            page.getByText(
                refusal === 'session'
                    ? en.composer_session_ended_title
                    : en.composer_account_changed_title,
                { exact: true }
            )
        ).toBeVisible()
        await expect(feedback).toHaveCount(0)
        await expect(page.locator('[data-new-publication-form]')).toHaveAttribute('inert', '')
        expect(
            await page.evaluate(id => {
                const prefix = `postdot:publication-composer:v1:${encodeURIComponent(id)}:user:`
                const key = Object.keys(sessionStorage).find(key => key.startsWith(prefix))
                return key === undefined ? null : sessionStorage.getItem(key)
            }, project.id)
        ).toContain(text)
    })
}

test('retrying an empty composition repeats guarded deletion instead of recreating a draft', async ({
    page,
}) => {
    const { endpoint, matcher } = await setup(page)
    const editor = page.getByRole('textbox', { name: 'Content', exact: true })
    const saved = nextWrite(page, endpoint)
    await editor.fill('This composition will be cleared')
    expect((await saved).ok()).toBe(true)
    await page.route(matcher, route =>
        route.request().method() === 'DELETE' ? route.fulfill(unavailable) : route.continue()
    )
    await editor.fill('')
    const feedback = page.locator('[data-composer-autosave-error]')
    await expect(feedback).toBeVisible()
    await page.unroute(matcher)
    const deleted = nextWrite(page, endpoint, 'DELETE')
    await feedback.getByRole('button', { name: en.common_retry }).click()
    expect((await deleted).ok()).toBe(true)
    await expect(feedback).toHaveCount(0)
    await expect(editor).toBeEmpty()
    expect((await (await page.request.get(endpoint)).json()).draft).toBeNull()
})
