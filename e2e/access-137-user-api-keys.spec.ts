import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('creates user-owned API keys with generated names and bounded project access', async ({
    page,
}) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const projectName = `E2E-137 project ${suffix}`
    const projectId = await createAccountAndProject(page, suffix, projectName)

    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/preferences(?:\?.*)?$/)
    await page
        .getByRole('navigation', { name: 'Settings', exact: true })
        .getByRole('link', { name: 'API keys', exact: true })
        .first()
        .click()
    await expect(page).toHaveURL(/\/dashboard\/preferences\/api-keys(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
    await expect(page.getByText('No API keys', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Create an API key', exact: true }).click()
    const allProjectsDialog = page.getByRole('dialog')
    await expect(allProjectsDialog.getByRole('radio', { name: 'All projects' })).toBeChecked()
    await allProjectsDialog.getByRole('button', { name: 'Create an API key', exact: true }).click()

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
    await selectedProjectsDialog
        .getByRole('button', { name: 'Create an API key', exact: true })
        .click()

    await expect(generatedKeyHeading).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByText(/1 project\(s\): .*E2E-137 project/)).toBeVisible()

    const projectRoute = `/dashboard/projects/${projectId}/overview`
    await page.goto(projectRoute)
    await expect(page).toHaveURL(new RegExp(`${projectRoute}$`))
})

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
