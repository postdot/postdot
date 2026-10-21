import { PostbotLogo } from '@postdot/ui/components/postbot-logo'
import { Body } from '@react-email/body'
import { Container } from '@react-email/container'
import { Font } from '@react-email/font'
import { Head } from '@react-email/head'
import { Heading } from '@react-email/heading'
import { Html } from '@react-email/html'
import { Preview } from '@react-email/preview'
import { Section } from '@react-email/section'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'

export interface PostbotEmailLayoutProps {
    readonly preview: string
    readonly title: string
    readonly children: React.ReactNode
}

export function PostbotEmailLayout({ preview, title, children }: PostbotEmailLayoutProps) {
    return (
        <Html lang="en">
            <Head>
                <Font
                    fontFamily="Recursive Variable"
                    fallbackFontFamily={['Arial', 'Helvetica', 'sans-serif']}
                    fontWeight="300 900"
                    webFont={{
                        format: 'woff2',
                        url: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/recursive@5.3.0/files/recursive-latin-wght-normal.woff2',
                    }}
                />
            </Head>
            <Preview>{preview}</Preview>
            <Body style={emailStyles.body}>
                <Container style={emailStyles.container}>
                    <Section style={emailStyles.panel}>
                        <Section style={emailStyles.brandHeader}>
                            <table role="presentation" cellPadding="0" cellSpacing="0">
                                <tbody>
                                    <tr>
                                        <td style={emailStyles.brandLogoCell}>
                                            <PostbotLogo
                                                aria-label="Postdot"
                                                height="30"
                                                style={{ color: '#426bce', display: 'block' }}
                                                width="30"
                                            />
                                        </td>
                                        <td style={emailStyles.brandWordmarkCell}>
                                            <Text style={emailStyles.brandWordmark}>Postdot</Text>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </Section>
                        <Section style={emailStyles.content}>
                            <Heading style={emailStyles.title}>{title}</Heading>
                            {children}
                        </Section>
                    </Section>
                    <Text style={emailStyles.footer}>Postdot · Publication manager</Text>
                </Container>
            </Body>
        </Html>
    )
}
