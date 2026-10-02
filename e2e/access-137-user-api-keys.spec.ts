import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('creates and edits user-owned API keys with bounded project and action access', async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000)

    const suffix = randomUUID().slice(0, 8)
    const projectName = `E2E-137 project ${suffix}`
    const projectId = await createAccountAndProject(page, suffix, projectName)

    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/preferences(?:\?.*)?$/)
    await page
        .getByRole('navigation', { name: 'Personal', exact: true })
        .getByRole('link', { name: 'API keys', exact: true })
        .first()
        .click()
    await expect(page).toHaveURL(/\/dashboard\/preferences\/api-keys(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
    await expect(page.getByText('No API keys', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Create an API key', exact: true }).click()
    const allProjectsDialog = page.getByRole('dialog')
    await expect(allProjectsDialog.getByRole('radio', { name: 'All projects' })).toBeChecked()
    await allProjectsDialog.getByLabel('Name (optional)', { exact: true }).fill('Retry key')
    const keyEndpoint = '**/api/api-keys'
    await page.route(keyEndpoint, async route => {
        if (route.request().method() === 'POST')
            await route.fulfill({ status: 503, json: { error: 'internal_error' } })
        else await route.continue()
    })
    await allProjectsDialog.getByRole('button', { name: 'Create an API key', exact: true }).click()
    await expect(allProjectsDialog.getByRole('alert')).toBeVisible()
    await expect(allProjectsDialog.getByLabel('Name (optional)', { exact: true })).toHaveValue(
        'Retry key'
    )
    await page.unroute(keyEndpoint)
    await allProjectsDialog.getByLabel('Name (optional)', { exact: true }).fill('')
    await submitCreateKey(allProjectsDialog, page)

    const generatedKeyHeading = page.getByRole('heading', {
        name: /^API key created for Herald [A-Z][a-z]+ [A-Z][a-z]+ [A-Z0-9]{6}$/,
    })
    await expect(generatedKeyHeading).toBeVisible()
    const generatedName = (await generatedKeyHeading.textContent())?.replace(
        /^API key created for /,
        ''
    )
    expect(generatedName).toMatch(/^Herald [A-Z][a-z]+ [A-Z][a-z]+ [A-Z0-9]{6}$/)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    if (generatedName === undefined) throw new Error('The generated API key name was not rendered')
    await expect(page.getByText(generatedName, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Create an API key', exact: true }).click()
    const selectedProjectsDialog = page.getByRole('dialog')
    const selectedProjectsRadio = selectedProjectsDialog.getByRole('radio', {
        name: 'Only selected projects',
    })
    await selectedProjectsRadio.check()
    await expect(selectedProjectsRadio).toBeChecked()

    const projectPicker = selectedProjectsDialog.getByRole('combobox', {
        name: 'Choose projects',
        exact: true,
    })
    await projectPicker.click()
    await page.getByRole('option', { name: projectName, exact: true }).click()
    await expect(projectPicker).toContainText(projectName)
    await page.keyboard.press('Escape')

    const selectedActionsRadio = selectedProjectsDialog.getByRole('radio', {
        name: 'Only selected actions',
    })
    await selectedActionsRadio.check()
    await selectedProjectsDialog.getByRole('checkbox', { name: 'Read project data' }).check()
    await selectedProjectsDialog
        .getByRole('checkbox', { name: 'Manage channels and profiles' })
        .check()
    await submitCreateKey(selectedProjectsDialog, page)

    await expect(generatedKeyHeading).toBeVisible()
    const limitedKeyName = (await generatedKeyHeading.textContent())?.replace(
        /^API key created for /,
        ''
    )
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    if (limitedKeyName === undefined) throw new Error('The limited API key name was not rendered')
    await expect(page.getByText(/1 project\(s\): .*E2E-137 project/)).toBeVisible()
    await expect(
        page.getByText('Limited to: Read project data, Manage channels and profiles', {
            exact: true,
        })
    ).toBeVisible()

    const limitedKey = page.locator('li').filter({ hasText: limitedKeyName })
    await limitedKey.getByRole('button', { name: 'Edit actions', exact: true }).click()
    const editActionsDialog = page.getByRole('dialog')
    await expect(
        editActionsDialog.getByRole('checkbox', { name: 'Read project data' })
    ).toBeChecked()
    await editActionsDialog.getByRole('checkbox', { name: 'Read project data' }).uncheck()
    await editActionsDialog
        .getByRole('checkbox', { name: 'Prepare and manage publications' })
        .check()
    await editActionsDialog.getByRole('button', { name: 'Save actions' }).click()
    await expect(
        limitedKey.getByText(
            'Limited to: Prepare and manage publications, Manage channels and profiles',
            { exact: true }
        )
    ).toBeVisible()

    for (const theme of ['light', 'dark'] as const) {
        if (!(await page.locator('html').getAttribute('class'))?.split(' ').includes(theme)) {
            await page
                .getByRole('button', {
                    name: en.theme_switch_to.replace('{theme}', en[`theme_${theme}`]),
                    exact: true,
                })
                .click()
        }
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({ width, height: 844 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({
                path: testInfo.outputPath(`api-keys-${theme}-${width}.png`),
                fullPage: true,
            })
        }
    }
    await page.setViewportSize({ width: 1280, height: 844 })
    await page.route('**/api/api-keys', route =>
        route.fulfill({ status: 503, json: { error: 'internal_error' } })
    )
    await page.reload()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText(en.api_keys_loading, { exact: true })).toHaveCount(0)
    await page.unroute('**/api/api-keys')
    await page.getByRole('button', { name: en.common_retry, exact: true }).click()
    await expect(page.getByText(limitedKeyName, { exact: true })).toBeVisible()
    const projectRoute = `/dashboard/projects/${projectId}/overview`
    await page.goto(projectRoute)
    await expect(page).toHaveURL(new RegExp(`${projectRoute}$`))
})

async function submitCreateKey(dialog: Locator, page: Page) {
    const responsePromise = page.waitForResponse(
        response =>
            response.url().endsWith('/api/api-keys') && response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Create an API key', exact: true }).click()
    const response = await responsePromise
    if (response.status() !== 201) {
        throw new Error(`API key creation failed (${response.status()}): ${await response.text()}`)
    }
}

async function createAccountAndProject(
    page: Page,
    suffix: string,
    projectName: string
): Promise<string> {
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByLabel('Name', { exact: true }).fill(`E2E-137 owner ${suffix}`)
    await page.getByLabel('Email', { exact: true }).fill(`e2e-137-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-137-owner-password')
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
    const projectDialog = page.getByRole('dialog')
    await projectDialog.getByRole('textbox', { name: 'New project', exact: true }).fill(projectName)
    await projectDialog.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
