import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

const mediaFilename = 'herald-e2e-pixel.png'
const mediaBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
)

test('persists mixed and media-only publications through the dashboard', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    const projectName = `E2E-33 Project ${suffix}`
    const channelName = `E2E-33 Channel ${suffix}`
    const mixedTitle = `E2E-33 Mixed ${suffix}`
    const mediaOnlyTitle = `E2E-33 Media only ${suffix}`
    const sourceText = `E2E-33 source ${suffix}`
    const targetText = `E2E-33 target ${suffix}`

    await page.goto('/login')
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill('E2E-33 Operator')
    await page.getByLabel('Email').fill(`e2e-33-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-33-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByLabel('New project').fill(projectName)
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page.getByLabel('Select project').locator('option:checked')).toHaveText(
        projectName
    )

    await page.getByLabel('New manual channel').fill(channelName)
    await page.getByRole('button', { name: 'Add channel', exact: true }).click()
    await expect(page.locator('li').filter({ hasText: channelName }).first()).toBeVisible()
    await page.getByLabel('Destination').selectOption({ label: channelName })

    await page.locator('input[type="file"]').setInputFiles({
        name: mediaFilename,
        mimeType: 'image/png',
        buffer: mediaBytes,
    })

    const mediaCard = page.locator('article').filter({ hasText: mediaFilename }).first()
    const mediaToggle = mediaCard.getByRole('button').first()
    await expect(mediaToggle).toHaveAttribute('aria-pressed', 'true')

    await page.getByLabel('Post title').fill(mixedTitle)
    await page.getByLabel('Source content').fill(sourceText)
    await page.getByLabel('Channel copy').fill(targetText)
    await page.getByRole('button', { name: 'Schedule manual publication', exact: true }).click()

    const mixedPublication = page.getByRole('link').filter({ hasText: mixedTitle }).first()
    await expect(mixedPublication).toBeVisible()

    await page.getByLabel('Destination').selectOption({ label: channelName })
    await page.getByLabel('Post title').fill(mediaOnlyTitle)
    await page.getByRole('button', { name: new RegExp(mediaFilename) }).click()
    await expect(page.getByRole('button', { name: new RegExp(mediaFilename) })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await page.getByRole('button', { name: 'Schedule manual publication', exact: true }).click()

    const mediaOnlyPublication = page.getByRole('link').filter({ hasText: mediaOnlyTitle }).first()
    await expect(mediaOnlyPublication).toBeVisible()

    await page.reload()
    await expect(page.getByRole('link').filter({ hasText: mixedTitle }).first()).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: mediaOnlyTitle }).first()).toBeVisible()

    await page.getByRole('link').filter({ hasText: mixedTitle }).first().click()
    await expect(page.getByRole('heading', { name: mixedTitle })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue(sourceText)
    await expect(
        page.locator('article').filter({ hasText: mediaFilename }).first().getByRole('button')
    ).toHaveAttribute('aria-pressed', 'true')

    const mixedTarget = parseTargetContent(await page.getByLabel('Target JSON').inputValue())
    expect(mixedTarget.body).toBe(targetText)
    expect(mixedTarget.media).toHaveLength(1)
    const assetId = mixedTarget.media[0]?.assetId
    expect(assetId).toEqual(expect.any(String))

    await page.getByRole('link', { name: /Back to dashboard/ }).click()
    await page.getByRole('link').filter({ hasText: mediaOnlyTitle }).first().click()
    await expect(page.getByRole('heading', { name: mediaOnlyTitle })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue('')
    await expect(
        page.locator('article').filter({ hasText: mediaFilename }).first().getByRole('button')
    ).toHaveAttribute('aria-pressed', 'true')

    const mediaOnlyTarget = parseTargetContent(await page.getByLabel('Target JSON').inputValue())
    expect(mediaOnlyTarget.body).toBeUndefined()
    expect(mediaOnlyTarget.media).toHaveLength(1)
    expect(mediaOnlyTarget.media[0]?.assetId).toBe(assetId)
})

interface TargetContent {
    readonly body?: string
    readonly media: readonly { readonly assetId: string }[]
}

function parseTargetContent(value: string): TargetContent {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || !Array.isArray(parsed.media)) {
        throw new Error('The editor target did not contain a media array')
    }

    return parsed as unknown as TargetContent
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
