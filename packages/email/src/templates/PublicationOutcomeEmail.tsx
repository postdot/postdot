import { Button } from '@react-email/button'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'
import { PostdotEmailLayout } from './PostdotEmailLayout'

export interface PostdotPublicationOutcomeEmailInput {
    readonly email: string
    readonly title: string
    readonly body: string
    readonly url: string
}

export function PublicationOutcomeEmail({ title, body, url }: PostdotPublicationOutcomeEmailInput) {
    return (
        <PostdotEmailLayout preview={title} title={title}>
            <Text style={emailStyles.text}>{body}</Text>
            <Text style={emailStyles.action}>
                <Button href={url} style={emailStyles.button}>
                    Open publication
                </Button>
            </Text>
            <Text style={emailStyles.notice}>
                You enabled outcome emails for this project. Manage them in Postdot notification
                preferences.
            </Text>
        </PostdotEmailLayout>
    )
}
