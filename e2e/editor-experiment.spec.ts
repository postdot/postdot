import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('keeps the original text unchanged and restores isolated editing scopes', async ({ page }) => {
    await page.goto('/editor-lab')
    const output = page.getByRole('textbox', { name: /^Serialized output/ })
    const original = await output.inputValue()
    expect(original).toBe('Hello 👋\n\n**This stays literal.**\nhttps://example.com\n')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Restore test snapshot' }).click()
    await expect(output).toHaveValue(original)

    const content = page.getByRole('textbox', { name: 'Test content', exact: true })
    await content.fill('Shared copy')
    await page.getByRole('button', { name: 'Discord', exact: true }).click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await page.getByRole('textbox', { name: 'Source text', exact: true }).fill('Destination copy')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await content.press('Control+a')
    await page.getByRole('button', { name: 'Underline', exact: true }).click()
    await expect(output).toHaveValue('__Destination copy__')
    await page.getByRole('button', { name: 'Plain text', exact: true }).click()
    await expect(content).toHaveText('Shared copy')
    await page.getByRole('button', { name: 'Discord', exact: true }).click()
    await content.press('Control+z')
    await expect(output).toHaveValue('Destination copy')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Restore test snapshot' }).click()
    await expect(output).toHaveValue('Shared copy')
    await page.getByRole('button', { name: 'Discord', exact: true }).click()
    await expect(output).toHaveValue('Destination copy')
})

test('restricts paste and keyboard formatting and protects unsupported source syntax', async ({
    page,
}) => {
    await page.goto('/editor-lab')
    const content = page.getByRole('textbox', { name: 'Test content', exact: true })
    const output = page.getByRole('textbox', { name: /^Serialized output/ })
    await content.fill('Literal')
    await content.press('Control+a')
    await content.press('Control+b')
    await content.evaluate(element => {
        const clipboardData = new DataTransfer()
        clipboardData.setData('text/html', '<h2>Heading</h2><p><strong>Bold</strong></p>')
        clipboardData.setData('text/plain', 'Heading\nBold')
        element.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
        )
    })
    await expect(content.locator('strong, h2')).toHaveCount(0)
    await expect(output).toHaveValue('Heading\nBold')

    await page.getByRole('button', { name: 'DEV.to', exact: true }).click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const raw = page.getByRole('textbox', { name: 'Source text', exact: true })
    const unsupported =
        '![Original image](https://example.com/image.png)\n\n<table><tr><td>Keep me</td></tr></table>'
    await raw.fill(unsupported)
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toBeDisabled()
    await expect(output).toHaveValue(unsupported)
    await raw.press('Control+End')
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Search emojis', exact: true }).fill('grinning face')
    await page.locator('[frimousse-emoji]').filter({ hasText: '😀' }).first().click()
    await expect(raw).toHaveValue(`${unsupported}😀`)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Restore test snapshot' }).click()
    await page.getByRole('button', { name: 'DEV.to', exact: true }).click()
    await expect(raw).toHaveValue(`${unsupported}😀`)
})

test('supports rich editing and emoji undo at desktop and mobile widths', async ({
    page,
}, info) => {
    await page.goto('/editor-lab')
    await page.getByRole('button', { name: 'DEV.to', exact: true }).click()
    const content = page.getByRole('textbox', { name: 'Test content', exact: true })
    const output = page.getByRole('textbox', { name: /^Serialized output/ })
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await page.getByRole('textbox', { name: 'Source text', exact: true }).fill('Article')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await content.press('Control+a')
    await page.getByRole('button', { name: 'Heading', exact: true }).click()
    await expect(output).toHaveValue('## Article')
    await content.press('End')
    await page.getByRole('button', { name: 'Insert emoji', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Search emojis' }).fill('grinning face')
    await page.locator('[frimousse-emoji]').filter({ hasText: '😀' }).first().click()
    await expect(output).toHaveValue('## Article😀')
    await expect(content).toBeFocused()
    await content.press('Control+z')
    await expect(output).toHaveValue('## Article')

    for (const theme of ['dark', 'light']) {
        await page.evaluate(
            value => document.documentElement.classList.toggle('dark', value === 'dark'),
            theme
        )
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
            ).toBe(true)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath(`editor-${theme}-${width}.png`) })
        }
    }
})

test('edits article links without losing selection or allowing unsafe addresses', async ({
    page,
}) => {
    await page.goto('/editor-lab')
    await page.getByRole('button', { name: 'DEV.to', exact: true }).click()
    const content = page.getByRole('textbox', { name: 'Test content', exact: true })
    const output = page.getByRole('textbox', { name: /^Serialized output/ })
    await content.fill('Read this article')
    await page.getByRole('button', { name: 'Heading', exact: true }).click()
    await expect(content).toBeFocused()
    const selectWord = async () => {
        await content.evaluate(element => {
            const text = element.querySelector('p')?.firstChild
            if (!text || text.nodeType !== Node.TEXT_NODE)
                throw new Error('Expected paragraph text')
            element.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, 4)
        })
        await expect
            .poll(() =>
                content.evaluate(element => element.ownerDocument.getSelection()?.toString())
            )
            .toBe('Read')
    }
    await selectWord()
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    const address = page.getByRole('textbox', { name: 'Link address', exact: true })
    await address.fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Enter a valid HTTP, HTTPS or mailto address.')
    await expect(content.locator('a')).toHaveCount(0)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await address.fill('https://example.com/article')
    await address.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Link', exact: true })).toHaveCount(0)
    await expect(content).toBeFocused()
    await expect(content.locator('a')).toHaveText('Read')
    await expect(content.locator('a')).toHaveAttribute('href', 'https://example.com/article')
    await expect(output).toHaveValue('[Read](https://example.com/article) this article')
    await content.press('Control+z')
    await expect(content.locator('a')).toHaveCount(0)
    await expect(output).toHaveValue('Read this article')
    await selectWord()
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    await address.fill('https://example.com/article')
    await address.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Link', exact: true })).toHaveCount(0)
    await expect(content).toBeFocused()
    const linkButton = page.getByRole('button', { name: 'Link', exact: true })
    await linkButton.focus()
    await linkButton.press('Enter')
    await expect(address).toHaveValue('https://example.com/article')
    await page.getByRole('button', { name: 'Remove link', exact: true }).click()
    await expect(output).toHaveValue('Read this article')
    await expect(content).toBeFocused()
    await page.getByRole('button', { name: 'Discord', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(0)
})
