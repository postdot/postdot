import { Button } from '@react-email/button'
import { Link } from '@react-email/link'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'
import { formatInvitationExpiry, formatInvitationRole } from '../text'
import { HeraldEmailLayout } from './HeraldEmailLayout'

export interface HeraldOrganizationInvitationEmailInput {
    readonly email: string
    readonly role: string
    readonly organizationName: string
    readonly inviterName: string
    readonly expiresAt: Date
    readonly invitationURL: string
}

const subject = (organizationName: string): string =>
    `Invitation to join ${organizationName} on Herald`

export function OrganizationInvitationEmail({
    organizationName,
    inviterName,
    role,
    expiresAt,
    invitationURL,
}: HeraldOrganizationInvitationEmailInput) {
    const formattedRole = formatInvitationRole(role)
    const formattedExpiry = formatInvitationExpiry(expiresAt)

    return (
        <HeraldEmailLayout
            preview={`${inviterName} invited you to join ${organizationName} on Herald`}
            title={subject(organizationName)}>
            <Text style={emailStyles.text}>Hello,</Text>
            <Text style={emailStyles.text}>
                <strong>{inviterName}</strong> invited you to join{' '}
                <strong>{organizationName}</strong> on Herald as {formattedRole}.
            </Text>
            <Text style={emailStyles.action}>
                <Button href={invitationURL} style={emailStyles.button}>
                    Accept invitation
                </Button>
            </Text>
            <Text style={emailStyles.fallback}>
                Or copy and paste this link into your browser:{' '}
                <Link href={invitationURL} style={emailStyles.link}>
                    {invitationURL}
                </Link>
            </Text>
            <Text style={emailStyles.mutedText}>This invitation expires on {formattedExpiry}.</Text>
            <Text style={emailStyles.mutedText}>
                If you were not expecting this invitation, you can ignore this email.
            </Text>
        </HeraldEmailLayout>
    )
}

export { subject as organizationInvitationSubject }
export default OrganizationInvitationEmail
