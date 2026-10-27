import { render } from '@react-email/render'
import * as React from 'react'

import {
    EmailVerificationEmail,
    emailVerificationSubject,
    type PostdotAccountEmailInput,
} from './templates/EmailVerificationEmail'
import {
    OrganizationInvitationEmail,
    organizationInvitationSubject,
    type PostdotOrganizationInvitationEmailInput,
} from './templates/OrganizationInvitationEmail'
import {
    PasswordResetEmail,
    passwordResetSubject,
    type PostdotPasswordResetEmailInput,
} from './templates/PasswordResetEmail'
import {
    PublicationOutcomeEmail,
    type PostdotPublicationOutcomeEmailInput,
} from './templates/PublicationOutcomeEmail'

export interface PostdotRenderedEmail {
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
}

export async function renderPostdotOrganizationInvitationEmail(
    input: PostdotOrganizationInvitationEmailInput
): Promise<PostdotRenderedEmail> {
    const html = await render(<OrganizationInvitationEmail {...input} />)
    const text = await render(<OrganizationInvitationEmail {...input} />, { plainText: true })

    return {
        to: input.email,
        subject: organizationInvitationSubject(input.organizationName),
        text,
        html,
    }
}

export async function renderPostdotEmailVerificationEmail(
    input: PostdotAccountEmailInput
): Promise<PostdotRenderedEmail> {
    const html = await render(<EmailVerificationEmail {...input} />)
    const text = await render(<EmailVerificationEmail {...input} />, { plainText: true })

    return {
        to: input.user.email,
        subject: emailVerificationSubject,
        text,
        html,
    }
}

export async function renderPostdotPasswordResetEmail(
    input: PostdotPasswordResetEmailInput
): Promise<PostdotRenderedEmail> {
    const html = await render(<PasswordResetEmail {...input} />)
    const text = await render(<PasswordResetEmail {...input} />, { plainText: true })

    return {
        to: input.user.email,
        subject: passwordResetSubject,
        text,
        html,
    }
}

export async function renderPostdotPublicationOutcomeEmail(
    input: PostdotPublicationOutcomeEmailInput
): Promise<PostdotRenderedEmail> {
    return {
        to: input.email,
        subject: `Postdot — ${input.title}`,
        html: await render(<PublicationOutcomeEmail {...input} />),
        text: await render(<PublicationOutcomeEmail {...input} />, { plainText: true }),
    }
}
