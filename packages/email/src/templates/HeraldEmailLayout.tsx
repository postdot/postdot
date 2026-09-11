import { Body } from '@react-email/body'
import { Container } from '@react-email/container'
import { Head } from '@react-email/head'
import { Heading } from '@react-email/heading'
import { Html } from '@react-email/html'
import { Preview } from '@react-email/preview'
import { Section } from '@react-email/section'
import { Text } from '@react-email/text'
import * as React from 'react'

import { emailStyles } from '../styles'

export interface HeraldEmailLayoutProps {
    readonly preview: string
    readonly title: string
    readonly children: React.ReactNode
}

export function HeraldEmailLayout({ preview, title, children }: HeraldEmailLayoutProps) {
    return (
        <Html lang="en">
            <Head />
            <Preview>{preview}</Preview>
            <Body style={emailStyles.body}>
                <Container style={emailStyles.container}>
                    <Section style={emailStyles.panel}>
                        <Text style={emailStyles.brand}>Herald</Text>
                        <Heading style={emailStyles.title}>{title}</Heading>
                        {children}
                    </Section>
                    <Text style={emailStyles.footer}>Herald · Publication manager</Text>
                </Container>
            </Body>
        </Html>
    )
}
