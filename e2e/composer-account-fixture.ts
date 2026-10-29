import { randomUUID } from 'node:crypto'

import { expect, type Page } from '@playwright/test'

export async function accounts(page: Page) {
    await page.goto('/')
    const origin = new URL(page.url()).origin
    const suffix = randomUUID()
    const password = 'account-isolation-password'
    const ownerEmail = `owner-${suffix}@example.test`
    const memberEmail = `member-${suffix}@example.test`
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { name: 'Original author', email: ownerEmail, password },
    })
    expect(signup.status()).toBe(200)
    const owner = (await signup.json()).user as { id: string }
    const made = await page.request.post('/api/projects', {
        data: { name: 'Shared recovery desk' },
    })
    expect(made.status()).toBe(201)
    const { project } = await made.json()
    expect(
        (
            await page.request.post(`/api/projects/${project.id}/channels`, {
                data: { name: 'Manual destination' },
            })
        ).status()
    ).toBe(201)
    const browser = page.context().browser()!
    const admin = await browser.newContext({ baseURL: origin })
    const member = await browser.newContext({ baseURL: origin })
    expect(
        (
            await admin.request.post('/api/auth/sign-in/email', {
                data: { email: ownerEmail, password },
            })
        ).status()
    ).toBe(200)
    const invited = await admin.request.post(`/api/projects/${project.id}/invitations`, {
        data: { email: memberEmail, role: 'editor' },
    })
    expect(invited.status()).toBe(201)
    const { invitation } = await invited.json()
    const registered = await member.request.post('/api/auth/sign-up/email', {
        data: { name: 'Second author', email: memberEmail, password },
    })
    expect(registered.status()).toBe(200)
    const second = (await registered.json()).user as { id: string }
    expect(
        (
            await member.request.post('/api/auth/organization/accept-invitation', {
                data: { invitationId: invitation.id },
            })
        ).status()
    ).toBe(200)
    return {
        owner,
        second,
        ownerEmail,
        memberEmail,
        password,
        admin,
        member,
        project,
        url: `/dashboard/projects/${project.id}/publications/new?editor=legacy`,
        endpoint: `/api/projects/${project.id}/publication-composer-draft`,
        close: async () => {
            await admin.close()
            await member.close()
        },
    }
}

export async function login(
    page: Page,
    email: string,
    password: string,
    labels = { email: 'Email', password: 'Password', submit: 'Sign in' }
) {
    await page.getByLabel(labels.email, { exact: true }).fill(email)
    await page.getByLabel(labels.password, { exact: true }).fill(password)
    await page.getByRole('button', { name: labels.submit, exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
}
