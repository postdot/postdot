import { describe, expect, it } from 'bun:test'

import type { SendMailOptions } from 'nodemailer'

import { createHeraldAuthEmailDelivery, type HeraldEmailTransport } from './delivery'

describe('Herald auth email delivery', () => {
    it('renders invitation, verification, and reset emails through an injected transport', async () => {
        const sent: SendMailOptions[] = []
        const transport: HeraldEmailTransport = {
            sendMail: async message => {
                sent.push(message)
            },
        }
        const delivery = createHeraldAuthEmailDelivery({
            transport,
            webOrigin: 'https://app.example.test',
            getProjectIdForOrganization: organizationId =>
                organizationId === 'organization-1' ? 'project-1' : null,
            smtp: {
                host: 'smtp.example.test',
                port: 587,
                secure: true,
                from: 'Herald <no-reply@example.test>',
            },
        })
        const invitationURL = delivery.organizationInvitationURL?.({
            id: 'invitation-1',
            organizationId: 'organization-1',
        })

        delivery.sendOrganizationInvitationEmail?.({
            id: 'invitation-1',
            email: 'member@example.test',
            role: 'viewer',
            organizationId: 'organization-1',
            organizationName: 'Project <one>',
            inviterId: 'owner-1',
            inviterEmail: 'owner@example.test',
            inviterName: 'Project Owner',
            expiresAt: new Date('2026-09-18T12:00:00.000Z'),
            invitationURL,
        })
        delivery.sendEmailVerification?.({
            user: { email: 'member@example.test', name: 'Member <one>' },
            url: 'https://api.example.test/api/auth/verify-email?token=verification-1',
            token: 'verification-1',
        })
        delivery.sendPasswordResetEmail?.({
            user: { email: 'member@example.test', name: 'Member <one>' },
            url: 'https://api.example.test/api/auth/reset-password/reset-1',
            token: 'reset-1',
        })
        await Promise.resolve()

        expect(invitationURL).toBe(
            'https://app.example.test/dashboard/settings/access?organizationInvitation=invitation-1&projectId=project-1'
        )
        expect(delivery.sendEmailVerificationOnSignUp).toBe(true)
        expect(sent).toHaveLength(3)
        expect(sent[0]).toMatchObject({
            from: 'Herald <no-reply@example.test>',
            to: 'member@example.test',
            subject: 'Invitation to join Project <one> on Herald',
        })
        expect(sent[0]?.text).toContain(invitationURL)
        expect(sent[0]?.html).toContain('Project &lt;one&gt;')
        expect(sent[1]).toMatchObject({
            subject: 'Verify your Herald email address',
            to: 'member@example.test',
        })
        expect(sent[2]).toMatchObject({
            subject: 'Reset your Herald password',
            to: 'member@example.test',
        })
    })

    it('stays disabled without a configured transport', () => {
        expect(createHeraldAuthEmailDelivery({ webOrigin: 'http://localhost:5173' })).toEqual({})
    })

    it('reports transport failures without failing the auth request', async () => {
        const failures: string[] = []
        const delivery = createHeraldAuthEmailDelivery({
            transport: {
                sendMail: async () => {
                    throw new Error('SMTP unavailable')
                },
            },
            webOrigin: 'http://localhost:5173',
            onDeliveryError: (kind, error) => {
                failures.push(`${kind}:${error instanceof Error ? error.message : 'unknown'}`)
            },
        })

        delivery.sendEmailVerification?.({
            user: { email: 'member@example.test', name: 'Member' },
            url: 'http://localhost:3000/api/auth/verify-email?token=verification-1',
            token: 'verification-1',
        })
        await Promise.resolve()
        await Promise.resolve()

        expect(failures).toEqual(['email_verification:SMTP unavailable'])
    })
})
