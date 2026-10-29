import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

async function accounts(page: Page) {
    await page.goto('/')
    const origin = new URL(page.url()).origin
    const suffix = randomUUID()
    const password = 'account-isolation-password'
    const ownerEmail = `owner-${suffix}@example.test`
    const memberEmail = `member-${suffix}@example.test`
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { name: 'Original author', email: ownerEmail, password },
    })
    expect(signup.status()).toBe(200)
    const owner = (await signup.json()).user as { id: string }
    const made = await page.request.post('/api/projects', {
        data: { name: 'Shared recovery desk' },
    })
    expect(made.status()).toBe(201)
    const { project } = await made.json()
    expect(
        (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: 'Manual destination' },
            })
        ).status()
    ).toBe(201)
    const browser = page.context().browser()!
    const admin = await browser.newContext({ baseURL: origin })
    const member = await browser.newContext({ baseURL: origin })
    expect(
        (
            await admin.request.post('/api/auth/sign-in/email', {
                data: { email: ownerEmail, password },
            })
        ).status()
    ).toBe(200)
    const invited = await admin.request.post(`/api/projects/${project.id}/invitations`, {
        data: { email: memberEmail, role: 'editor' },
    })
    expect(invited.status()).toBe(201)
    const { invitation } = await invited.json()
    const registered = await member.request.post('/api/auth/sign-up/email', {
        data: { name: 'Second author', email: memberEmail, password },
    })
    expect(registered.status()).toBe(200)
    const second = (await registered.json()).user as { id: string }
    expect(
        (
            await member.request.post('/api/auth/organization/accept-invitation', {
                data: { invitationId: invitation.id },
            })
        ).status()
    ).toBe(200)
    return {
        owner,
        second,
        ownerEmail,
        memberEmail,
        password,
        admin,
        member,
        project,
        url: `/dashboard/projects/${project.id}/publications/new?editor=legacy`,
        endpoint: `/api/projects/${project.id}/publication-composer-draft`,
        close: async () => {
            await admin.close()
            await member.close()
        },
    }
}

async function login(page: Page, email: string, password: string) {
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
}

test('separates local recovery for two authors sharing a project and restores the original author', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        const form = page.locator('[data-new-publication-form]')
        await expect(form).not.toHaveAttribute('inert', '')
        const matcher = `**${data.endpoint}*`
        await page.route(matcher, route =>
            route.request().method() === 'PUT'
                ? route.fulfill({
                      status: 503,
                      json: { error: { code: 'unavailable', message: 'Temporary failure' } },
                  })
                : route.continue()
        )
        const refused = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === data.endpoint &&
                response.request().method() === 'PUT'
        )
        await page
            .getByRole('textbox', { name: 'Content', exact: true })
            .fill('Private local text from the original author')
        expect((await refused).status()).toBe(503)
        await page.unroute(matcher)
        await page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await expect(page).toHaveURL(/\/login/)
        await login(page, data.memberEmail, data.password)
        await page.goto(data.url)
        await expect(form).toHaveAttribute('aria-busy', 'false')
        await page.screenshot({ path: info.outputPath('second-author-composer.png') })
        await expect(page.locator('[data-new-publication-recovery]')).toHaveCount(0)
        await expect(page.locator('[data-composer-conflict]')).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue('')
        const saved = page.waitForResponse(
            response =>
                response.url().endsWith(data.endpoint) &&
                response.request().method() === 'PUT' &&
                response.ok()
        )
        await page
            .getByRole('textbox', { name: 'Content', exact: true })
            .fill('Independent text from the second author')
        await saved
        expect((await (await data.admin.request.get(data.endpoint)).json()).draft).toBeNull()
        await page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await expect(page).toHaveURL(/\/login/)
        await login(page, data.ownerEmail, data.password)
        await page.goto(data.url)
        const recovery = page.locator('[data-new-publication-recovery]')
        await expect(recovery).toContainText('Private local text from the original author')
        await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
        await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(
            'Private local text from the original author'
        )
        expect(
            (await (await data.member.request.get(data.endpoint)).json()).draft.content.postContent
        ).toBe('Independent text from the second author')
    } finally {
        await data.close()
    }
})

