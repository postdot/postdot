import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

test('keeps the workspace navigation reachable when reduced and on mobile', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCSS('padding', '0px')
    const expandedShell = await page
        .locator('[data-slot="sidebar-container"]')
        .evaluate(container => {
            const scroll = container.ownerDocument.querySelector('[data-dashboard-scroll]')
            if (scroll === null)
                throw new Error('Expected the dashboard scroll region to be mounted')
            return {
                containerRight: Math.round(container.getBoundingClientRect().right),
                scrollLeft: Math.round(scroll.getBoundingClientRect().left),
            }
        })
    expect(expandedShell.scrollLeft).toBe(expandedShell.containerRight)

    const toggle = page.getByRole('button', { name: 'Toggle workspace navigation', exact: true })
    await toggle.click()
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()

    const collapsedSidebar = page.locator('[data-slot="sidebar-container"]')
    await expect(collapsedSidebar).toHaveCSS('width', '48px')
    const collapsedSidebarBox = await collapsedSidebar.boundingBox()
    const compactLogoBox = await page.locator('a[aria-label="Herald workspace"]').boundingBox()
    if (collapsedSidebarBox === null || compactLogoBox === null) {
        throw new Error('Expected the compact sidebar and its logo to be visible')
    }
    expect(compactLogoBox.x + compactLogoBox.width / 2).toBeCloseTo(
        collapsedSidebarBox.x + collapsedSidebarBox.width / 2,
        0
    )
    expect(Math.round(compactLogoBox.y)).toBe(0)
    expect(Math.round(compactLogoBox.height)).toBe(56)

    await page.reload()
    await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCSS('width', '48px')

    const collapsedShell = await collapsedSidebar.evaluate(container => {
        const inner = container.querySelector('[data-slot="sidebar-inner"]')
        const inset = container.ownerDocument.querySelector('[data-slot="sidebar-inset"]')
        const scroll = container.ownerDocument.querySelector('[data-dashboard-scroll]')
        if (inner === null || inset === null || scroll === null) {
            throw new Error('Expected the collapsed sidebar shell to be mounted')
        }

        const containerRectangle = container.getBoundingClientRect()
        const innerRectangle = inner.getBoundingClientRect()
        const insetRectangle = inset.getBoundingClientRect()
        const scrollRectangle = scroll.getBoundingClientRect()
        return {
            containerLeft: Math.round(containerRectangle.left),
            containerRight: Math.round(containerRectangle.right),
            innerLeft: Math.round(innerRectangle.left),
            innerRight: Math.round(innerRectangle.right),
            insetLeft: Math.round(insetRectangle.left),
            scrollLeft: Math.round(scrollRectangle.left),
        }
    })
    expect(collapsedShell.innerLeft).toBe(collapsedShell.containerLeft)
    expect(collapsedShell.innerRight).toBe(collapsedShell.containerRight)
    expect(collapsedShell.insetLeft).toBe(collapsedShell.innerRight)
    expect(collapsedShell.scrollLeft).toBe(collapsedShell.insetLeft)

    for (const label of ['Queue', 'Media']) {
        const link = page.getByRole('link', { name: label, exact: true })
        const box = await link.boundingBox()
        if (box === null) throw new Error(`Expected the collapsed ${label} link to be visible`)
        expect(Math.round(box.x)).toBe(8)
        expect(Math.round(box.width)).toBe(32)

        const middleX = Math.round(box.width / 2)
        const middleY = Math.round(box.height / 2)
        for (const point of [
            { x: middleX, y: 4 },
            { x: 4, y: middleY },
            { x: Math.max(4, box.width - 4), y: middleY },
            { x: middleX, y: Math.max(4, box.height - 4) },
        ]) {
            const x = box.x + point.x
            const y = box.y + point.y
            await page.mouse.move(x, y)
            const hoverState = await link.evaluate(
                (element, coordinates) => {
                    const hit = element.ownerDocument.elementFromPoint(coordinates.x, coordinates.y)
                    return {
                        hit:
                            hit === null
                                ? null
                                : {
                                      className: hit.className,
                                      slot: hit.getAttribute('data-slot'),
                                      tagName: hit.tagName,
                                  },
                        rectangle: (() => {
                            const rectangle = element.getBoundingClientRect()
                            return {
                                bottom: rectangle.bottom,
                                height: rectangle.height,
                                left: rectangle.left,
                                right: rectangle.right,
                                top: rectangle.top,
                                width: rectangle.width,
                            }
                        })(),
                        pointerEvents:
                            element.ownerDocument.defaultView?.getComputedStyle(element)
                                .pointerEvents,
                        hovered: element.matches(':hover'),
                    }
                },
                { x, y }
            )
            expect(
                hoverState,
                `${label} should own the compact hitbox at (${point.x}, ${point.y}): ${JSON.stringify(hoverState)}`
            ).toMatchObject({ hovered: true })
        }
    }

    for (const [label, path] of [
        ['Queue', 'queue'],
        ['Media', 'media'],
    ] as const) {
        const link = page.getByRole('link', { name: label, exact: true })
        const box = await link.boundingBox()
        if (box === null) throw new Error(`Expected the collapsed ${label} link to be visible`)
        await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2)
        await expect(page).toHaveURL(new RegExp(`/${path}$`))
        await page.goBack()
        await expect(page).toHaveURL(/\/overview$/)
    }

    await page.getByRole('link', { name: 'Overview', exact: true }).click()
    await expect(page).toHaveURL(/\/overview$/)
    const calendar = page.locator('[data-calendar="reui"]')
    await expect(calendar).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New publication', exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-variant', 'inset')
    await expect(page.locator('[data-slot="sidebar-inset"]')).toBeVisible()

    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(50)
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.locator('[data-slot="sidebar-trigger"]').click()
    const workNavigation = page.locator('nav').filter({ has: page.locator('a[href$="/channels"]') })
    await expect(workNavigation).toBeVisible()
    const mobileDrawer = page.locator('[data-slot="sidebar"][data-mobile="true"]')
    await expect(mobileDrawer).toBeVisible()
    await expect(mobileDrawer).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const drawerClose = mobileDrawer.locator('[data-slot="sheet-close"]')
    await expect(drawerClose).toBeVisible()
    await drawerClose.click()
    await expect(workNavigation).toBeHidden()

    await page.locator('[data-slot="sidebar-trigger"]').click()
    await expect(page.locator('[data-sidebar="menu-button"][href$="/channels"]')).toBeVisible()
    await expectNoHorizontalOverflow(page)
})

