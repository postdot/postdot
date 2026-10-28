import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type BrowserContext } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

async function setup(page: Page, context: BrowserContext) {
    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: 'Concurrent composer reviewer',
                    email: `concurrent-${randomUUID()}@example.test`,
                    password: 'concurrent-composer-password',
                },
            })
        ).status()
    ).toBe(200)
    const made = await page.request.post('/api/projects', { data: { name: 'Concurrent desk' } })
    expect(made.status()).toBe(201)
    const { project } = await made.json()
    expect(
        (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: 'Manual desk' },
            })
        ).status()
    ).toBe(201)
    const url = `/dashboard/projects/${project.id}/publications/new?editor=legacy`
    const endpoint = `/api/projects/${project.id}/publication-composer-draft`
    const other = await context.newPage()
    await page.goto(url)
    await other.goto(url)
    for (const tab of [page, other])
        await expect(tab.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
    return { project, other, endpoint }
}

// These are genuine tabs in one context, sharing cookies and localStorage.
for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    for (const choice of ['local', 'saved'] as const) {
        test(`resolves a real two-tab draft conflict with the ${choice} version in ${locale}`, async ({
            page,
            context,
        }, info) => {
            test.setTimeout(90_000)
            await context.addInitScript(
                ({ locale, theme }) => {
                    localStorage.setItem('PARAGLIDE_LOCALE', locale)
                    localStorage.setItem('postdot-theme', theme)
                },
                { locale, theme }
            )
            const { other, endpoint } = await setup(page, context)
            const firstEditor = page.getByRole('textbox', {
                name: copy.publication_new_source_content,
                exact: true,
            })
            const secondEditor = other.getByRole('textbox', {
                name: copy.publication_new_source_content,
                exact: true,
            })
            async function saveFirst(text: string) {
                const saved = page.waitForResponse(
                    response =>
                        response.url().endsWith(endpoint) &&
                        response.request().method() === 'PUT' &&
                        response.ok()
                )
                await firstEditor.fill(text)
                await saved
            }
            await saveFirst('Version A from the first tab')
            const refused = other.waitForResponse(
                response =>
                    response.url().endsWith(endpoint) && response.request().method() === 'PUT'
            )
            await secondEditor.fill('Version B from the second tab')
            expect((await refused).status()).toBe(409)
            await expect(
                other.getByText(copy.composer_conflict_notice, { exact: true })
            ).toBeVisible()
            await expect(
                other.getByRole('button', { name: copy.publication_new_create_draft, exact: true })
            ).toBeDisabled()
            let secondWrites = 0
            other.on('request', request => {
                if (request.url().endsWith(endpoint) && request.method() === 'PUT') secondWrites++
            })
            await secondEditor.fill('Version B continued locally')
            await saveFirst('Version A continued after the conflict')
            expect(secondWrites).toBe(0)
            expect(
                (await (await page.request.get(endpoint)).json()).draft.content.postContent
            ).toBe('Version A continued after the conflict')
            await other.reload()
            const comparison = other.locator('[data-composer-conflict]')
            await expect(comparison).toBeVisible()
            await expect(
                comparison.getByRole('region', { name: copy.composer_conflict_local, exact: true })
            ).toContainText('Version B continued locally')
            await expect(
                comparison.getByRole('region', { name: copy.composer_conflict_saved, exact: true })
            ).toContainText('Version A continued after the conflict')
            for (const width of [1440, 390]) {
                await other.setViewportSize({ width, height: 900 })
                expect(
                    await other.evaluate(() => document.documentElement.scrollWidth > innerWidth)
                ).toBe(false)
                expect((await new AxeBuilder({ page: other }).analyze()).violations).toEqual([])
                await other.screenshot({ path: info.outputPath(`comparison-${width}.png`) })
            }
            const downloading = other.waitForEvent('download')
            await comparison
                .getByRole('button', { name: copy.composer_conflict_download, exact: true })
                .click()
            const download = await downloading
            const path = await download.path()
            expect(path).not.toBeNull()
            const versions = JSON.parse(await readFile(path!, 'utf8'))
            expect(versions.local.postContent).toBe('Version B continued locally')
            expect(versions.saved.postContent).toBe('Version A continued after the conflict')
            if (choice === 'local') {
                await saveFirst('Version A changed during comparison')
                await comparison
                    .getByRole('button', { name: copy.composer_conflict_replace, exact: true })
                    .click()
                await expect(comparison.getByRole('alert')).toBeVisible()
                await expect(
                    comparison.getByRole('region', {
                        name: copy.composer_conflict_saved,
                        exact: true,
                    })
                ).toContainText('Version A changed during comparison')
                expect(
                    (await (await page.request.get(endpoint)).json()).draft.content.postContent
                ).toBe('Version A changed during comparison')
                await comparison
                    .getByRole('button', { name: copy.composer_conflict_replace, exact: true })
                    .click()
            } else
                await comparison
                    .getByRole('button', { name: copy.composer_conflict_use_saved, exact: true })
                    .click()
            await expect(comparison).toHaveCount(0)
            const expected =
                choice === 'local'
                    ? 'Version B continued locally'
                    : 'Version A continued after the conflict'
            await expect(secondEditor).toHaveValue(expected)
            expect(
                (await (await page.request.get(endpoint)).json()).draft.content.postContent
            ).toBe(expected)
            await expect(firstEditor).toHaveValue(
                choice === 'local'
                    ? 'Version A changed during comparison'
                    : 'Version A continued after the conflict'
            )
            await other.close()
        })
    }
}