for (const variant of ['saved', 'unsaved'] as const) {
    test(`a ${variant} tab left on the previous account cannot write into the signed-in account`, async ({
        page,
    }) => {
        test.setTimeout(90_000)

        const data = await accounts(page)
        try {
            await page.goto(data.url)
            const form = page.locator('[data-new-publication-form]')
            await expect(form).not.toHaveAttribute('inert', '')
            const stale = page.getByRole('textbox', { name: 'Content', exact: true })
            if (variant === 'saved') {
                const first = page.waitForResponse(
                    response =>
                        response.url().endsWith(data.endpoint) &&
                        response.request().method() === 'PUT' &&
                        response.ok()
                )
                await stale.fill('Original author text')
                await first
            }

            const other = await page.context().newPage()
            await other.goto('/login')
            await other.request.post('/api/auth/sign-out')
            await other.goto('/login')
            await login(other, data.memberEmail, data.password)

            const refused = page.waitForResponse(
                response =>
                    response.url().endsWith(data.endpoint) && response.request().method() === 'PUT'
            )
            await stale.fill('Original author text, continued after the account changed')
            const response = await refused
            expect(response.status()).toBe(409)
            await expect(page.getByText('Your account changed in another tab')).toBeVisible()
            await expect(
                page.getByRole('button', { name: 'Reload page', exact: true })
            ).toBeVisible()
            expect((await (await data.member.request.get(data.endpoint)).json()).draft).toBeNull()
            const current = await other.request.get(data.endpoint)
            expect((await current.json()).draft).toBeNull()
            await other.close()
        } finally {
            await data.close()
        }
    })
}

test('keeps local text and refuses server writes after project access is withdrawn', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const data = await accounts(page)
    try {
        const memberPage = await data.member.newPage()
        await memberPage.goto(data.url)
        await expect(memberPage.locator('[data-new-publication-form]')).not.toHaveAttribute(
            'inert',
            ''
        )
        const members = await data.admin.request.get(`/api/projects/${data.project.id}/members`)
        expect(members.status()).toBe(200)
        const membership = (
            (await members.json()).members as { id: string; userId: string }[]
        ).find(item => item.userId === data.second.id)
        expect(membership).toBeDefined()
        expect(
            (
                await data.admin.request.delete(
                    `/api/projects/${data.project.id}/members/${membership!.id}`
                )
            ).status()
        ).toBe(200)

        const refused = memberPage.waitForResponse(
            response =>
                response.url().endsWith(data.endpoint) && response.request().method() === 'PUT'
        )
        const content = memberPage.getByRole('textbox', { name: 'Content', exact: true })
        await content.fill('Text typed after access was withdrawn')
        expect([403, 404]).toContain((await refused).status())
        await expect(content).toHaveValue('Text typed after access was withdrawn')
        expect((await (await data.admin.request.get(data.endpoint)).json()).draft).toBeNull()
        const stored = await memberPage.evaluate(
            prefix =>
                Object.keys(localStorage)
                    .filter(key => key.startsWith(prefix))
                    .map(key => localStorage.getItem(key)),
            `postdot:publication-composer:v1:${encodeURIComponent(data.project.id)}:user:${encodeURIComponent(data.second.id)}`
        )
        expect(stored).toHaveLength(1)
        expect(stored[0]).toContain('Text typed after access was withdrawn')
    } finally {
        await data.close()
    }
})

