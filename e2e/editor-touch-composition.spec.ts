import { expect, test } from '@playwright/test'

// Chromium composition and touch emulation do not replace physical-device checks.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

test('preserves committed composition and insertion focus across touch scope changes', async ({
    page,
}) => {
    await page.goto('/editor-lab')
    const content = page.getByRole('textbox', { name: 'Test content', exact: true })
    const output = page.getByRole('textbox', { name: /^Serialized output/ })
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
    await expect(output).toHaveValue('Bonjour 日本')
    await content.press('End')
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).tap()
    await page.getByRole('searchbox', { name: 'Search emojis' }).fill('grinning face')
    await page.locator('[frimousse-emoji]').filter({ hasText: '😀' }).first().tap()
    await expect(output).toHaveValue('Bonjour 日本😀')
    await expect(content).toBeFocused()
    await page.getByRole('button', { name: 'Discord', exact: true }).tap()
    await content.fill('Adaptation 日本')
    await expect(output).toHaveValue('**Adaptation 日本**')
    await page.getByRole('button', { name: 'Plain text', exact: true }).tap()
    await expect(output).toHaveValue('Bonjour 日本😀')
    await page.getByRole('button', { name: 'Discord', exact: true }).tap()
    await expect(output).toHaveValue('**Adaptation 日本**')
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
})
