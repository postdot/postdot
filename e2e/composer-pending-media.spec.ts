// cspell:words filechooser
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }
import fr from '../apps/web/messages/fr.json' with { type: 'json' }
import { accounts } from './composer-account-fixture'
import { file, waitForStoredUpload } from './media-upload-fixture'

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    for (const phase of ['raw', 'finalize'] as const) {
        test(`keeps creation blocked during ${phase} in ${locale} until media is attached`, async ({
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
            let release: () => void = () => {}
            try {
                await page.goto(locale === 'fr' ? data.url.replace('?editor=legacy', '') : data.url)
                const form = page.locator('[data-new-publication-form]')
                await expect(form).not.toHaveAttribute('inert', '')
                const saved = page.waitForResponse(
                    response =>
                        new URL(response.url()).pathname === data.endpoint &&
                        response.request().method() === 'PUT' &&
                        response.ok()
                )
                await page
                    .getByRole('textbox', {
                        name: copy.publication_new_source_content,
                        exact: true,
                    })
                    .fill('Include my chosen image')
                await saved
                const held = (method: string, url: string) =>
                    phase === 'raw'
                        ? method === 'PUT'
                        : method === 'POST' && new URL(url).pathname.endsWith('/finalize')
                const gate = new Promise<void>(resolve => {
                    release = resolve
                })
                await page.route(
                    `**/api/projects/${data.project.id}/media/uploads/**`,
                    async route => {
                        if (held(route.request().method(), route.request().url())) await gate
                        await route.continue()
                    }
                )
                const started = page.waitForRequest(
                    request =>
                        request.url().includes('/media/uploads/') &&
                        held(request.method(), request.url())
                )
                let creations = 0
                page.on('request', request => {
                    if (
                        new URL(request.url()).pathname ===
                            `/api/projects/${data.project.id}/posts` &&
                        request.method() === 'POST'
                    )
                        creations++
                })
                await page.locator('input[type=file]').setInputFiles(file)
                await started
                const create = page.getByRole('button', {
                    name: copy.publication_new_create_draft,
                    exact: true,
                })
                await expect(create).toBeDisabled()
                await expect(form.locator('button[value=schedule]')).toBeDisabled()
                await expect(create).toHaveAccessibleDescription(
                    copy.publication_new_media_preparation_pending
                )
                await submitWithoutButton(page)
                expect(creations).toBe(0)
                await expect(page).toHaveURL(/\/publications\/new/)
                if (phase === 'raw') {
                    await page.setViewportSize({ width: 390, height: 844 })
                    await page
                        .getByText(copy.publication_new_media_preparation_pending, { exact: true })
                        .scrollIntoViewIfNeeded()
                    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
                    expect(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth
                        )
                    ).toBe(true)
                    await page.screenshot({ path: info.outputPath('creation-waits-for-media.png') })
                }
                release()
                await expect(
                    page.getByRole('button', {
                        name: copy.media_remove.replace('{filename}', file.name),
                        exact: true,
                    })
                ).toBeVisible()
                await expect(create).toBeEnabled()
                const created = page.waitForResponse(
                    response =>
                        new URL(response.url()).pathname ===
                            `/api/projects/${data.project.id}/posts` &&
                        response.request().method() === 'POST'
                )
                await create.click()
                const response = await created
                expect(response.status()).toBe(201)
                const requested = response.request().postDataJSON().sourceContent.media
                expect(requested).toHaveLength(1)
                const { post } = await response.json()
                expect(
                    (
                        await (
                            await page.request.get(
                                `/api/projects/${data.project.id}/posts/${post.id}`
                            )
                        ).json()
                    ).post.sourceContent.media
                ).toEqual(requested)
                expect(creations).toBe(1)
            } finally {
                release()
                await data.close()
            }
        })
    }
}

