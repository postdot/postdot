import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('loads publication and tag resources only on the project features that use them', async ({
    page,
}) => {
    const suffix = randomUUID().slice(0, 8)
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: {
            email: `feature-data-${suffix}@postbot.local`,
            name: `Feature data ${suffix}`,
            password: 'feature-data-fixture-password',
        },
    })
    expect(signup.status()).toBe(200)
    const created = await page.request.post('/api/projects', {
        data: { name: `Feature data ${suffix}` },
    })
    expect(created.status()).toBe(201)
    const { project } = (await created.json()) as { project: { id: string } }
    const reads: string[] = []
    page.on('request', request => {
        const path = new URL(request.url()).pathname
        if (request.method() === 'GET' && path.startsWith(`/api/projects/${project.id}/`))
            reads.push(path)
    })
    const publicationReads = () => reads.filter(path => /\/publications(?:\/due)?$/.test(path))
    for (const [route, title] of [
        ['media', en.media_title],
        ['channels', en.channels_title],
    ] as const) {
        reads.length = 0
        await page.goto(`/dashboard/projects/${project.id}/${route}`)
        await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
        expect(publicationReads()).toEqual([])
        expect(reads.filter(path => path.endsWith('/tags'))).toEqual([])
    }
    reads.length = 0
    const tags = page.waitForResponse(
        response =>
            new URL(response.url()).pathname === `/api/projects/${project.id}/tags` && response.ok()
    )
    await page.goto(`/dashboard/projects/${project.id}/tags`)
    await tags
    await expect(
        page.getByRole('heading', { name: en.project_tags_title, exact: true }).first()
    ).toBeVisible()
    expect(publicationReads()).toEqual([])

    reads.length = 0
    const due = page.waitForResponse(
        response =>
            new URL(response.url()).pathname === `/api/projects/${project.id}/publications/due` &&
            response.ok()
    )
    const publications = page.waitForResponse(
        response =>
            new URL(response.url()).pathname === `/api/projects/${project.id}/publications` &&
            response.ok()
    )
    await page.goto(`/dashboard/projects/${project.id}/queue`)
    await Promise.all([due, publications])
    expect(publicationReads()).toContain(`/api/projects/${project.id}/publications`)
    expect(publicationReads()).toContain(`/api/projects/${project.id}/publications/due`)
})
