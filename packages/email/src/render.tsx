import { render } from '@react-email/render'
import * as React from 'react'

import {
    EmailVerificationEmail,
    emailVerificationSubject,
    type HeraldAccountEmailInput,
} from './templates/EmailVerificationEmail'
import {
    OrganizationInvitationEmail,
    organizationInvitationSubject,
    type HeraldOrganizationInvitationEmailInput,
} from './templates/OrganizationInvitationEmail'
import {
    PasswordResetEmail,
    passwordResetSubject,
    type HeraldPasswordResetEmailInput,
} from './templates/PasswordResetEmail'
import {
    PublicationOutcomeEmail,
    type HeraldPublicationOutcomeEmailInput,
} from './templates/PublicationOutcomeEmail'

export interface HeraldRenderedEmail {
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
}

export async function renderHeraldOrganizationInvitationEmail(
    input: HeraldOrganizationInvitationEmailInput
): Promise<HeraldRenderedEmail> {
    const html = await render(<OrganizationInvitationEmail {...input} />)
    const text = await render(<OrganizationInvitationEmail {...input} />, { plainText: true })

    return {
        to: input.email,
        subject: organizationInvitationSubject(input.organizationName),
        text,
        html,
    }
}

export async function renderHeraldEmailVerificationEmail(
    input: HeraldAccountEmailInput
): Promise<HeraldRenderedEmail> {
    const html = await render(<EmailVerificationEmail {...input} />)
    const text = await render(<EmailVerificationEmail {...input} />, { plainText: true })

    return {
        to: input.user.email,
        subject: emailVerificationSubject,
        text,
        html,
    }
}

export async function renderHeraldPasswordResetEmail(
    input: HeraldPasswordResetEmailInput
): Promise<HeraldRenderedEmail> {
    const html = await render(<PasswordResetEmail {...input} />)
    const text = await render(<PasswordResetEmail {...input} />, { plainText: true })

    return {
        to: input.user.email,
        subject: passwordResetSubject,
        text,
        html,
    }
}

export async function renderHeraldPublicationOutcomeEmail(
    input: HeraldPublicationOutcomeEmailInput
): Promise<HeraldRenderedEmail> {
    return {
        to: input.email,
        subject: `Herald — ${input.title}`,
        html: await render(<PublicationOutcomeEmail {...input} />),
        text: await render(<PublicationOutcomeEmail {...input} />, { plainText: true }),
    }
}
