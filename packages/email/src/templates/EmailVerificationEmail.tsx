import { Button } from '@react-email/button'
import { Link } from '@react-email/link'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'
import { PostbotEmailLayout } from './PostbotEmailLayout'

export interface PostbotAccountEmailInput {
    readonly user: {
        readonly email: string
        readonly name: string
    }
    readonly url: string
}

export const emailVerificationSubject = 'Verify your Postdot email address'

export function EmailVerificationEmail({ user, url }: PostbotAccountEmailInput) {
    return (
        <PostbotEmailLayout
            preview="Confirm your email address to finish setting up your Postdot account."
            title={emailVerificationSubject}>
            <Text style={emailStyles.text}>Hello {user.name},</Text>
            <Text style={emailStyles.text}>
                Confirm your email address to finish setting up your Postdot account.
            </Text>
            <Text style={emailStyles.action}>
                <Button href={url} style={emailStyles.button}>
                    Verify email address
                </Button>
            </Text>
            <Text style={emailStyles.fallback}>
                Or copy and paste this link into your browser:{' '}
                <Link href={url} style={emailStyles.link}>
                    {url}
                </Link>
            </Text>
            <Text style={emailStyles.notice}>This link expires after one hour.</Text>
        </PostbotEmailLayout>
    )
}

const previewProps: PostbotAccountEmailInput = {
    user: {
        email: 'preview@example.test',
        name: 'Alex Martin',
    },
    url: 'http://localhost:5173/auth/verify-email?token=preview-token',
}

export default function EmailVerificationEmailPreview() {
    return <EmailVerificationEmail {...previewProps} />
}
