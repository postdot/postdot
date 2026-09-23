import { SolarProvider } from '@solar-icons/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'

import { AuthForm } from '@/components/auth-form'
import { AuthShell } from '@/components/auth-shell'
import { LanguageProvider } from '@/lib/i18n'

const meta = {
    title: 'Authentication/Login',
    component: AuthForm,
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof AuthForm>

export default meta

type Story = StoryObj<typeof meta>

export const SignIn: Story = {
    render: args => <AuthPreview {...args} />,
    args: {
        onSubmit: () => undefined,
        showSetupAction: false,
    },
}

export const Setup: Story = {
    render: args => <AuthPreview {...args} />,
    args: {
        mode: 'sign-up',
        onSubmit: () => undefined,
        showSetupAction: false,
    },
}

export const Invitation: Story = {
    render: args => <AuthPreview {...args} />,
    args: {
        description: 'You’ve been invited to join Herald.',
        emailReadOnly: true,
        initialEmail: 'operator@example.com',
        mode: 'sign-up',
        modeToggleLabels: {
            signIn: 'I already have an account',
            signUp: 'Create an account instead',
        },
        onSubmit: () => undefined,
        showSetupAction: true,
        title: 'Join Herald',
    },
}

export const InvalidCredentials: Story = {
    render: args => <AuthPreview {...args} />,
    args: {
        error: 'The email or password is incorrect.',
        initialEmail: 'operator@example.com',
        onSubmit: () => undefined,
        showSetupAction: false,
    },
}

export const Submitting: Story = {
    render: args => <AuthPreview {...args} />,
    args: {
        initialEmail: 'operator@example.com',
        onSubmit: () => undefined,
        pending: true,
        showSetupAction: false,
    },
}

function AuthPreview(props: ComponentProps<typeof AuthForm>) {
    return (
        <LanguageProvider>
            <SolarProvider>
                <AuthShell>
                    <AuthForm {...props} />
                </AuthShell>
            </SolarProvider>
        </LanguageProvider>
    )
}