test('keeps the explicit no-project context on the project picker', async ({ page }) => {
    test.setTimeout(30_000)

    const suffix = randomUUID().slice(0, 8)
    await createAccountAndProject(page, suffix)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'No project selected', exact: true }).click()

    await expect(page).toHaveURL(/\/dashboard\?[^#]*projectId=none/)
    await expect(page.getByRole('heading', { name: 'Select project', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Select project', exact: true })).toHaveText(
        'No project selected'
    )
})

test('keeps a fixed page edge, readable menus and transient action feedback', async ({
    page,
}, info) => {
    test.setTimeout(60_000)
    await createAccountAndProject(page, randomUUID().slice(0, 8))
    await page.setViewportSize({ width: 1280, height: 600 })
    const projectId = new URL(page.url()).pathname.split('/')[3]
    for (let index = 0; index < 12; index += 1) {
        const response = await page.request.post(`/api/projects/${projectId}/channels`, {
            data: {
                name: index === 0 ? 'Menu sizing destination' : `Additional destination ${index}`,
                profile: 'manual-message',
            },
        })
        expect(response.status()).toBe(201)
    }
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    await expect(page.getByRole('heading', { name: 'Channels', exact: true })).toBeVisible()
    const frame = page.locator('[data-dashboard-frame]')
    const edge = page.locator('[data-dashboard-frame-edge]')
    const scroll = page.locator('[data-dashboard-scroll]')
    const before = await edge.boundingBox()
    await scroll.evaluate(element => {
        element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await edge.boundingBox()).toEqual(before)
    await expect(frame).toHaveCSS('overflow', 'hidden')
    await expect(edge).toHaveCSS('pointer-events', 'none')
    await expect(edge).not.toHaveCSS('box-shadow', 'none')
    await page.screenshot({ path: info.outputPath('fixed-edge-scrolled.png') })

    await page.goto(`/dashboard/projects/${projectId}/queue`)
    await page.getByRole('combobox', { name: 'Delivery', exact: true }).click()
    await page.getByRole('option', { name: 'Manual delivery', exact: true }).click()
    await page.getByRole('combobox', { name: 'Delivery', exact: true }).click()
    const options = page.locator('[data-slot="select-content"]')
    await expect(options).toBeVisible()
    for (const option of await page.getByRole('option').all()) {
        const fit = await option.evaluate(element => ({
            visible: element.clientWidth,
            content: element.scrollWidth,
        }))
        expect(fit.content).toBeLessThanOrEqual(fit.visible)
    }
    await page.keyboard.press('Escape')
    await page.goto(`/dashboard/projects/${projectId}/channels`)
    const trigger = page.getByRole('button', {
        name: 'Manage Menu sizing destination',
        exact: true,
    })
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const item = page.getByRole('menuitem', { name: 'Edit profile', exact: true })
    await expect(item).toBeVisible()
    const geometry = await item.evaluate(element => ({
        height: element.clientHeight,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        contentWidth: element.scrollWidth,
        width: element.clientWidth,
    }))
    expect(geometry.height).toBeLessThan(geometry.lineHeight * 2)
    expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.width)
    await page.screenshot({ path: info.outputPath('intrinsic-menu.png') })
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Archive channel', exact: true })
        .click()
    const message = page.locator('[data-slot="toast"]')
    await expect(message).toContainText('“Menu sizing destination” archived')
    await expect(page.getByRole('dialog', { name: 'Archive channel', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('action-toast.png') })
    await page.keyboard.press('F6')
    await message.getByRole('button', { name: 'Dismiss message', exact: true }).click()
    await expect(message).toHaveCount(0)

    for (const width of [768, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await trigger.click()
        await expect(menu).toBeVisible()
        const bounds = await menu.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        await page.keyboard.press('Escape')
        await expectNoHorizontalOverflow(page)
    }
})

async function expectNoHorizontalOverflow(page: Page) {
    const layout = await page.locator('[data-dashboard-scroll]').evaluate(scrollRegion => ({
        clientWidth: (scrollRegion as unknown as { clientWidth: number }).clientWidth,
        scrollWidth: (scrollRegion as unknown as { scrollWidth: number }).scrollWidth,
    }))
    expect(
        layout.scrollWidth,
        'dashboard content should not overflow horizontally'
    ).toBeLessThanOrEqual(layout.clientWidth)
}

async function createAccountAndProject(page: Page, suffix: string): Promise<void> {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('button', { name: 'Set up Herald', exact: true }).click()
    await page.getByLabel('Name').fill(`E2E-121 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-${suffix}@herald.local`)
    await page.getByLabel('Password', { exact: true }).fill('e2e-121-password')
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
        .fill(`E2E-121 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.getByRole('textbox', { name: 'New project', exact: true }) })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}
