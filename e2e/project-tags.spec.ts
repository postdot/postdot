import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { frenchTranslation } from './locale'

async function createProject(page: Page) {
    const suffix = randomUUID().slice(0, 8)
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Tag workflow operator',
            email: `tags-${suffix}@postbot.local`,
            password: 'tags-local-fixture-password',
        },
    })
    expect(signup.status()).toBe(200)
    const response = await page.request.post('/api/projects', {
        data: { name: `Tag workflow ${suffix}`, timeZone: 'UTC' },
    })
    expect(response.status()).toBe(201)
    const { project } = (await response.json()) as { project: { id: string } }
    return project.id
}

test('creates tags without losing composition and synchronizes archived assignments', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const projectId = await createProject(page)
    const channel = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Community updates', profile: 'manual-message' },
    })
    expect(channel.status()).toBe(201)
    await page.goto(`/dashboard/projects/${projectId}/publications/new`)
    await page.getByRole('textbox', { name: 'Optional title', exact: true }).fill('Release notes')
    const content = page.getByRole('textbox', { name: 'Content', exact: true })
    await content.fill('Composition must survive tag creation.')
    await page.getByRole('button', { name: 'Select tags', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Create tag', exact: true }).click()
    await page.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Launch')
    await page.getByRole('button', { name: 'Create and select', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(content).toHaveText('Composition must survive tag creation.')
    await expect(page.getByRole('textbox', { name: 'Optional title', exact: true })).toHaveValue(
        'Release notes'
    )
    const picker = page.getByRole('button', { name: '1 tags selected', exact: true })
    await expect(picker).toBeVisible()
    await page.bringToFront()
    await picker.click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Launch', exact: true })).toBeChecked()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/posts/`))
    const publications = await page.request.get(`/api/projects/${projectId}/publications`)
    const { publications: entries } = (await publications.json()) as {
        publications: { id: string }[]
    }
    expect(entries).toHaveLength(1)
    await page.goto(`/dashboard/projects/${projectId}/publications/${entries[0]!.id}`)
    const source = page.getByRole('textbox', { name: 'Body', exact: true })
    await source.fill('Unsaved editor changes stay intact.')

    const manager = await page.context().newPage()
    try {
        await manager.goto(`/dashboard/projects/${projectId}/tags`)
        await manager.getByRole('button', { name: 'Manage Launch', exact: true }).click()
        await manager.getByRole('menuitem', { name: 'Rename', exact: true }).click()
        await manager.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Release')
        await manager.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(manager.getByRole('dialog')).toHaveCount(0)
        await page.bringToFront()
        await picker.click()
        await expect(
            page.getByRole('menuitemcheckbox', { name: 'Release', exact: true })
        ).toBeChecked()
        await page.keyboard.press('Escape')
        await expect(source).toHaveText('Unsaved editor changes stay intact.')

        await manager.bringToFront()
        await manager.getByRole('button', { name: 'Manage Release', exact: true }).click()
        await manager.getByRole('menuitem', { name: 'Archive', exact: true }).click()
        await expect(
            manager.getByRole('heading', { name: 'Archived tags', exact: true })
        ).toBeVisible()
        await page.bringToFront()
        await picker.click()
        const archived = page.getByRole('menuitemcheckbox', {
            name: 'Release · Archived',
            exact: true,
        })
        await expect(archived).toBeChecked()
        await archived.click()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Select tags', exact: true }).click()
        await expect(archived).toHaveCount(0)
        await page.getByRole('menu').press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await manager.bringToFront()
        await manager.getByRole('button', { name: 'Manage Release', exact: true }).click()
        await Promise.all([
            page.waitForResponse(
                response =>
                    response.request().method() === 'GET' &&
                    response.url().includes(`/api/projects/${projectId}/tags?`) &&
                    response.ok()
            ),
            manager.getByRole('menuitem', { name: 'Restore', exact: true }).click(),
        ])
        await expect(
            manager.getByRole('heading', { name: 'Archived tags', exact: true })
        ).toHaveCount(0)
        await page.getByRole('button', { name: 'Select tags', exact: true }).click()
        await expect(
            page.getByRole('menuitemcheckbox', { name: 'Release', exact: true })
        ).toBeEnabled()
        await expect(source).toHaveText('Unsaved editor changes stay intact.')
    } finally {
        await manager.close()
    }
})

test('keeps duplicate input and provides a narrow localized tag manager', async ({ page }) => {
    const projectId = await createProject(page)
    await page.goto(`/dashboard/projects/${projectId}/tags`)
    await expect(page.getByText('No tags yet', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Create tag', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Launch')
    await page.getByRole('dialog').getByRole('button', { name: 'Create tag', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Create tag', exact: true }).click()
    await page.getByRole('textbox', { name: 'Tag name', exact: true }).fill('  LAUNCH  ')
    await page.getByRole('dialog').getByRole('button', { name: 'Create tag', exact: true }).click()
    await expect(
        page.getByText('A tag with this name already exists, including in archived tags.', {
            exact: true,
        })
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Tag name', exact: true })).toHaveValue(
        '  LAUNCH  '
    )
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(
        page.getByRole('heading', { name: frenchTranslation('project_tags_title'), exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('button', { name: frenchTranslation('project_tags_create'), exact: true })
    ).toBeVisible()
    const widths = await page.locator('[data-dashboard-scroll]').evaluate(element => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
    }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
})

test('recovers catalog and mutation failures without clearing the entered name', async ({
    page,
}) => {
    const projectId = await createProject(page)
    let failCatalog = true
    let failMutation = false
    let initialCatalogRecovery = true
    await page.route(`**/api/projects/${projectId}/tags*`, async route => {
        const request = route.request()
        const isCatalog =
            request.method() === 'GET' && new URL(request.url()).searchParams.has('includeArchived')
        if (isCatalog && failCatalog && initialCatalogRecovery) {
            const retryActivated = await page.evaluate(() =>
                document.documentElement.hasAttribute('data-e2e-catalog-retry')
            )
            if (retryActivated) failCatalog = false
        }
        if (
            (request.method() === 'GET' &&
                new URL(request.url()).searchParams.has('includeArchived') &&
                failCatalog) ||
            (request.method() === 'POST' && failMutation)
        ) {
            await route.fulfill({
                status: 503,
                json: { error: { code: 'unavailable', message: 'Temporarily unavailable' } },
            })
        } else {
            await route.continue()
        }
    })
    await page.goto(`/dashboard/projects/${projectId}/tags`)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
        timeout: 15_000,
    })
    // Keep the simulated outage until activation: background refetch must not
    // recover and remove Retry before the test can exercise the actual control.
    await page.evaluate(() => {
        document.addEventListener(
            'click',
            () => document.documentElement.setAttribute('data-e2e-catalog-retry', ''),
            { capture: true, once: true }
        )
    })
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('No tags yet', { exact: true })).toBeVisible()
    initialCatalogRecovery = false
    await page.getByRole('button', { name: 'Create tag', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Retry me')
    failMutation = true
    await page.getByRole('dialog').getByRole('button', { name: 'Create tag', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Tag name', exact: true })).toHaveAttribute(
        'aria-invalid',
        'true'
    )
    await expect(page.getByRole('textbox', { name: 'Tag name', exact: true })).toHaveValue(
        'Retry me'
    )
    failMutation = false
    failCatalog = true
    await page.getByRole('dialog').getByRole('button', { name: 'Create tag', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Manage Retry me', exact: true })).toBeVisible()
    const response = await page.request.get(`/api/projects/${projectId}/tags`)
    expect((await response.json()).tags).toHaveLength(1)
})

test('exposes tags read-only to a viewer and rejects foreign project assignments', async ({
    page,
}) => {
    test.setTimeout(60_000)
    const projectId = await createProject(page)
    const created = await page.request.post(`/api/projects/${projectId}/tags`, {
        data: { name: 'Owner tag' },
    })
    expect(created.status()).toBe(201)
    const other = await page.request.post('/api/projects', {
        data: { name: 'Other project', timeZone: 'UTC' },
    })
    const { project: foreignProject } = await other.json()
    const foreign = await page.request.post(`/api/projects/${foreignProject.id}/tags`, {
        data: { name: 'Foreign tag' },
    })
    const { tag: foreignTag } = await foreign.json()
    const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
        data: { name: 'Manual', profile: 'manual-message' },
    })
    const { channel } = await channelResponse.json()
    const postResponse = await page.request.post(`/api/projects/${projectId}/posts`, {
        data: {
            sourceContent: { body: { format: 'plain_text', text: 'Project boundary' }, media: [] },
            publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
        },
    })
    expect(postResponse.status()).toBe(201)
    const { publications } = await postResponse.json()
    const rejected = await page.request.put(
        `/api/projects/${projectId}/publications/${publications[0].id}/tags`,
        { data: { tagIds: [foreignTag.id] } }
    )
    expect(rejected.status()).toBe(400)

    const email = `tag-viewer-${randomUUID().slice(0, 8)}@postbot.local`
    const invited = await page.request.post(`/api/projects/${projectId}/invitations`, {
        data: { email, role: 'viewer' },
    })
    expect(invited.status()).toBe(201)
    const { invitation } = await invited.json()
    const browser = page.context().browser()
    if (browser === null) throw new Error('Missing test browser')
    const context = await browser.newContext()
    try {
        const viewer = await context.newPage()
        await viewer.goto(
            `/invite?invitationId=${invitation.id}&organizationId=${invitation.organizationId}&projectId=${projectId}`
        )
        await viewer.getByRole('button', { name: 'Create an account instead' }).click()
        await viewer.getByLabel('Name', { exact: true }).fill('Tag viewer')
        await viewer.getByLabel('Email', { exact: true }).fill(email)
        await viewer.getByLabel('Password', { exact: true }).fill('tag-viewer-fixture-password')
        await viewer.getByRole('button', { name: 'Create account', exact: true }).click()
        await viewer.getByRole('button', { name: 'Join project', exact: true }).click()
        await expect(viewer).toHaveURL(/\/overview$/)
        await viewer.goto(`/dashboard/projects/${projectId}/tags`)
        await expect(viewer.getByText('Owner tag', { exact: true })).toBeVisible()
        await expect(viewer.getByRole('button', { name: 'Create tag', exact: true })).toHaveCount(0)
        await expect(
            viewer.getByRole('button', { name: 'Manage Owner tag', exact: true })
        ).toHaveCount(0)
        await expect(viewer.getByText('Foreign tag', { exact: true })).toHaveCount(0)
        const denied = await viewer.request.post(`/api/projects/${projectId}/tags`, {
            data: { name: 'Forbidden' },
        })
        expect(denied.status()).toBe(403)
    } finally {
        await context.close()
    }
})
