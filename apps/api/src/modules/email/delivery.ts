import type {
    HeraldAuthEmailOptions,
    HeraldAuthVerificationEmail,
    HeraldOrganizationInvitationEmail,
    HeraldAuthRuntimeOptions,
} from '@herald/auth'
import { createTransport, type SendMailOptions } from 'nodemailer'

export type HeraldEmailKind = 'organization_invitation' | 'email_verification' | 'password_reset'

export interface HeraldSmtpConfig {
    readonly host: string
    readonly port: number
    readonly secure: boolean
    readonly from: string
    readonly username?: string
    readonly password?: string
}

export interface HeraldEmailTransport {
    sendMail(message: SendMailOptions): Promise<unknown>
}

export interface HeraldEmailDeliveryOptions {
    readonly smtp?: HeraldSmtpConfig
    readonly webOrigin: string
    readonly getProjectIdForOrganization?: (organizationId: string) => string | null
    readonly transport?: HeraldEmailTransport
    readonly onDeliveryError?: (kind: HeraldEmailKind, error: unknown) => void
}

export type HeraldConfiguredAuthEmailOptions = Pick<
    HeraldAuthRuntimeOptions,
    keyof HeraldAuthEmailOptions | 'organizationInvitationURL' | 'sendOrganizationInvitationEmail'
>

interface RenderedEmail {
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
}

type RenderedInvitationInput = HeraldOrganizationInvitationEmail & {
    readonly invitationURL: string
}

export function createHeraldAuthEmailDelivery(
    options: HeraldEmailDeliveryOptions
): HeraldConfiguredAuthEmailOptions {
    if (options.smtp === undefined && options.transport === undefined) return {}

    const transport =
        options.transport ??
        createTransport({
            host: options.smtp!.host,
            port: options.smtp!.port,
            secure: options.smtp!.secure,
            ...(options.smtp!.username === undefined
                ? {}
                : {
                      auth: {
                          user: options.smtp!.username,
                          pass: options.smtp!.password!,
                      },
                  }),
        })

    const send = (kind: HeraldEmailKind, message: SendMailOptions): void => {
        try {
            void Promise.resolve(
                transport.sendMail({
                    ...message,
                    from: options.smtp?.from ?? message.from,
                })
            ).catch(error => options.onDeliveryError?.(kind, error))
        } catch (error) {
            options.onDeliveryError?.(kind, error)
        }
    }

    return {
        organizationInvitationURL: ({ id, organizationId }) => {
            const url = new URL('/dashboard/settings/access', options.webOrigin)
            url.searchParams.set('organizationInvitation', id)
            const projectId = options.getProjectIdForOrganization?.(organizationId)
            if (projectId !== null && projectId !== undefined) {
                url.searchParams.set('projectId', projectId)
            }
            return url.toString()
        },
        sendOrganizationInvitationEmail: invitation => {
            const invitationURL = invitation.invitationURL
            if (invitationURL === undefined) {
                options.onDeliveryError?.(
                    'organization_invitation',
                    new Error('An invitation URL is required for email delivery')
                )
                return
            }

            send(
                'organization_invitation',
                withFrom(
                    options.smtp?.from,
                    renderInvitationEmail({ ...invitation, invitationURL })
                )
            )
        },
        sendEmailVerification: verification => {
            send(
                'email_verification',
                withFrom(options.smtp?.from, renderVerificationEmail(verification))
            )
        },
        sendEmailVerificationOnSignUp: true,
        sendPasswordResetEmail: reset => {
            send('password_reset', withFrom(options.smtp?.from, renderPasswordResetEmail(reset)))
        },
    }
}

function withFrom(from: string | undefined, email: RenderedEmail): SendMailOptions {
    return {
        to: email.to,
        ...(from === undefined ? {} : { from }),
        subject: email.subject,
        text: email.text,
        html: email.html,
    }
}

function renderInvitationEmail(input: RenderedInvitationInput): RenderedEmail {
    const greeting = 'Hello'
    const role = formatRole(input.role)
    const expiresAt = formatExpiry(input.expiresAt)
    const title = `Invitation to join ${input.organizationName} on Herald`
    const text = [
        `${greeting},`,
        '',
        `${input.inviterName} invited you to join ${input.organizationName} on Herald as ${role}.`,
        '',
        `Open this link to accept the invitation: ${input.invitationURL}`,
        '',
        `This invitation expires on ${expiresAt}.`,
        '',
        'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n')

    return {
        to: input.email,
        subject: title,
        text,
        html: renderHtmlEmail({
            title,
            greeting,
            body: [
                `${escapeHtml(input.inviterName)} invited you to join ${escapeHtml(input.organizationName)} on Herald as ${escapeHtml(role)}.`,
                `This invitation expires on ${escapeHtml(expiresAt)}.`,
            ],
            action: { label: 'Accept invitation', url: input.invitationURL },
            footer: 'If you were not expecting this invitation, you can ignore this email.',
        }),
    }
}

function renderVerificationEmail(input: HeraldAuthVerificationEmail): RenderedEmail {
    const title = 'Verify your Herald email address'
    const greeting = `Hello ${input.user.name}`
    const text = [
        `${greeting},`,
        '',
        'Confirm your email address to finish setting up your Herald account.',
        '',
        `Open this link to verify your email: ${input.url}`,
        '',
        'This link expires after one hour.',
    ].join('\n')

    return {
        to: input.user.email,
        subject: title,
        text,
        html: renderHtmlEmail({
            title,
            greeting,
            body: ['Confirm your email address to finish setting up your Herald account.'],
            action: { label: 'Verify email address', url: input.url },
            footer: 'This link expires after one hour.',
        }),
    }
}

function renderPasswordResetEmail(input: HeraldAuthVerificationEmail): RenderedEmail {
    const title = 'Reset your Herald password'
    const greeting = `Hello ${input.user.name}`
    const text = [
        `${greeting},`,
        '',
        'A password reset was requested for your Herald account.',
        '',
        `Open this link to choose a new password: ${input.url}`,
        '',
        'This link expires after one hour. If you did not request this, you can ignore this email.',
    ].join('\n')

    return {
        to: input.user.email,
        subject: title,
        text,
        html: renderHtmlEmail({
            title,
            greeting,
            body: ['A password reset was requested for your Herald account.'],
            action: { label: 'Reset password', url: input.url },
            footer: 'This link expires after one hour. If you did not request this, you can ignore this email.',
        }),
    }
}

function renderHtmlEmail(input: {
    readonly title: string
    readonly greeting: string
    readonly body: readonly string[]
    readonly action: { readonly label: string; readonly url: string }
    readonly footer: string
}): string {
    return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f5f5f4;color:#1c1917;font-family:Arial,sans-serif;line-height:1.5">
    <div style="max-width:560px;margin:32px auto;padding:32px;background:#ffffff">
      <p style="margin:0 0 24px;color:#2563eb;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Herald</p>
      <h1 style="margin:0 0 20px;font-size:24px;line-height:1.2">${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.greeting)},</p>
      ${input.body.map(paragraph => `<p>${paragraph}</p>`).join('')}
      <p style="margin:28px 0">
        <a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(input.action.label)}</a>
      </p>
      <p style="color:#57534e;font-size:14px">${escapeHtml(input.footer)}</p>
    </div>
  </body>
</html>`
}

function formatRole(role: string): string {
    const roles = role
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    if (roles.length === 0) return 'a project member'
    return roles.join(' and ')
}

function formatExpiry(value: Date): string {
    return new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(value)
}

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        character =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character] ?? character
    )
}
