import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import de from '../apps/web/messages/de.json' with { type: 'json' }
import en from '../apps/web/messages/en.json' with { type: 'json' }
import es from '../apps/web/messages/es.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }

test.use({ reducedMotion: 'reduce' })

async function upload(page: Page, projectId: string, filename: string, portrait: boolean) {
    const bytes = portrait
        ? await readFile(
              new URL('../apps/web/src/assets/sample-social-portrait.jpg', import.meta.url)
          )
        : Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              'base64'
          )
    const response = await page.request.post(`/api/projects/${projectId}/media/uploads`, {
        data: {
            originalFilename: filename,
            contentType: portrait ? 'image/jpeg' : 'image/png',
            expectedSize: bytes.length,
            defaultAccessibilityText:
                'Asset default must not replace the version accessibility text',
        },
    })
    expect(response.status()).toBe(201)
    const { upload } = await response.json()
    const path = `/api/projects/${projectId}/media/uploads/${upload.intentId}`
    expect((await page.request.put(path, { data: bytes })).status()).toBe(200)
    const finalized = await page.request.post(`${path}/finalize`)
    expect(finalized.status()).toBe(200)
    return (await finalized.json()).media.asset.id as string
}

async function setup(page: Page) {
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Conflict identity reviewer',
            email: `conflict-identity-${randomUUID()}@example.test`,
            password: 'conflict-identity-password',
        },
    })
    expect(signup.status()).toBe(200)
    const { user } = await signup.json()
    const created = await page.request.post('/api/projects', { data: { name: 'Comparison desk' } })
    expect(created.status()).toBe(201)
    const { project } = await created.json()
    const channelResponse = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Community bulletin' },
    })
    expect(channelResponse.status()).toBe(201)
    const { channel } = await channelResponse.json()
    const tagIds: string[] = []
    for (const name of ['Release', 'Maintenance']) {
        const response = await page.request.post(`/api/projects/${project.id}/tags`, {
            data: { name },
        })
        expect(response.status()).toBe(201)
        tagIds.push((await response.json()).tag.id)
    }
    expect(
        (await page.request.post(`/api/projects/${project.id}/tags/${tagIds[0]}/archive`)).ok()
    ).toBe(true)
    const filenames = ['launch-portrait.jpg', `maintenance-${'diagram'.repeat(12)}.png`]
    const first = await upload(page, project.id, filenames[0]!, true)
    const second = await upload(page, project.id, filenames[1]!, false)
    const endpoint = `/api/projects/${project.id}/publication-composer-draft`
    const base = {
        postTitle: '',
        postContent: 'The same announcement in both draft versions',
        sourceMedia: [],
        publicationTagIds: [],
        publicationTargets: [
            {
                id: randomUUID(),
                channelId: channel.id,
                content: '',
                deliveryMode: 'manual',
                scheduledAt: '',
            },
        ],
        customizedTargetIds: [],
        customizedContentTargetIds: [],
        defaultDeliveryMode: 'manual',
        defaultScheduledAt: '',
        activeContentScopeId: 'shared',
        activePublicationTabId: 'shared',
    }
    const reserved = await page.request.put(endpoint, {
        data: { expectedRevision: 0, expectedUserId: user.id, content: base },
    })
    expect(reserved.status()).toBe(200)
    const { draft } = await reserved.json()
    const local = {
        ...base,
        publicationTagIds: [tagIds[1]!],
        sourceMedia: [
            { assetId: first, accessibilityText: 'Local portrait description' },
            { assetId: second, accessibilityText: '' },
        ],
    }
    const saved = {
        ...base,
        publicationTagIds: [tagIds[0]!],
        sourceMedia: [
            { assetId: second, accessibilityText: 'Saved diagram description' },
            { assetId: first, accessibilityText: 'Saved portrait description' },
        ],
    }
    // The browser knows the previous revision while a competing writer saves another one.
    const changed = await page.request.put(endpoint, {
        data: {
            expectedRevision: draft.revision,
            expectedDraftId: draft.id,
            expectedUserId: user.id,
            content: saved,
        },
    })
    expect(changed.status()).toBe(200)
    const key = `postdot:publication-composer:v1:${encodeURIComponent(project.id)}:user:${encodeURIComponent(user.id)}`
    await page.addInitScript(
        ({ key, recovery }) => {
            sessionStorage.setItem(key, JSON.stringify(recovery))
        },
        {
            key,
            recovery: {
                ...local,
                version: 1,
                savedAt: Date.now(),
                serverDraftId: draft.id,
                serverDraftRevision: draft.revision,
            },
        }
    )
    return {
        projectId: project.id as string,
        endpoint,
        path: `/dashboard/projects/${project.id}/publications/new`,
        key,
        local,
        saved,
        first,
        second,
        filenames,
        tagIds,
    }
}

