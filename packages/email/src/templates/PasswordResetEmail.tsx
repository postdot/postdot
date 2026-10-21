import { Button } from '@react-email/button'
import { Link } from '@react-email/link'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'
import { PostbotEmailLayout } from './PostbotEmailLayout'

export interface PostbotPasswordResetEmailInput {
    readonly user: {
        readonly email: string
        readonly name: string
    }
    readonly url: string
}

export const passwordResetSubject = 'Reset your Postdot password'

export function PasswordResetEmail({ user, url }: PostbotPasswordResetEmailInput) {
    return (
        <PostbotEmailLayout
            preview="A password reset was requested for your Postdot account."
            title={passwordResetSubject}>
            <Text style={emailStyles.text}>Hello {user.name},</Text>
            <Text style={emailStyles.text}>
                A password reset was requested for your Postdot account.
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
        </PostbotEmailLayout>
    )
}

const previewProps: PostbotPasswordResetEmailInput = {
    user: {
        email: 'preview@example.test',
        name: 'Alex Martin',
    },
    url: 'http://localhost:5173/reset-password?token=preview-token',
}

export default function PasswordResetEmailPreview() {
    return <PasswordResetEmail {...previewProps} />
}