for (const recovered of [false, true]) {
    test(`a ${recovered ? 'recovered' : 'failed'} file needs a choice before text-only creation`, async ({
        page,
    }) => {
        const data = await accounts(page)
        try {
            await page.goto(data.url)
            const form = page.locator('[data-new-publication-form]')
            await expect(form).not.toHaveAttribute('inert', '')
            await page
                .getByRole('textbox', { name: 'Content', exact: true })
                .fill('Create without the file only after my choice')
            await page.route(`**/api/projects/${data.project.id}/media/uploads/**`, route =>
                route.request().method() === 'PUT' ? route.abort('failed') : route.continue()
            )
            await page.locator('input[type=file]').setInputFiles(file)
            await expect(
                page.getByRole('button', { name: `Retry upload ${file.name}`, exact: true })
            ).toBeVisible()
            if (recovered) {
                await waitForStoredUpload(page, data.owner.id)
                await page.getByRole('link', { name: 'Channels', exact: true }).click()
                await expect(
                    page.getByRole('heading', { name: 'Channels', exact: true })
                ).toBeVisible()
                await page.getByRole('link', { name: 'New publication', exact: true }).click()
                await expect(page.locator('[data-media-upload-recovery]')).toBeVisible()
            }
            const create = page.getByRole('button', { name: 'Create draft', exact: true })
            await expect(create).toBeDisabled()
            if (recovered)
                await page
                    .locator('[data-media-upload-recovery]')
                    .getByRole('button', { name: 'Dismiss', exact: true })
                    .click()
            else
                await page
                    .getByRole('button', { name: `Cancel upload ${file.name}`, exact: true })
                    .click()
            await expect(create).toBeEnabled()
            const created = page.waitForResponse(
                response =>
                    new URL(response.url()).pathname === `/api/projects/${data.project.id}/posts` &&
                    response.request().method() === 'POST'
            )
            await create.click()
            const response = await created
            expect(response.status()).toBe(201)
            expect(response.request().postDataJSON().sourceContent.media).toEqual([])
        } finally {
            await data.close()
        }
    })
}

async function submitWithoutButton(page: Page) {
    await page.locator('[data-new-publication-form]').evaluate(async form => {
        const submitter = form.querySelector('button[value=draft]')
        if (!(submitter instanceof HTMLButtonElement)) throw new Error('Missing draft submitter')
        form.dispatchEvent(
            new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter })
        )
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
}

