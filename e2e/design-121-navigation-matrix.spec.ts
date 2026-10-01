import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps navigation entries aligned with their route and context', async ({ page }) => {
    test.setTimeout(60_000)

    const suffix = randomUUID().slice(0, 8)
    const projectId = await createAccountAndProject(page, suffix)
    const projectEntries = [
        { heading: 'Overview', label: 'Overview', path: 'overview' },
        { heading: 'Performance', label: 'Performance', path: 'performance' },
        { heading: 'Queue', label: 'Queue', path: 'queue' },
        { heading: 'Channels', label: 'Channels', path: 'channels' },
        { heading: 'Media', label: 'Media', path: 'media' },
    ] as const

    for (const entry of projectEntries) {
        const link = page.getByRole('link', { name: entry.label, exact: true })
        await expect(link).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/${entry.path}$`))
        await expect(page.getByRole('heading', { name: entry.heading, exact: true })).toBeVisible()
        await expect(link).toHaveAttribute('aria-current', 'page')

        for (const otherEntry of projectEntries) {
            if (otherEntry.label === entry.label) continue
            await expect(
                page.getByRole('link', { name: otherEntry.label, exact: true })
            ).not.toHaveAttribute('aria-current', 'page')
        }
    }

    await expect(page.getByRole('link', { name: 'Access', exact: true })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await expect(
        page.getByRole('link', { name: 'Project configuration', exact: true })
    ).toBeVisible()
    await page.getByRole('link', { name: 'Project configuration', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/access$`))
    await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Project configuration', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Access', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(
        page.getByRole('navigation', { name: 'Project navigation', exact: true })
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Project invitations', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'API keys', exact: true })).toHaveCount(0)

    await page.getByRole('link', { name: 'Project invitations', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/invitations$`))
    await expect(
        page.getByRole('heading', { name: 'Project invitations', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('link', { name: 'Project invitations', exact: true })
    ).toHaveAttribute('aria-current', 'page')

    await page.getByRole('button', { name: 'Back to project', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/overview$`))
    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/preferences(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('projectId')).toBe(projectId)
    await expect(page.locator('[data-context-kind="project"]')).toContainText(
        `E2E navigation project ${suffix}`
    )
    await expect(page.getByRole('navigation', { name: 'Personal', exact: true })).toBeVisible()
    await page
        .getByRole('navigation', { name: 'Personal', exact: true })
        .getByRole('link', { name: 'API keys', exact: true })
        .first()
        .click()
    await expect(page).toHaveURL(/\/dashboard\/preferences\/api-keys(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
    await expect(
        page
            .getByRole('navigation', { name: 'Personal', exact: true })
            .getByRole('link', { name: 'API keys', exact: true })
            .first()
    ).toHaveAttribute('aria-current', 'page')

    await page.goto(`/dashboard/settings?projectId=${projectId}`)
    await expect(page).toHaveURL(/\/dashboard\/settings(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible()
    await expect(
        page.getByRole('navigation', { name: 'Installation administration', exact: true })
    ).toBeVisible()
    await expect(
        page
            .getByRole('navigation', { name: 'Installation administration', exact: true })
            .getByRole('link', { name: 'Overview', exact: true })
    ).toHaveCount(0)

    await page.getByRole('link', { name: 'OAuth applications', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings\/provider-applications(?:\?.*)?$/)
    await expect(
        page.getByRole('heading', { name: 'OAuth applications', exact: true })
    ).toBeVisible()
    await expect(
        page.getByRole('link', { name: 'OAuth applications', exact: true })
    ).toHaveAttribute('aria-current', 'page')
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toHaveCount(0)

    await page.getByRole('link', { name: 'Members & invitations', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings\/access(?:\?.*)?$/)
    await expect(
        page.getByRole('heading', { name: 'Members & invitations', exact: true }).first()
    ).toBeVisible()
    await expect(
        page.getByRole('link', { name: 'Members & invitations', exact: true })
    ).toHaveAttribute('aria-current', 'page')

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/preferences(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('projectId')).toBe(projectId)
    await expect(page.locator('[data-context-kind="project"]')).toContainText(
        `E2E navigation project ${suffix}`
    )
    await expect(page.getByRole('navigation', { name: 'Personal', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'General', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(
        page.getByRole('navigation', { name: 'Work navigation', exact: true })
    ).toHaveCount(0)

    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await page.getByRole('combobox', { name: 'Select workspace', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Members & groups', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Members & groups', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings\/workspace(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: 'Members & groups', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('projectId')).toBe(projectId)
    await expect(page.locator('[data-context-kind="project"]')).toContainText(
        `E2E navigation project ${suffix}`
    )
    await expect(
        page.getByRole('navigation', { name: 'Workspace navigation', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Members & groups', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    )
    await expect(
        page.getByRole('navigation', { name: 'Installation administration', exact: true })
    ).toBeVisible()
    const returnToProject = page.getByRole('button', { name: 'Back to project', exact: true })
    await expect(returnToProject).toHaveAttribute(
        'href',
        `/dashboard/projects/${projectId}/overview`
    )
    await returnToProject.click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${projectId}/overview$`))

    await page.goto(`/dashboard/preferences?projectId=${projectId}`)
    await expect(
        page.getByRole('button', { name: 'Back to project', exact: true })
    ).toHaveAttribute('href', `/dashboard/projects/${projectId}/overview`)
    await page.goto('/dashboard/preferences?projectId=none')
    await expect(
        page.getByRole('button', { name: 'Back to workspace', exact: true })
    ).toHaveAttribute('href', /projectId=none/)
})

async function createAccountAndProject(page: Page, suffix: string): Promise<string> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E navigation ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-navigation-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-navigation-password')
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
        .fill(`E2E navigation project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)

    const match = new URL(page.url()).pathname.match(/^\/dashboard\/projects\/([^/]+)/)
    if (match?.[1] === undefined) {
        throw new Error(`Expected a project route, received ${page.url()}`)
    }
    return match[1]
}
