import { render } from '@react-email/render'
import * as React from 'react'

import {
    EmailVerificationEmail,
    emailVerificationSubject,
    type PostbotAccountEmailInput,
} from './templates/EmailVerificationEmail'
import {
    OrganizationInvitationEmail,
    organizationInvitationSubject,
    type PostbotOrganizationInvitationEmailInput,
} from './templates/OrganizationInvitationEmail'
import {
    PasswordResetEmail,
    passwordResetSubject,
    type PostbotPasswordResetEmailInput,
} from './templates/PasswordResetEmail'
import {
    PublicationOutcomeEmail,
    type PostbotPublicationOutcomeEmailInput,
} from './templates/PublicationOutcomeEmail'

export interface PostbotRenderedEmail {
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
}

export async function renderPostbotOrganizationInvitationEmail(
    input: PostbotOrganizationInvitationEmailInput
): Promise<PostbotRenderedEmail> {
    const html = await render(<OrganizationInvitationEmail {...input} />)
    const text = await render(<OrganizationInvitationEmail {...input} />, { plainText: true })

    return {
        to: input.email,
        subject: organizationInvitationSubject(input.organizationName),
        text,
        html,
    }
}

export async function renderPostbotEmailVerificationEmail(
    input: PostbotAccountEmailInput
): Promise<PostbotRenderedEmail> {
    const html = await render(<EmailVerificationEmail {...input} />)
    const text = await render(<EmailVerificationEmail {...input} />, { plainText: true })

    return {
        to: input.user.email,
        subject: emailVerificationSubject,
        text,
        html,
    }
}

export async function renderPostbotPasswordResetEmail(
    input: PostbotPasswordResetEmailInput
): Promise<PostbotRenderedEmail> {
    const html = await render(<PasswordResetEmail {...input} />)
    const text = await render(<PasswordResetEmail {...input} />, { plainText: true })

    return {
        to: input.user.email,
        subject: passwordResetSubject,
        text,
        html,
    }
}

export async function renderPostbotPublicationOutcomeEmail(
    input: PostbotPublicationOutcomeEmailInput
): Promise<PostbotRenderedEmail> {
    return {
        to: input.email,
        subject: `Postbot — ${input.title}`,
        html: await render(<PublicationOutcomeEmail {...input} />),
        text: await render(<PublicationOutcomeEmail {...input} />, { plainText: true }),
    }
}
