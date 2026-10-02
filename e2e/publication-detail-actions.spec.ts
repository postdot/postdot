import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps publication detail actions aligned with the scheduled lifecycle', async ({
    page,
}, testInfo) => {
    test.setTimeout(45_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const channelName = `E2E detail destination ${suffix}`

    await page.getByRole('link', { name: 'Channels', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const addChannelButton = page.getByRole('button', { name: 'Add channel', exact: true })
    await expect(addChannelButton).toBeEnabled()
    await addChannelButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Channel name').fill(channelName)
    await page.getByRole('button', { name: 'Create channel', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: channelName }).first()).toBeVisible()

    await page.getByRole('link', { name: 'New publication', exact: true }).click()
    await expect(page.locator('[data-new-publication-form="true"]')).toHaveAttribute(
        'aria-busy',
        'false'
    )
    await page.getByLabel('Content', { exact: true }).fill('E2E detail lifecycle content')
    const scheduleButton = page.locator('button[name="publication-action"][value="schedule"]')
    await Promise.all([
        page.waitForResponse(
            response =>
                response.url().endsWith(`/api/projects/${projectId}/posts`) &&
                response.request().method() === 'POST' &&
                response.ok()
        ),
        scheduleButton.click(),
    ])
    await expect(scheduleButton).toBeEnabled()

    await page.getByRole('link', { name: 'Queue', exact: true }).click()
    const publicationLink = page.locator('a[data-publication-edit-link="true"]').first()
    await expect(publicationLink).toBeVisible()
    await publicationLink.click()

    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/publications/[^/]+$`))
    await expect(page.getByRole('link', { name: 'Queue', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(page.locator('[data-publication-action="cancel"]')).toBeVisible()
    const delivery = page.locator('[data-publication-delivery-disclosure="true"]')
    await expect(delivery).not.toHaveAttribute('open', '')
    await expect(page.locator('#deliver-at')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply to channel', exact: true })).toBeVisible()
    await expect(
        page.locator('[data-composer-settings]').locator('[data-publication-delivery-disclosure]')
    ).toBeVisible()
    await expect(
        page
            .locator('[data-composer-actions]')
            .getByRole('button', { name: 'Apply to channel', exact: true })
    ).toBeVisible()
    await expect(
        page.locator('[data-composer-editor]').locator('[data-publication-delivery-disclosure]')
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toHaveCount(0)
    await expect(page.locator('#source-body')).toBeVisible()
    await expect(page.locator('#source-body')).toHaveAccessibleName('Body')
    const customization = page.locator('[data-publication-customization]')
    await expect(customization.locator(':scope > summary')).not.toContainText('Compatible')
    await customization.locator(':scope > summary').focus()
    await page.keyboard.press('Enter')
    await expect(customization.locator('[data-target-editor]')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(customization.locator('[data-target-editor]')).not.toBeVisible()

    await delivery.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#deliver-at')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('#deliver-at')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark published', exact: true })).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('link', { name: 'Back to queue' })).toBeVisible()
    const detailWidth = await page.locator('[data-dashboard-scroll]').evaluate(region => ({
        client: region.clientWidth,
        scroll: region.scrollWidth,
    }))
    expect(detailWidth.scroll).toBeLessThanOrEqual(detailWidth.client)
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.locator('[data-publication-action="cancel"]').click()
    await expect(
        page.getByRole('heading', { name: 'Cancel publication?', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('button', { name: 'Cancel publication', exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-publication-cancel-confirm="true"]')).toBeVisible()

    await page.locator('[data-publication-cancel-confirm="true"]').click()
    await expect(page.getByText('Publication cancelled.', { exact: true })).toBeVisible()
    await expect(page.locator('[data-publication-action="cancel"]')).toHaveCount(0)
    await expect(page.locator('[data-publication-lifecycle="true"]')).toContainText('Cancelled')
    await expect(page.locator('#source-body')).toHaveCount(0)
    await expect(page.locator('[data-publication-draft-preview="true"]')).toBeVisible()

    const publicationId = page.url().split('/').pop()
    expect(publicationId).toBeTruthy()
    let lifecycleState: 'due' | 'failed' = 'due'
    let sourceConflict = false
    let olderRecovery = false
    const baselineResponse = await page.request.get(
        `/api/projects/${projectId}/publications/${publicationId}/editor`
    )
    expect(baselineResponse.status()).toBe(200)
    const baselineEditor = await baselineResponse.json()
    await page.route(
        `**/api/projects/${projectId}/publications/${publicationId}/editor`,
        async route => {
            const payload = structuredClone(baselineEditor) as {
                editor: {
                    publication: Record<string, unknown>
                    draft: { sourceRevision: number; revision: number }
                    post: { sourceRevision: number }
                }
            }
            payload.editor.publication = {
                ...payload.editor.publication,
                deliveryMode: lifecycleState === 'due' ? 'manual' : 'automatic',
                errorMessage:
                    lifecycleState === 'failed'
                        ? 'The destination rejected the publication. Review the account connection.'
                        : null,
                scheduledAt: Date.now() - 60_000,
                state: lifecycleState === 'due' ? 'scheduled' : 'failed',
            }
            if (olderRecovery) payload.editor.draft.revision = 2
            if (sourceConflict) {
                payload.editor.post.sourceRevision = payload.editor.draft.sourceRevision + 1
            }
            await route.fulfill({ status: 200, json: payload })
        }
    )

    await page.reload()
    await expect(page.locator('[data-publication-action="record-published"]')).toBeVisible()
    const editorNotice = page.locator('[data-publication-editor-message]')
    await expect(editorNotice).toHaveAttribute('role', 'status')
    await expect(editorNotice).toContainText('The publication changed in the background.')
    await expect(editorNotice).not.toContainText('Editor status')
    await expect(page.locator('[data-publication-lifecycle="true"]')).toContainText(
        'To publish manually'
    )

    await page.screenshot({
        path: testInfo.outputPath('manual-detail-desktop.png'),
        fullPage: true,
    })
    lifecycleState = 'failed'
    await page.reload()
    await expect(page.locator('[data-publication-action="retry"]')).toBeVisible()
    await expect(page.locator('[data-publication-error="true"]')).toContainText(
        'The destination rejected the publication.'
    )
    await page.screenshot({
        path: testInfo.outputPath('failed-detail-desktop.png'),
        fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const failedDetailWidth = await page.locator('[data-dashboard-scroll]').evaluate(region => ({
        client: region.clientWidth,
        scroll: region.scrollWidth,
    }))
    expect(failedDetailWidth.scroll).toBeLessThanOrEqual(failedDetailWidth.client)
    await page.screenshot({ path: testInfo.outputPath('failed-detail-mobile.png'), fullPage: true })
    sourceConflict = true
    await page.reload()
    const conflict = page.locator('[data-publication-conflict]')
    await expect(editorNotice).toHaveAttribute('role', 'alert')
    await expect(editorNotice).not.toHaveAttribute('data-passive-update', 'true')
    expect(
        await editorNotice.evaluate(notice => {
            const composer = document.querySelector('[data-publication-composer="true"]')
            return (
                composer !== null &&
                Boolean(notice.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)
            )
        })
    ).toBe(true)
    await expect(editorNotice).toContainText('Rebase it before saving or promoting.')
    await expect(editorNotice).not.toContainText('The latest server state is shown.')
    await editorNotice.getByRole('button').click()
    await expect(
        page.locator('details').filter({ has: conflict }).locator(':scope > summary')
    ).toBeFocused()
    await expect(conflict).toBeVisible()
    await expect(conflict).toHaveAttribute('role', 'alert')
    await expect(conflict.locator('button')).toHaveCount(2)
    expect(
        await conflict.evaluate(element => element === element.parentElement?.firstElementChild)
    ).toBe(true)
    await page.screenshot({
        path: testInfo.outputPath('source-conflict-mobile.png'),
        fullPage: true,
    })
    sourceConflict = false
    olderRecovery = true
    const recoveryKey = `herald:publication-editor:v3:${projectId}:${publicationId}`
    const localCopy = {
        version: 3,
        baseRevision: 1,
        sourceContent: { body: { format: 'plain_text', text: 'Unsent local draft' }, media: [] },
        targetText: JSON.stringify({ body: 'Unsent local draft' }),
        scheduleValue: '',
        timeZone: 'UTC',
    }
    await page.evaluate(({ key, copy }) => localStorage.setItem(key, JSON.stringify(copy)), {
        key: recoveryKey,
        copy: localCopy,
    })
    await page.reload()
    const recoveryDecision = page.locator('[data-publication-recovery-decision]')
    await expect(recoveryDecision).toBeVisible()
    await expect(recoveryDecision).toHaveAccessibleName('Local copy')
    await page.keyboard.press('Escape')
    await expect(recoveryDecision).toBeVisible()
    expect(
        await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), recoveryKey)
    ).toEqual(localCopy)
    await page.screenshot({
        path: testInfo.outputPath('local-recovery-mobile.png'),
        fullPage: true,
    })
    await recoveryDecision.getByRole('button', { name: 'Restore local copy', exact: true }).click()
    await expect(recoveryDecision).toHaveCount(0)
    await expect(page.locator('#source-body')).toHaveValue('Unsent local draft')
    await page.addInitScript(({ key, copy }) => localStorage.setItem(key, JSON.stringify(copy)), {
        key: recoveryKey,
        copy: localCopy,
    })
    await page.reload()
    await expect(recoveryDecision).toBeVisible()
    await recoveryDecision.getByRole('button', { name: 'Discard local copy', exact: true }).click()
    await expect(recoveryDecision).toHaveCount(0)
    await expect(page.locator('#source-body')).toHaveValue('E2E detail lifecycle content')
})

async function createAccountAndProject(page: Page, suffix: string) {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E detail ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-detail-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-detail-password')
    await Promise.all([
        page.waitForResponse(
            response => response.url().includes('/api/auth/sign-up/email') && response.ok()
        ),
        page.getByRole('button', { name: 'Create account', exact: true }).click(),
    ])
    await page.goto('/dashboard?projectId=none')
    await expect(page).toHaveURL(/\/dashboard\?projectId=none$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).last().click()
    await page
        .getByRole('textbox', { name: 'New project', exact: true })
        .fill(`E2E detail project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
