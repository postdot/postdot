import { Button } from '@react-email/button'
import { Link } from '@react-email/link'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'
import { HeraldEmailLayout } from './HeraldEmailLayout'

export interface HeraldPasswordResetEmailInput {
    readonly user: {
        readonly email: string
        readonly name: string
    }
    readonly url: string
}

export const passwordResetSubject = 'Reset your Herald password'

export function PasswordResetEmail({ user, url }: HeraldPasswordResetEmailInput) {
    return (
        <HeraldEmailLayout
            preview="A password reset was requested for your Herald account."
            title={passwordResetSubject}>
            <Text style={emailStyles.text}>Hello {user.name},</Text>
            <Text style={emailStyles.text}>
                A password reset was requested for your Herald account.
            </Text>
            <Text style={emailStyles.action}>
                <Button href={url} style={emailStyles.button}>
                    Reset password
                </Button>
            </Text>
            <Text style={emailStyles.fallback}>
                Or copy and paste this link into your browser:{' '}
                <Link href={url} style={emailStyles.link}>
                    {url}
                </Link>
            </Text>
            <Text style={emailStyles.notice}>
                This link expires after one hour. If you did not request this, you can ignore this
                email.
            </Text>
        </HeraldEmailLayout>
    )
}

const previewProps: HeraldPasswordResetEmailInput = {
    user: {
        email: 'preview@example.test',
        name: 'Alex Martin',
    },
    url: 'http://localhost:5173/reset-password?token=preview-token',
}

export default function PasswordResetEmailPreview() {
    return <PasswordResetEmail {...previewProps} />
}
