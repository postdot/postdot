import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { experienceRoutes, type ExperienceContext } from './route-registry'

/**
 * Baseline measurements for the web experience standard (SPEC-010). This is an
 * evidence collector, not a pass/fail gate: it records what a first-time
 * operator sees, then a reviewer maps each observation to a rule. It runs only
 * with POSTDOT_EXPERIENCE_AUDIT=true (see playwright.config.ts).
 */

const outputDirectory = join(process.cwd(), 'test-results', 'experience-audit')
const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
] as const

type Observation = Record<string, unknown>

test('collects the first-use and navigation baseline', async ({ page }) => {
    test.setTimeout(300_000)
    await mkdir(outputDirectory, { recursive: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const suffix = randomUUID().slice(0, 7)
    const observations: Observation[] = []

    expect(
        (
            await page.request.post('/api/auth/sign-up/email', {
                data: {
                    name: `Audit ${suffix}`,
                    email: `audit-${suffix}@example.test`,
                    password: 'experience-audit-password-123',
                },
            })
        ).status()
    ).toBe(200)
    const workspaceResponse = await page.request.post('/api/workspaces', {
        data: { name: `Audit workspace ${suffix}` },
    })
    expect(workspaceResponse.status()).toBe(201)
    const workspaceId = ((await workspaceResponse.json()) as { workspace: { id: string } })
        .workspace.id
    const projectIds: string[] = []
    for (const name of ['Newsroom', 'Product launches', 'Community']) {
        const response = await page.request.post('/api/projects', {
            data: { name: `${name} ${suffix}`, workspaceId },
        })
        expect(response.status()).toBe(201)
        projectIds.push(((await response.json()) as { project: { id: string } }).project.id)
    }
    const projectId = projectIds[0]!
    const context: ExperienceContext = { projectId, workspaceId }

    // Journey 1: a project with no channel.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await settle(page)
    observations.push(await observe(page, 'journey-1-empty-project-overview'))
    await shoot(page, 'journey-1-empty-project-overview')
    const primary = page.getByRole('main').getByRole('button').first()
    await primary.click()
    await settle(page)
    observations.push(await observe(page, 'journey-1-empty-project-primary-action'))
    await shoot(page, 'journey-1-empty-project-primary-action')

    // Journey 2: project context across the sidebar.
    await page.goto(`/dashboard/projects/${projectId}/overview`)
    await settle(page)
    const sidebarLabels = await page
        .locator('[data-slot="sidebar"] a, [data-slot="sidebar"] button')
        .evaluateAll(nodes =>
            nodes.map(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim())
        )
    observations.push({ id: 'journey-2-sidebar-before', sidebarLabels })
    for (const label of ['Workspace channels', 'Workspace administration']) {
        await page.goto(`/dashboard/projects/${projectId}/overview`)
        await settle(page)
        const link = page.getByRole('link', { name: label, exact: true }).first()
        if ((await link.count()) === 0) {
            observations.push({ id: `journey-2-${label}`, missing: true })
            continue
        }
        await link.click()
        await settle(page)
        observations.push(await observe(page, `journey-2-after-${label}`))
        await shoot(page, `journey-2-after-${slug(label)}`)
    }

    // Journey 3: every registered route at both viewports.
    for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        for (const route of experienceRoutes) {
            await page.goto(route.path(context))
            await settle(page)
            const observation = await observe(page, `${route.id}@${viewport.name}`)
            observations.push({
                ...observation,
                expected: {
                    scope: route.scope,
                    shell: route.shell,
                    widthClass: route.widthClass,
                    job: route.job,
                },
            })
            await shoot(page, `${route.id}-${viewport.name}`)
        }
    }

    await writeFile(
        join(outputDirectory, 'observations.json'),
        JSON.stringify(observations, null, 2)
    )
})

async function settle(page: Page) {
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(400)
}

function slug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

async function shoot(page: Page, name: string) {
    await page.screenshot({ fullPage: true, path: join(outputDirectory, `${name}.png`) })
}

async function observe(page: Page, id: string): Promise<Observation> {
    return page.evaluate(identifier => {
        const scroll = document.querySelector('[data-dashboard-scroll="true"]')
        const rect = (element: Element | null) => {
            if (element === null) return null
            const box = element.getBoundingClientRect()
            return { left: Math.round(box.left), width: Math.round(box.width) }
        }
        const text = (element: Element | null) => element?.textContent?.trim() ?? null
        const comboboxes = [...document.querySelectorAll('[role="combobox"]')].map(node => ({
            name: node.getAttribute('aria-label'),
            text: text(node),
        }))
        const headings = [...document.querySelectorAll('h1, h2')]
            .slice(0, 8)
            .map(node => ({ level: node.tagName, text: text(node), box: rect(node) }))
        const blocks = scroll
            ? [...scroll.querySelectorAll('section, form, main > div, [data-slot="card"]')]
                  .map(node => rect(node))
                  .filter(box => box !== null && box.width >= 240)
            : []
        const widths = blocks.map(box => box!.width)
        const sidebarGroups = [
            ...document.querySelectorAll('[data-slot="sidebar-group-label"]'),
        ].map(node => text(node))
        const activeSidebar = [
            ...document.querySelectorAll('[data-slot="sidebar"] [data-active]'),
        ].map(node => node.getAttribute('aria-label') ?? text(node))
        const navigationIconColors = [
            ...new Set(
                [
                    ...document.querySelectorAll(
                        '[data-slot="sidebar"] a svg, [data-slot="sidebar"] button svg'
                    ),
                ].map(node => getComputedStyle(node).color)
            ),
        ]
        return {
            id: identifier,
            navigationIconColors,
            url: location.pathname + location.search,
            viewport: { width: innerWidth, height: innerHeight },
            scrollRegion: rect(scroll),
            headings,
            blockWidths: [...new Set(widths)].sort((a, b) => a - b),
            pageColumns: [...document.querySelectorAll('[data-page-column]')].map(node =>
                node.getAttribute('data-page-column')
            ),
            hasCalendar: document.querySelector('[data-calendar="reui"]') !== null,
            comboboxes,
            sidebarGroups,
            activeSidebar,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
            buttons: [...document.querySelectorAll('main a, main button')]
                .slice(0, 12)
                .map(node => text(node)),
        }
    }, id)
}
