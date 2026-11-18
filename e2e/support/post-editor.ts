import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Helpers for the shared post editor (SPEC-013): an "All channels" tab for the post text,
 * one tab per channel for that channel's version, content options and lifecycle under it.
 */

/** The editor of the active tab: the post text on "All channels", the channel text otherwise. */
export function composerText(page: Page): Locator {
    return page.getByRole('textbox', { name: /^(Content|Channel content)$/ })
}

/** The media of the active tab, under its editor (thumbnails, order and descriptions). */
export function composerMedia(page: Page): Locator {
    return page.locator('[data-new-publication-editor="true"] > [data-media-picker="true"]')
}

/**
 * Opens a media item's optional description from its "ALT" badge and returns the field.
 * Press Escape to close it; the description saves as it is typed.
 */
export async function openMediaDescription(page: Page, filename: string): Promise<Locator> {
    await composerMedia(page)
        .getByRole('button', { name: new RegExp(`description (of|for) ${filename}$`) })
        .click()
    const field = page.getByRole('textbox', { name: 'Accessibility text', exact: true })
    await expect(field).toBeVisible()
    return field
}

/** Opens the "All channels" tab, whose editor holds the post text shared by every channel. */
export async function openAllChannels(page: Page): Promise<Locator> {
    const tab = page.getByRole('button', { name: 'All channels', exact: true })
    if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click()
    await expect(tab).toHaveAttribute('aria-pressed', 'true')
    return composerText(page)
}

/** Opens a channel's tab and returns its text editor. */
export async function openChannel(page: Page, channelName: string): Promise<Locator> {
    const tab = page.locator('[data-channel-selected-button]').filter({
        has: page.getByText(channelName, { exact: true }),
    })
    if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click()
    await expect(tab).toHaveAttribute('aria-pressed', 'true')
    return composerText(page)
}

/** Opens the active channel's "Content options" (language, thread, poll, provider fields). */
export async function openContentOptions(page: Page): Promise<Locator> {
    const options = page.locator('[data-post-channel-panel] [data-publication-customization]')
    await expect(options).toBeVisible()
    if ((await options.getAttribute('open')) === null) {
        await options.locator(':scope > summary').click()
    }
    await expect(options).toHaveAttribute('open', '')
    return options
}

/** The single action that applies every pending change. */
export function saveButton(page: Page): Locator {
    return page.locator('[data-post-save]')
}

/** The active channel's state strip and actions, above the editor. */
export function channelStatus(page: Page): Locator {
    return page.locator('[data-post-channel-status]')
}

/** Resolves when the editor has written its pending changes through the composition route. */
export function compositionSaved(page: Page) {
    return page.waitForResponse(
        response =>
            response.url().endsWith('/composition') &&
            response.request().method() === 'PUT' &&
            response.ok()
    )
}
