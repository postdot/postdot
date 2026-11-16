import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

// Chromium composition and touch emulation do not replace physical-device checks.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

test('preserves committed composition and insertion focus across touch scope changes', async ({
    page,
}) => {
    // Exercise the shipped composer: /editor-lab is intentionally development-only.
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            name: 'Touch composition reviewer',
            email: `touch-${randomUUID()}@example.test`,
            password: 'touch-composition-password',
        },
    })
    expect(signup.status()).toBe(200)
    const created = await page.request.post('/api/projects', {
        data: { name: 'Touch composition' },
    })
    expect(created.status()).toBe(201)
    const { project } = await created.json()
    const channel = await page.request.post(`/api/projects/${project.id}/channels`, {
        data: { name: 'Discord', profile: 'discord' },
    })
    expect(channel.status()).toBe(201)
    const draftPath = `/api/projects/${project.id}/publication-composer-draft`
    const savedContent = async () =>
        (await (await page.request.get(draftPath)).json()).draft?.content
    await page.goto(`/dashboard/projects/${project.id}/publications/new`)
    await expect(page.locator('[data-new-publication-form]')).not.toHaveAttribute('inert', '')
    const content = page.getByRole('textbox', { name: 'Content', exact: true })
    const adaptation = page.getByRole('textbox', { name: 'Channel content', exact: true })
    await content.fill('Bonjour ')
    await content.tap()
    await content.press('End')
    const session = await page.context().newCDPSession(page)
    try {
        await session.send('Input.imeSetComposition', {
            text: '日本',
            selectionStart: 2,
            selectionEnd: 2,
        })
        await session.send('Input.insertText', { text: '日本' })
    } finally {
        await session.detach()
    }
    await expect(content).toHaveText('Bonjour 日本')
    await expect.poll(async () => (await savedContent())?.postContent).toBe('Bonjour 日本')
    await content.press('End')
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).tap()
    await page.getByRole('searchbox', { name: 'Search emojis' }).fill('grinning face')
    await page.locator('[frimousse-emoji]').filter({ hasText: '😀' }).first().tap()
    await expect(content).toHaveText('Bonjour 日本😀')
    await expect.poll(async () => (await savedContent())?.postContent).toBe('Bonjour 日本😀')
    await expect(content).toBeFocused()
    await page.getByRole('button', { name: 'Discord', exact: true }).tap()
    await adaptation.fill('Adaptation 日本')
    await adaptation.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Bold', exact: true }).tap()
    await expect(adaptation.locator('strong')).toHaveText('Adaptation 日本')
    await expect
        .poll(async () => (await savedContent())?.publicationTargets[0].content)
        .toBe('**Adaptation 日本**')
    await page.getByRole('button', { name: 'All channels', exact: true }).tap()
    await expect(content).toHaveText('Bonjour 日本😀')
    await expect.poll(async () => (await savedContent())?.postContent).toBe('Bonjour 日本😀')
    await page.getByRole('button', { name: 'Discord', exact: true }).tap()
    await expect(adaptation.locator('strong')).toHaveText('Adaptation 日本')
    await expect
        .poll(async () => (await savedContent())?.publicationTargets[0].content)
        .toBe('**Adaptation 日本**')
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
})
