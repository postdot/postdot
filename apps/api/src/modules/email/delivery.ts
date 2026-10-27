import type { PostdotAuthEmailOptions, PostdotAuthRuntimeOptions } from '@postdot/auth'
import {
    renderPostdotEmailVerificationEmail,
    renderPostdotOrganizationInvitationEmail,
    renderPostdotPasswordResetEmail,
    type PostdotRenderedEmail,
} from '@postdot/email'
import { createTransport, type SendMailOptions } from 'nodemailer'

export type PostdotEmailKind = 'organization_invitation' | 'email_verification' | 'password_reset'

export interface PostdotSmtpConfig {
    readonly host: string
    readonly port: number
    readonly secure: boolean
    readonly from: string
    readonly username?: string
    readonly password?: string
}

export interface PostdotEmailTransport {
    sendMail(message: SendMailOptions): Promise<unknown>
}

export interface PostdotEmailDeliveryOptions {
    readonly smtp?: PostdotSmtpConfig
    readonly getSmtp?: () => PostdotSmtpConfig | undefined
    readonly webOrigin: string
    readonly transport?: PostdotEmailTransport
    readonly onDeliveryError?: (kind: PostdotEmailKind, error: unknown) => void
}

export type PostdotConfiguredAuthEmailOptions = Pick<
    PostdotAuthRuntimeOptions,
    keyof PostdotAuthEmailOptions | 'organizationInvitationURL' | 'sendOrganizationInvitationEmail'
>

export function createPostdotAuthEmailDelivery(
    options: PostdotEmailDeliveryOptions
): PostdotConfiguredAuthEmailOptions {
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

    const send = (kind: PostdotEmailKind, createMessage: () => Promise<SendMailOptions>): void => {
        if (options.getSmtp && !options.getSmtp()) return
        try {
            void createMessage()
                .then(message =>
                    transport.sendMail({
                        ...message,
                        from: (options.getSmtp?.() ?? options.smtp)?.from ?? message.from,
                    })
                )
                .catch(error => options.onDeliveryError?.(kind, error))
        } catch (error) {
            options.onDeliveryError?.(kind, error)
        }
    }

    return {
        emailDeliveryAvailable:
            options.getSmtp === undefined ? undefined : () => options.getSmtp!() !== undefined,
        organizationInvitationURL: ({ id, organizationId, projectId }) => {
            const url = new URL('/invite', options.webOrigin)
            url.searchParams.set('invitationId', id)
            url.searchParams.set('organizationId', organizationId)
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

            send('organization_invitation', async () =>
                withFrom(
                    (options.getSmtp?.() ?? options.smtp)?.from,
                    await renderPostdotOrganizationInvitationEmail({
                        email: invitation.email,
                        role: invitation.role,
                        organizationName: invitation.organizationName,
                        inviterName: invitation.inviterName,
                        expiresAt: invitation.expiresAt,
                        invitationURL,
                    })
                )
            )
        },
        sendEmailVerification: verification => {
            send('email_verification', async () =>
                withFrom(
                    (options.getSmtp?.() ?? options.smtp)?.from,
                    await renderPostdotEmailVerificationEmail({
                        user: verification.user,
                        url: verification.url,
                    })
                )
            )
        },
        sendEmailVerificationOnSignUp: true,
        sendPasswordResetEmail: reset => {
            send('password_reset', async () =>
                withFrom(
                    (options.getSmtp?.() ?? options.smtp)?.from,
                    await renderPostdotPasswordResetEmail({
                        user: reset.user,
                        url: reset.url,
                    })
                )
            )
        },
    }
}

function withFrom(from: string | undefined, email: PostdotRenderedEmail): SendMailOptions {
    return {
        to: email.to,
        ...(from === undefined ? {} : { from }),
        subject: email.subject,
        text: email.text,
        html: email.html,
    }
}
