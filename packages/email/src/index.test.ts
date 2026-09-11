import { describe, expect, it } from 'bun:test'

import { render } from '@react-email/render'

import {
    renderHeraldEmailVerificationEmail,
    renderHeraldOrganizationInvitationEmail,
    renderHeraldPasswordResetEmail,
} from './index'
import EmailVerificationEmailPreview from './templates/EmailVerificationEmail'
import OrganizationInvitationEmailPreview from './templates/OrganizationInvitationEmail'
import PasswordResetEmailPreview from './templates/PasswordResetEmail'

describe('Herald email templates', () => {
    it('renders a safe invitation with HTML and plain-text alternatives', async () => {
        const result = await renderHeraldOrganizationInvitationEmail({
            email: 'member@example.test',
            role: 'viewer',
            organizationName: 'Project <one>',
            inviterName: 'Project Owner & team',
            expiresAt: new Date('2026-09-18T12:00:00.000Z'),
            invitationURL: 'https://app.example.test/invite?id=one&source=email',
        })

        expect(result.to).toBe('member@example.test')
        expect(result.subject).toBe('Invitation to join Project <one> on Herald')
        expect(result.html).toContain('Project &lt;one&gt;')
        expect(result.html).toContain('Project Owner &amp; team')
        expect(result.html).toContain('Recursive Variable')
        expect(result.html).toContain('viewBox="0 0 189 189"')
        expect(result.html).toContain('border-radius:6px')
        expect(result.html).toContain('0 2px 4px rgba(24, 24, 27, 0.04)')
        expect(result.html).not.toContain('background-color:#121210')
        expect(result.html).toContain(
            'href="https://app.example.test/invite?id=one&amp;source=email"'
        )
        expect(result.text).toContain('INVITATION TO JOIN PROJECT <ONE> ON HERALD')
        expect(result.text).toContain('https://app.example.test/invite?id=one&source=email')
    })

    it('renders account verification and reset subjects and actions', async () => {
        const [verification, reset] = await Promise.all([
            renderHeraldEmailVerificationEmail({
                user: { email: 'member@example.test', name: 'Member' },
                url: 'https://api.example.test/verify?token=verification-1',
            }),
            renderHeraldPasswordResetEmail({
                user: { email: 'member@example.test', name: 'Member' },
                url: 'https://api.example.test/reset?token=reset-1',
            }),
        ])

        expect(verification.subject).toBe('Verify your Herald email address')
        expect(verification.html).toContain('Verify email address')
        expect(verification.text).toContain('https://api.example.test/verify?token=verification-1')
        expect(reset.subject).toBe('Reset your Herald password')
        expect(reset.html).toContain('Reset password')
        expect(reset.text).toContain('https://api.example.test/reset?token=reset-1')
    })

    it('renders preview entrypoints without runtime props', async () => {
        const [verification, invitation, reset] = await Promise.all([
            render(EmailVerificationEmailPreview()),
            render(OrganizationInvitationEmailPreview()),
            render(PasswordResetEmailPreview()),
        ])

        expect(verification).toContain('Alex Martin')
        expect(invitation).toContain('Herald Studio')
        expect(invitation).toContain('Accept invitation')
        expect(reset).toContain('Reset your Herald password')
    })
})