for (const [locale, copy, theme, choice] of [
    ['en', en, 'dark', 'local'],
    ['fr', fr, 'light', 'saved'],
    ['de', de, 'light', 'local'],
    ['es', es, 'dark', 'saved'],
] as const) {
    test(`compares tag identities, media order and version accessibility text in ${locale}`, async ({
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
        const data = await setup(page)
        await page.goto(data.path)
        const comparison = page.locator('[data-composer-conflict]')
        const local = comparison.getByRole('region', { name: copy.composer_conflict_local })
        const saved = comparison.getByRole('region', { name: copy.composer_conflict_saved })
        await expect(local).toContainText('Maintenance')
        await expect(saved).toContainText(`Release · ${copy.common_archived}`)
        for (const region of [local, saved]) {
            await expect(region).toContainText(data.filenames[0]!)
            await expect(region).toContainText(data.filenames[1]!)
            await expect(region).not.toContainText('Asset default must not replace')
        }
        const localMedia = local.locator('[data-composer-conflict-media]')
        const savedMedia = saved.locator('[data-composer-conflict-media]')
        await expect(localMedia.nth(0)).toContainText('Local portrait description')
        await expect(localMedia.nth(1)).toContainText(copy.composer_conflict_no_accessibility_text)
        await expect(savedMedia.nth(0)).toContainText('Saved diagram description')
        await expect(savedMedia.nth(1)).toContainText('Saved portrait description')
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            expect(await comparison.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(
                false
            )
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath(`identities-${width}.png`) })
        }
        // Optional references distinguish assets even if two files have the same name.
        await localMedia.nth(0).getByText(copy.composer_conflict_reference, { exact: true }).click()
        await expect(localMedia.nth(0)).toContainText(data.first)
        const downloading = page.waitForEvent('download')
        await comparison.getByRole('button', { name: copy.composer_conflict_download }).click()
        const download = await downloading
        const versions = JSON.parse(await readFile((await download.path())!, 'utf8'))
        expect(versions.local).toEqual(data.local)
        expect(versions.saved).toEqual(data.saved)
        await comparison
            .getByRole('button', {
                name:
                    choice === 'local'
                        ? copy.composer_conflict_replace
                        : copy.composer_conflict_use_saved,
            })
            .click()
        await expect(comparison).toHaveCount(0)
        const expected = choice === 'local' ? data.local : data.saved
        await expect
            .poll(async () => {
                const value = await page.evaluate(key => sessionStorage.getItem(key), data.key)
                return value ? JSON.parse(value).sourceMedia : null
            })
            .toEqual(expected.sourceMedia)
        await expect
            .poll(async () => (await (await page.request.get(data.endpoint)).json()).draft.content)
            .toEqual(expected)
    })
}

test('unavailable names preserve references and retry details without refreshing or writing drafts', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const data = await setup(page)
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
        release = resolve
    })
    const mediaMatcher = `**/api/projects/${data.projectId}/media/${data.first}`
    const tagMatcher = `**/api/projects/${data.projectId}/tags*`
    await page.route(mediaMatcher, async route => {
        await gate
        await route.fulfill({
            status: 404,
            json: { error: { code: 'not_found', message: 'Unavailable asset' } },
        })
    })
    await page.route(tagMatcher, route =>
        route.fulfill({
            status: 503,
            json: { error: { code: 'unavailable', message: 'Temporary failure' } },
        })
    )
    let reads = 0
    let writes = 0
    page.on('request', request => {
        if (new URL(request.url()).pathname !== data.endpoint) return
        if (request.method() === 'GET') reads++
        else writes++
    })
    await page.goto(data.path)
    const comparison = page.locator('[data-composer-conflict]')
    const local = comparison.getByRole('region', { name: en.composer_conflict_local })
    await expect(local).toContainText(data.first)
    await expect(local).toContainText(data.tagIds[1]!)
    await expect(local).toContainText('Local portrait description')
    await expect(
        comparison.getByRole('button', { name: en.composer_conflict_use_saved })
    ).toBeEnabled()
    release()
    await expect(local).toContainText(en.composer_conflict_media_unavailable)
    const retry = comparison.getByRole('button', { name: en.composer_conflict_retry_details })
    await expect(retry).toBeEnabled()
    expect(writes).toBe(0)
    const before = reads
    await page.unroute(mediaMatcher)
    await page.unroute(tagMatcher)
    await retry.click()
    await expect(local).toContainText('Maintenance')
    await expect(local).toContainText(data.filenames[0]!)
    await expect(local).toContainText('Local portrait description')
    expect(reads).toBe(before)
    expect(writes).toBe(0)
    await expect(comparison.getByText(en.composer_conflict_details_unavailable)).toHaveCount(0)
})
