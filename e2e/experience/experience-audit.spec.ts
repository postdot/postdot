import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import en from '../../apps/web/messages/en.json' with { type: 'json' }
import fr from '../../apps/web/messages/fr.json' with { type: 'json' }
import { experienceRoutes, type ExperienceContext } from './route-registry'

/**
 * Baseline measurements for the web experience standard (SPEC-010). This is an
 * evidence collector, not a pass/fail gate: it records what a first-time
 * operator sees, then a reviewer maps each observation to a rule. It runs only
 * with POSTDOT_EXPERIENCE_AUDIT=true (see playwright.config.ts).
 */

const rootOutputDirectory = join(process.cwd(), 'test-results', 'experience-audit')
const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
] as const

type Observation = Record<string, unknown>

for (const scenario of [
    { id: 'empty-en-dark', locale: 'en', theme: 'dark', populated: false, copy: en },
    { id: 'populated-fr-light', locale: 'fr', theme: 'light', populated: true, copy: fr },
] as const) {
    test(`collects the experience evidence: ${scenario.id}`, async ({ page }) => {
        const outputDirectory = join(rootOutputDirectory, scenario.id)
        await page.addInitScript(
            ({ locale, theme }) => {
                localStorage.setItem('PARAGLIDE_LOCALE', locale)
                localStorage.setItem('postdot-theme', theme)
            },
            { locale: scenario.locale, theme: scenario.theme }
        )
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
        let context: ExperienceContext = { projectId, workspaceId }

        // Journey 1: a project with no channel.
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(`/dashboard/projects/${projectId}/overview`)
        await settle(page)
        observations.push(await observe(page, 'journey-1-empty-project-overview'))
        await shoot(page, 'journey-1-empty-project-overview', outputDirectory)
        const primary = page.getByRole('main').getByRole('button').first()
        await primary.click()
        await settle(page)
        observations.push(await observe(page, 'journey-1-empty-project-primary-action'))
        await shoot(page, 'journey-1-empty-project-primary-action', outputDirectory)

        // Journey 2: project context across the sidebar.
        await page.goto(`/dashboard/projects/${projectId}/overview`)
        await settle(page)
        const sidebarLabels = await page
            .locator('[data-slot="sidebar"] a, [data-slot="sidebar"] button')
            .evaluateAll(nodes =>
                nodes.map(node =>
                    (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()
                )
            )
        observations.push({ id: 'journey-2-sidebar-before', sidebarLabels })
        for (const label of [
            scenario.copy.workspace_channels_title,
            scenario.copy.nav_workspace_administration,
        ]) {
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
            await shoot(page, `journey-2-after-${slug(label)}`, outputDirectory)
        }

        if (scenario.populated) {
            const channelResponse = await page.request.post(`/api/projects/${projectId}/channels`, {
                data: { name: 'Shared bulletin', profile: 'manual-message' },
            })
            expect(channelResponse.status()).toBe(201)
            const { channel } = (await channelResponse.json()) as {
                channel: { id: string; revision: number }
            }
            const shared = await page.request.post(
                `/api/projects/${projectId}/channels/${channel.id}/attachments`,
                {
                    data: { projectId: projectIds[1], expectedRevision: channel.revision },
                }
            )
            expect(shared.status()).toBe(200)
            observations.push({ id: 'populated-sharing-setup', status: shared.status() })
            for (const [index, title] of [
                'Community bulletin',
                'Next edition announcement',
            ].entries()) {
                const post = await page.request.post(`/api/projects/${projectId}/posts`, {
                    data: {
                        title,
                        sourceContent: {
                            body: {
                                format: 'plain_text',
                                text: 'Project news prepared for our community.',
                            },
                            media: [],
                        },
                        publications: [
                            {
                                channelId: channel.id,
                                deliveryMode: 'manual',
                                ...(index === 1 ? { scheduledAt: Date.now() + 86_400_000 } : {}),
                            },
                        ],
                    },
                })
                expect(post.status()).toBe(201)
                if (index === 0) {
                    const created = (await post.json()) as {
                        post: { id: string }
                        publications: { id: string }[]
                    }
                    context = {
                        ...context,
                        postId: created.post.id,
                        publicationId: created.publications[0]!.id,
                    }
                }
            }

            await page.goto(
                `/dashboard/workspace/channels?workspaceId=${workspaceId}&projectId=${projectId}`
            )
            await page.locator(`[data-workspace-channel="${channel.id}"] > summary`).click()
            await settle(page)
            observations.push(await observe(page, 'shared-channel-inspection'))
            await shoot(page, 'shared-channel-inspection', outputDirectory)
            await page.getByRole('button', { name: scenario.copy.channel_add, exact: true }).click()
            observations.push(await observe(page, 'shared-channel-creation-choice'))
            await shoot(page, 'shared-channel-creation-choice', outputDirectory)

            await page.goto(`/dashboard/projects/${projectId}/channels`)
            await page
                .getByRole('button', {
                    name: scenario.copy.channel_manage.replace('{channel}', 'Shared bulletin'),
                    exact: true,
                })
                .click()
            await page
                .getByRole('menuitem', { name: scenario.copy.channel_share_action, exact: true })
                .click()
            const sharingDialog = page.getByRole('dialog')
            await expect(
                sharingDialog.getByText(scenario.copy.channel_share_used_by, { exact: true })
            ).toBeVisible()
            observations.push({
                id: 'shared-channel-withdraw-copy',
                text: await sharingDialog.innerText(),
            })
            await shoot(page, 'shared-channel-withdraw-copy', outputDirectory)
            await page.keyboard.press('Escape')

            await page.goto(`/dashboard/projects/${projectId}/publications/new`)
            await page.locator('[data-publication-schedule-disclosure] > summary').click()
            await page.locator('#publication-default-schedule').click()
            const schedulingDialog = page.getByRole('dialog', {
                name: scenario.copy.date_time_picker_date,
                exact: true,
            })
            await expect(schedulingDialog).toBeVisible()
            observations.push({
                id: 'scheduling-zone-at-choice',
                text: await schedulingDialog.innerText(),
            })
            await shoot(page, 'scheduling-zone-at-choice', outputDirectory)
            await page.keyboard.press('Escape')
        }

        // Journey 3: every registered route at both viewports.
        for (const viewport of viewports) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height })
            for (const route of experienceRoutes) {
                const path = route.path(context)
                if (path === null) {
                    observations.push({
                        id: `${route.id}@${viewport.name}`,
                        omitted: 'No object exists in this data state',
                    })
                    continue
                }
                await page.goto(path)
                await settle(page)
                const observation = await observe(page, `${route.id}@${viewport.name}`)
                observations.push({
                    ...observation,
                    expected: {
                        scope: route.scope,
                        parent: route.parent,
                        shell: route.shell,
                        widthClass: route.widthClass,
                        job: route.job,
                    },
                })
                await shoot(page, `${route.id}-${viewport.name}`, outputDirectory)
                if (viewport.name === 'mobile' && route.id === 'personal-general') {
                    await page
                        .getByRole('button', { name: scenario.copy.nav_toggle, exact: true })
                        .click()
                    await settle(page)
                    observations.push(await observe(page, 'personal-navigation@mobile'))
                    await shoot(page, 'personal-navigation-mobile', outputDirectory)
                    await page.keyboard.press('Escape')
                }
            }
        }

        await writeFile(
            join(outputDirectory, 'observations.json'),
            JSON.stringify(observations, null, 2)
        )
    })
}

async function settle(page: Page) {
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(400)
}

function slug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

async function shoot(page: Page, name: string, outputDirectory: string) {
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
            scopedNavigation: [...document.querySelectorAll('[data-navigation-scope]')].map(
                node => ({
                    scope: node.getAttribute('data-navigation-scope'),
                    destination: node.getAttribute('data-navigation-destination'),
                    label: node.getAttribute('aria-label') ?? text(node),
                    color: node.querySelector('svg')
                        ? getComputedStyle(node.querySelector('svg')!).color
                        : null,
                })
            ),
            theme: document.documentElement.className,
            locale: document.documentElement.lang,
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
                .filter(node => node.getClientRects().length > 0)
                .slice(0, 12)
                .map(node => text(node)),
        }
    }, id)
}
