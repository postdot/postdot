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
    await expect(collapsedSidebar).toHaveCSS('width', '64px')
    const collapsedSidebarBox = await collapsedSidebar.boundingBox()
    const compactLogoBox = await page.locator('a[aria-label="Herald workspace"]').boundingBox()
    if (collapsedSidebarBox === null || compactLogoBox === null) {
        throw new Error('Expected the compact sidebar and its logo to be visible')
    }
    expect(compactLogoBox.x + compactLogoBox.width / 2).toBeCloseTo(
        collapsedSidebarBox.x + collapsedSidebarBox.width / 2,
        0
    )
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
    expect(collapsedShell.scrollLeft).toBe(collapsedShell.innerRight)

    for (const label of ['Queue', 'Access']) {
        const link = page.getByRole('link', { name: label, exact: true })
        const box = await link.boundingBox()
        if (box === null) throw new Error(`Expected the collapsed ${label} link to be visible`)
        expect(Math.round(box.x)).toBe(8)
        expect(Math.round(box.width)).toBe(48)

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
        ['Access', 'access'],
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
    await expect(calendar).toBeVisible()
    await expect(calendar.locator('[data-calendar-view="month"]')).toBeVisible()
    await expect(calendar.locator('[data-slot="event-calendar-month-view"]')).toBeVisible()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-variant', 'inset')
    await expect(page.locator('[data-slot="sidebar-inset"]')).toBeVisible()

    await page.getByRole('button', { name: 'Switch language to French', exact: true }).click()
    await page.getByRole('menuitem', { name: 'French', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(50)
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page
        .getByRole('button', {
            name: 'Afficher ou masquer la navigation de l’espace de travail',
            exact: true,
        })
        .click()
    await expect(
        page.getByRole('navigation', { name: 'Navigation du travail', exact: true })
    ).toBeVisible()
    const mobileDrawer = page.locator('[data-slot="sidebar"][data-mobile="true"]')
    await expect(mobileDrawer).toBeVisible()
    await expect(mobileDrawer).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.getByRole('button', { name: 'Fermer', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fermer', exact: true }).click()
    await expect(
        page.getByRole('navigation', { name: 'Navigation du travail', exact: true })
    ).toBeHidden()

    await page
        .getByRole('button', {
            name: 'Afficher ou masquer la navigation de l’espace de travail',
            exact: true,
        })
        .click()
    await expect(
        page.getByRole('button', { name: 'Nouvelle publication', exact: true })
    ).toBeVisible()

    await page.getByRole('button', { name: 'Nouvelle publication', exact: true }).click()
    await expect(page).toHaveURL(/\/publications\/new$/)
    await expectNoHorizontalOverflow(page)
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
    await page.getByRole('button', { name: 'Need an account?' }).click()
    await page.getByLabel('Name').fill(`E2E-121 ${suffix}`)
    await page.getByLabel('Email').fill(`e2e-121-${suffix}@herald.local`)
    await page.getByLabel('Password').fill('e2e-121-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/)

    await page.getByRole('combobox', { name: 'Select project', exact: true }).click()
    await page.getByRole('option', { name: 'Create project', exact: true }).click()
    await page.locator('#new-project').fill(`E2E-121 project ${suffix}`)
    await page
        .locator('form')
        .filter({ has: page.locator('#new-project') })
        .getByRole('button', { name: 'Add project', exact: true })
        .click()
    await expect(page).toHaveURL(/\/dashboard\/projects\/[^/]+\/overview$/)
}
