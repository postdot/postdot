import { describe, expect, it } from 'bun:test'

import type { SendMailOptions } from 'nodemailer'

import { createHeraldAuthEmailDelivery, type HeraldEmailTransport } from './delivery'

async function waitForDelivery(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (condition()) return
        await Bun.sleep(1)
    }
    throw new Error('Timed out waiting for email delivery')
}

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
        await waitForDelivery(() => sent.length === 3)

        expect(invitationURL).toBe(
            'https://app.example.test/dashboard/settings/access?organizationInvitation=invitation-1&projectId=project-1'
        )
        expect(delivery.sendEmailVerificationOnSignUp).toBe(true)
        expect(sent).toHaveLength(3)
        const invitationMessage = sent.find(
            message => message.subject === 'Invitation to join Project <one> on Herald'
        )
        const verificationMessage = sent.find(
            message => message.subject === 'Verify your Herald email address'
        )
        const resetMessage = sent.find(message => message.subject === 'Reset your Herald password')

        expect(invitationMessage).toMatchObject({
            from: 'Herald <no-reply@example.test>',
            to: 'member@example.test',
            subject: 'Invitation to join Project <one> on Herald',
        })
        expect(invitationMessage?.text).toContain(invitationURL)
        expect(invitationMessage?.html).toContain('Project &lt;one&gt;')
        expect(verificationMessage).toMatchObject({
            subject: 'Verify your Herald email address',
            to: 'member@example.test',
        })
        expect(resetMessage).toMatchObject({
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
        await waitForDelivery(() => failures.length === 1)

        expect(failures).toEqual(['email_verification:SMTP unavailable'])
    })
})
