import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import en from '../../apps/web/messages/en.json' with { type: 'json' }
import fr from '../../apps/web/messages/fr.json' with { type: 'json' }

for (const [locale, copy, theme] of [
    ['en', en, 'dark'],
    ['fr', fr, 'light'],
] as const) {
    test(`recovers invitation preview failures without declaring a valid link invalid in ${locale}`, async ({
        page,
    }, info) => {
        await page.addInitScript(
            ({ locale, theme }) => {
                localStorage.setItem('PARAGLIDE_LOCALE', locale)
                localStorage.setItem('postdot-theme', theme)
            },
            { locale, theme }
        )
        const signup = await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Invitation reviewer',
                email: `invite-${randomUUID()}@example.test`,
                password: 'invitation-review-password',
            },
        })
        expect(signup.status()).toBe(200)
        const projectResponse = await page.request.post('/api/projects', {
            data: { name: 'Invitation desk', timeZone: 'Europe/Paris' },
        })
        expect(projectResponse.status()).toBe(201)
        const { project } = (await projectResponse.json()) as { project: { id: string } }
        await page.goto(`/dashboard/projects/${project.id}/invitations`)
        await expect(
            page.getByRole('heading', { name: copy.access_project_invitations_title, exact: true })
        ).toBeVisible()
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            await expect(
                page.getByRole('button', { name: copy.nav_back_to_project, exact: true })
            ).toHaveCount(1)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath(`project-invitations-${width}.png`) })
        }
        const made = await page.request.post('/api/access/invitations', {
            data: { targetEmail: `recipient-${randomUUID()}@example.test` },
        })
        expect(made.status()).toBe(201)
        const invitation = (await made.json()) as { token: string; invitation: { id: string } }
        expect(invitation.token).toBeTruthy()
        const endpoint = `**/api/access/invitations/${invitation.token}`
        await page.route(endpoint, route =>
            route.fulfill({
                status: 503,
                json: {
                    error: { code: 'service_unavailable', message: 'Temporarily unavailable' },
                },
            })
        )
        await page.goto(`/invite?token=${invitation.token}`)
        await expect(
            page.getByRole('heading', { name: copy.common_error_title, exact: true })
        ).toBeVisible()
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
            ).toBe(false)
            expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
            await page.screenshot({ path: info.outputPath(`preview-error-${width}.png`) })
        }
        await page.unroute(endpoint)
        await page.getByRole('button', { name: copy.common_retry, exact: true }).click()
        await expect(
            page.getByRole('button', { name: copy.access_accept_invitation_button, exact: true })
        ).toBeVisible()
        const revoked = await page.request.delete(
            `/api/access/invitations/${invitation.invitation.id}`
        )
        expect(revoked.status()).toBe(200)
        await page.reload()
        await expect(
            page.getByRole('heading', { name: copy.auth_invitation_invalid_title, exact: true })
        ).toBeVisible()
        await expect(
            page.getByRole('button', { name: copy.common_retry, exact: true })
        ).toHaveCount(0)
        await expect(
            page.getByRole('link', { name: copy.auth_back_to_sign_in, exact: true })
        ).toBeVisible()
        await page.screenshot({ path: info.outputPath('revoked-invitation.png') })
        const expiring = await page.request.post('/api/access/invitations', {
            data: {
                targetEmail: `expired-${randomUUID()}@example.test`,
                expiresAt: Date.now() + 1500,
            },
        })
        expect(expiring.status()).toBe(201)
        const expired = (await expiring.json()) as { token: string }
        await expect
            .poll(async () =>
                (await page.request.get(`/api/access/invitations/${expired.token}`)).status()
            )
            .toBe(404)
        await page.goto(`/invite?token=${expired.token}`)
        await expect(
            page.getByRole('heading', { name: copy.auth_invitation_invalid_title, exact: true })
        ).toBeVisible()
        await expect(
            page.getByRole('button', { name: copy.common_retry, exact: true })
        ).toHaveCount(0)
        await page.screenshot({ path: info.outputPath('expired-invitation.png') })
        await page.goto('/invite?token=unknown-invitation')
        await expect(
            page.getByRole('heading', { name: copy.auth_invitation_invalid_title, exact: true })
        ).toBeVisible()
        await page.goto('/invite')
        await expect(
            page.getByRole('heading', { name: copy.auth_invitation_invalid_title, exact: true })
        ).toBeVisible()
    })
}

for (const kind of ['instance', 'organization'] as const) {
    test(`retries ${kind} invitation session discovery after a temporary failure`, async ({
        page,
    }) => {
        await page.request.post('/api/auth/sign-up/email', {
            data: {
                name: 'Session reviewer',
                email: `session-${randomUUID()}@example.test`,
                password: 'invitation-review-password',
            },
        })
        let path = '/invite?invitationId=session-review'
        if (kind === 'instance') {
            const response = await page.request.post('/api/access/invitations', {
                data: { targetEmail: `session-recipient-${randomUUID()}@example.test` },
            })
            expect(response.status()).toBe(201)
            const { token } = (await response.json()) as { token: string }
            path = `/invite?token=${token}`
        }
        await page.route('**/api/auth/get-session', route =>
            route.fulfill({ status: 503, json: { error: 'temporary_failure' } })
        )
        await page.goto(path)
        await expect(
            page.getByRole('heading', { name: en.common_error_title, exact: true })
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(
            0
        )
        await page.unroute('**/api/auth/get-session')
        await page.getByRole('button', { name: en.common_retry, exact: true }).click()
        await expect(
            page.getByRole('button', {
                name:
                    kind === 'instance'
                        ? en.access_accept_invitation_button
                        : en.access_workspace_invitation_accept_button,
                exact: true,
            })
        ).toBeVisible()
        // This organization fixture only checks session discovery, never acceptance.
    })
}