test('guards stale discard and draft recreation while retaining legacy delete compatibility', async ({
    page,
    context,
}) => {
    const { other, endpoint } = await setup(page, context)
    const saved = page.waitForResponse(
        response =>
            response.url().endsWith(endpoint) &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Original identity')
    await saved
    const first = (await (await page.request.get(endpoint)).json()).draft
    const guard = { expectedRevision: first.revision, expectedDraftId: first.id }
    const guardedDelete = `${endpoint}?${new URLSearchParams({ expectedRevision: String(first.revision), expectedDraftId: first.id })}`
    expect((await page.request.delete(guardedDelete)).status()).toBe(200)
    const created = await page.request.put(endpoint, {
        data: {
            expectedRevision: 0,
            content: { ...first.content, postContent: 'Replacement identity' },
        },
    })
    expect(created.status()).toBe(200)
    const replacement = (await created.json()).draft
    expect(replacement.id).not.toBe(first.id)
    expect(replacement.revision).toBe(first.revision)
    expect(
        (await other.request.put(endpoint, { data: { ...guard, content: first.content } })).status()
    ).toBe(409)
    expect((await other.request.delete(guardedDelete)).status()).toBe(409)
    expect((await (await page.request.get(endpoint)).json()).draft).toEqual(replacement)
    expect((await page.request.delete(endpoint)).status()).toBe(200)
    await other.close()
})

test('creating a post from an older tab does not delete the newer recovery draft', async ({
    page,
    context,
}) => {
    const { other, endpoint } = await setup(page, context)
    const saved = page.waitForResponse(
        response =>
            response.url().endsWith(endpoint) &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await page
        .getByRole('textbox', { name: 'Content', exact: true })
        .fill('Post from the first tab')
    await saved
    const first = (await (await page.request.get(endpoint)).json()).draft
    expect(
        (
            await other.request.put(endpoint, {
                data: {
                    expectedRevision: first.revision,
                    expectedDraftId: first.id,
                    content: { ...first.content, postContent: 'Newer recovery from another tab' },
                },
            })
        ).status()
    ).toBe(200)
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page).toHaveURL(/\/posts\/[^/]+$/)
    expect((await (await page.request.get(endpoint)).json()).draft.content.postContent).toBe(
        'Newer recovery from another tab'
    )
    await other.close()
})

test('keeps both choices blocked after a failed conflict read, then recovers without writing', async ({
    page,
    context,
}) => {
    const { other, endpoint } = await setup(page, context)
    const saved = page.waitForResponse(
        response =>
            response.url().endsWith(endpoint) &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await page
        .getByRole('textbox', { name: 'Content', exact: true })
        .fill('Server version before read failure')
    await saved
    const refused = other.waitForResponse(
        response => response.url().endsWith(endpoint) && response.request().method() === 'PUT'
    )
    await other
        .getByRole('textbox', { name: 'Content', exact: true })
        .fill('Local version before read failure')
    expect((await refused).status()).toBe(409)
    const matcher = `**${endpoint}`
    await other.route(matcher, route =>
        route.request().method() === 'GET'
            ? route.fulfill({
                  status: 503,
                  json: { error: { code: 'unavailable', message: 'Temporary failure' } },
              })
            : route.continue()
    )
    await other.getByRole('button', { name: en.composer_conflict_review, exact: true }).click()
    const comparison = other.locator('[data-composer-conflict]')
    await expect(comparison.getByRole('alert')).toBeVisible()
    await expect(comparison.getByText(en.composer_conflict_removed, { exact: true })).toHaveCount(0)
    await expect(
        comparison.getByRole('button', { name: en.composer_conflict_replace, exact: true })
    ).toBeDisabled()
    await expect(
        comparison.getByRole('button', { name: en.composer_conflict_start_new, exact: true })
    ).toBeDisabled()
    await other.unroute(matcher)
    await comparison
        .getByRole('button', { name: en.composer_conflict_refresh, exact: true })
        .click()
    await expect(
        comparison.getByRole('region', { name: en.composer_conflict_saved, exact: true })
    ).toContainText('Server version before read failure')
    await comparison
        .getByRole('button', { name: en.composer_conflict_use_saved, exact: true })
        .click()
    await expect(other.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(
        'Server version before read failure'
    )
    await other.close()
})

test('returning from channel setup keeps the same-tab draft without a false conflict', async ({
    page,
    context,
}) => {
    const { other, endpoint } = await setup(page, context)
    const saved = page.waitForResponse(
        response =>
            response.url().endsWith(endpoint) &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
    await page
        .getByRole('textbox', { name: 'Content', exact: true })
        .fill('Same-tab draft across channel setup')
    await saved
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const loaded = page.waitForResponse(
        response =>
            response.url().endsWith(endpoint) &&
            response.request().method() === 'GET' &&
            response.ok()
    )
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await loaded
    const form = page.locator('[data-new-publication-form]')
    await expect(form).toHaveAttribute('aria-busy', 'false')
    await expect(form).not.toHaveAttribute('inert', '')
    await expect(page.locator('[data-composer-conflict]')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveAttribute(
        'contenteditable',
        'true'
    )
    await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveText(
        'Same-tab draft across channel setup'
    )
    await other.close()
})

test('resumes after a save committed during channel navigation without a false conflict', async ({
    page,
    context,
}) => {
    const { other, endpoint } = await setup(page, context)
    let releaseResponse: () => void = () => {}
    let markCommitted: () => void = () => {}
    let markResponseFinished: () => void = () => {}
    const responseFinished = new Promise<void>(resolve => {
        markResponseFinished = resolve
    })
    const committed = new Promise<void>(resolve => {
        markCommitted = resolve
    })
    const responseGate = new Promise<void>(resolve => {
        releaseResponse = resolve
    })
    const matcher = `**${endpoint}`
    await page.route(matcher, async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        markCommitted()
        await responseGate
        await route.fulfill({ response })
        markResponseFinished()
    })
    await page
        .getByRole('textbox', { name: 'Content', exact: true })
        .fill('Committed while visiting channel setup')
    await committed
    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    releaseResponse()
    await responseFinished
    await page.unroute(matcher)
    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    const form = page.locator('[data-new-publication-form]')
    await expect(form).toHaveAttribute('aria-busy', 'false')
    await expect(form).not.toHaveAttribute('inert', '')
    await expect(page.locator('[data-composer-conflict]')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveAttribute(
        'contenteditable',
        'true'
    )
    await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveText(
        'Committed while visiting channel setup'
    )
    await other.close()
})