for (const resolution of ['dismiss', 'reselect'] as const) {
    test(`missing recovered bytes remain a choice until ${resolution} after the available file resumes`, async ({
        page,
    }) => {
        const data = await accounts(page)
        const available = { ...file, name: 'available-pixel.png' }
        try {
            await page.goto(data.url)
            await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute(
                'inert',
                ''
            )
            await page
                .getByRole('textbox', { name: 'Content', exact: true })
                .fill('Keep both file choices visible')
            let cut = true
            await page.route(`**/api/projects/${data.project.id}/media/uploads/**`, route =>
                route.request().method() === 'PUT' && cut ? route.abort('failed') : route.continue()
            )
            await page.locator('input[type=file]').setInputFiles([file, available])
            await expect(
                page.getByRole('button', { name: `Retry upload ${available.name}`, exact: true })
            ).toBeVisible()
            await waitForStoredUpload(page, data.owner.id)
            await page.evaluate(
                async ({ owner, filename }) => {
                    const db = await new Promise<IDBDatabase>((resolve, reject) => {
                        const request = indexedDB.open('uppy-blobs')
                        request.onsuccess = () => resolve(request.result)
                        request.onerror = () => reject(request.error)
                    })
                    try {
                        const records = await new Promise<Array<{ id: string; metadata: string }>>(
                            (resolve, reject) => {
                                const request = db
                                    .transaction('metadata')
                                    .objectStore('metadata')
                                    .getAll()
                                request.onsuccess = () => resolve(request.result)
                                request.onerror = () => reject(request.error)
                            }
                        )
                        const record = records.find(item => item.id.includes(owner))
                        if (!record) throw new Error('Missing recovery metadata')
                        const files = Object.values(JSON.parse(record.metadata).files) as {
                            id: string
                            name: string
                        }[]
                        const missing = files.find(item => item.name === filename)
                        if (!missing) throw new Error('Missing selected file')
                        await new Promise<void>((resolve, reject) => {
                            const transaction = db.transaction('files', 'readwrite')
                            const store = transaction.objectStore('files')
                            const request = store.getAll()
                            request.onsuccess = () => {
                                for (const item of request.result)
                                    if (
                                        item.fileID === missing.id &&
                                        String(item.id).includes(owner)
                                    )
                                        store.delete(item.id)
                            }
                            transaction.oncomplete = () => resolve()
                            transaction.onerror = () => reject(transaction.error)
                        })
                    } finally {
                        db.close()
                    }
                },
                { owner: data.owner.id, filename: file.name }
            )
            await page.getByRole('link', { name: 'Channels', exact: true }).click()
            await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
            await page.getByRole('link', { name: 'New publication', exact: true }).click()
            const recovery = page.locator('[data-media-upload-recovery]')
            await expect(recovery).toContainText('1 file must be selected again.')
            cut = false
            await recovery.getByRole('button', { name: 'Resume', exact: true }).click()
            await expect(
                page.getByRole('button', { name: `Remove ${available.name}`, exact: true })
            ).toBeVisible()
            const create = page.getByRole('button', { name: 'Create draft', exact: true })
            await expect(create).toBeDisabled()
            await expect(recovery).toContainText('1 file must be selected again.')
            const chooser = page.waitForEvent('filechooser')
            await recovery.getByRole('button', { name: 'Select again', exact: true }).click()
            await (await chooser).setFiles([])
            await expect(create).toBeDisabled()
            await expect(recovery).toBeVisible()
            if (resolution === 'dismiss') {
                await recovery.getByRole('button', { name: 'Dismiss', exact: true }).click()
            } else {
                const replacement = page.waitForEvent('filechooser')
                await recovery.getByRole('button', { name: 'Select again', exact: true }).click()
                await (await replacement).setFiles(file)
                await expect(
                    page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
                ).toBeVisible()
            }
            await expect(create).toBeEnabled()
            const created = page.waitForResponse(
                response =>
                    new URL(response.url()).pathname === `/api/projects/${data.project.id}/posts` &&
                    response.request().method() === 'POST'
            )
            await create.click()
            const response = await created
            expect(response.status()).toBe(201)
            expect(response.request().postDataJSON().sourceContent.media).toHaveLength(
                resolution === 'dismiss' ? 1 : 2
            )
        } finally {
            await data.close()
        }
    })
}

test('creation waiting for autosave uses the media that finished during that wait', async ({
    page,
}) => {
    const data = await accounts(page)
    let release: () => void = () => {}
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        const gate = new Promise<void>(resolve => {
            release = resolve
        })
        await page.route(`**${data.endpoint}*`, async route => {
            if (route.request().method() === 'PUT') await gate
            await route.continue()
        })
        const saving = page.waitForRequest(
            request =>
                new URL(request.url()).pathname === data.endpoint && request.method() === 'PUT'
        )
        await page
            .getByRole('textbox', { name: 'Content', exact: true })
            .fill('Include the attachment that completes while saving')
        await saving
        const created = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/projects/${data.project.id}/posts` &&
                response.request().method() === 'POST'
        )
        await page.getByRole('button', { name: 'Create draft', exact: true }).click()
        await page.locator('input[type=file]').setInputFiles(file)
        await expect(
            page.getByRole('button', { name: `Remove ${file.name}`, exact: true })
        ).toBeVisible()
        release()
        const response = await created
        expect(response.status()).toBe(201)
        expect(response.request().postDataJSON().sourceContent.media).toHaveLength(1)
    } finally {
        release()
        await data.close()
    }
})