test('a tab left on the previous account cannot create a publication for the signed-in account', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        const saved = page.waitForResponse(
            response =>
                response.url().endsWith(data.endpoint) &&
                response.request().method() === 'PUT' &&
                response.ok()
        )
        await page
            .getByRole('textbox', { name: 'Content', exact: true })
            .fill('Text from the original author')
        await saved

        const other = await page.context().newPage()
        await other.goto('/login')
        await other.request.post('/api/auth/sign-out')
        await other.goto('/login')
        await login(other, data.memberEmail, data.password)

        const created = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/projects/${data.project.id}/posts` &&
                response.request().method() === 'POST'
        )
        await page.getByRole('button', { name: 'Create draft', exact: true }).click()
        expect((await created).status()).toBe(409)
        await expect(page).toHaveURL(/\/publications\/new/)
        await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(
            'Text from the original author'
        )
        const listed = await other.request.get(`/api/projects/${data.project.id}/publications`)
        expect(listed.status()).toBe(200)
        expect((await listed.json()).publications).toHaveLength(0)
        await other.close()
    } finally {
        await data.close()
    }
})

test('a conflict comparison in a tab on the previous account never shows the signed-in account draft', async ({
    page,
}) => {
    test.setTimeout(90_000)
    const data = await accounts(page)
    try {
        await page.goto(data.url)
        await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
        const content = page.getByRole('textbox', { name: 'Content', exact: true })
        const saved = page.waitForResponse(
            response =>
                response.url().endsWith(data.endpoint) &&
                response.request().method() === 'PUT' &&
                response.ok()
        )
        await content.fill('Original author text')
        await saved
        const first = (await (await page.request.get(data.endpoint)).json()).draft
        // A newer save from the same author makes this tab's next autosave a real conflict.
        expect(
            (
                await page.request.put(data.endpoint, {
                    data: {
                        expectedRevision: first.revision,
                        expectedDraftId: first.id,
                        content: { ...first.content, postContent: 'Newer text from another tab' },
                    },
                })
            ).status()
        ).toBe(200)
        await content.fill('Original author text, edited again')
        await expect(page.getByText('This draft changed in another tab')).toBeVisible()

        const other = await page.context().newPage()
        await other.goto('/login')
        await other.request.post('/api/auth/sign-out')
        await other.goto('/login')
        await login(other, data.memberEmail, data.password)
        const secret = 'Second author private draft'
        const own = (await (await other.request.get(data.endpoint)).json()).draft
        expect(own).toBeNull()
        expect(
            (
                await other.request.put(data.endpoint, {
                    data: {
                        expectedRevision: 0,
                        content: { ...first.content, postContent: secret },
                    },
                })
            ).status()
        ).toBe(200)

        await page.getByRole('button', { name: 'Compare versions', exact: true }).click()
        await expect(page.getByText('Your account changed in another tab')).toBeVisible()
        await expect(page.getByText(secret)).toHaveCount(0)
        await expect(page.getByRole('button', { name: /use .*version|replace/i })).toHaveCount(0)
        await other.close()
    } finally {
        await data.close()
    }
})

test('keeps a pending local recovery when discard detects an account change', async ({
    page,
}, info) => {
    test.setTimeout(90_000)
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
        await content.fill('Earlier server recovery')
        await saved
        const matcher = `**${data.endpoint}*`
        await page.route(matcher, route =>
            route.request().method() === 'PUT'
                ? route.fulfill({
                      status: 503,
                      json: { error: { code: 'unavailable', message: 'Temporary failure' } },
                  })
                : route.continue()
        )
        const refusedSave = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === data.endpoint &&
                response.request().method() === 'PUT'
        )
        const local = 'Latest text exists only in the original author browser copy'
        await content.fill(local)
        expect((await refusedSave).status()).toBe(503)
        await page.unroute(matcher)
        await page.reload()
        const recovery = page.locator('[data-new-publication-recovery]')
        await expect(recovery).toContainText(local)
        await expect(recovery.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled()
        // Cookie changes are shared with this tab; the pending recovery still belongs to A.
        const other = await page.context().newPage()
        await other.request.post('/api/auth/sign-out')
        await other.goto('/login')
        await login(other, data.memberEmail, data.password)
        const refusedDiscard = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === data.endpoint &&
                response.request().method() === 'DELETE'
        )
        await recovery.getByRole('button', { name: 'Discard', exact: true }).click()
        expect((await refusedDiscard).status()).toBe(409)
        await expect(page.getByText('Your account changed in another tab')).toBeVisible()
        await expect(form).toHaveAttribute('inert', '')
        // Capture the settled channel rail after the recovery dialog changes page geometry.
        await expect(page.locator('[data-channel-selected]')).toHaveCSS('transform', 'none')
        await page.screenshot({ path: info.outputPath('account-changed-desktop.png') })
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(page.locator('[data-channel-selected]')).toHaveCSS('transform', 'none')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        )
        await page.screenshot({ path: info.outputPath('account-changed-mobile.png') })
        const key = `postdot:publication-composer:v1:${encodeURIComponent(data.project.id)}:user:${encodeURIComponent(data.owner.id)}`
        await expect
            .poll(() =>
                page.evaluate(key => [localStorage.getItem(key), sessionStorage.getItem(key)], key)
            )
            .toEqual([expect.stringContaining(local), expect.stringContaining(local)])
        expect((await (await data.member.request.get(data.endpoint)).json()).draft).toBeNull()
        await other.request.post('/api/auth/sign-out')
        await page.goto('/login')
        await login(page, data.ownerEmail, data.password)
        await page.goto(data.url)
        await expect(recovery).toContainText(local)
        await recovery.getByRole('button', { name: 'Restore', exact: true }).click()
        await expect(content).toHaveValue(local)
        await other.close()
    } finally {
        await data.close()
    }
})
