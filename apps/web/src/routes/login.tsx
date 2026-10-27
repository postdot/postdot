import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { AuthForm, type AuthFormValues, type AuthMode } from '@/components/auth-form'
import { AuthShell } from '@/components/auth-shell'
import { api, formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/login')({
    loader: async () => {
        try {
            return await api.getInstanceSetupStatus()
        } catch {
            // Login remains usable if the discovery endpoint is temporarily
            // unavailable; setup simply stays hidden until it can be confirmed.
            return { setupAvailable: false }
        }
    },
    validateSearch: (search: Record<string, unknown>) => ({
        continue:
            typeof search.continue === 'string' ? safeDashboardPath(search.continue) : undefined,
    }),
    component: LoginPage,
})

function LoginPage() {
    const navigate = useNavigate()
    const search = Route.useSearch()
    const invitationFlow = isOrganizationInvitationContinuation(search.continue)
    const [mode, setMode] = useState<AuthMode>('sign-in')
    const setupStatus = Route.useLoaderData()
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    async function handleSubmit({ name, email, password }: AuthFormValues) {
        setError(null)
        setPending(true)

        try {
            if (mode === 'sign-up') {
                await api.signUp(name ?? '', email, password)
            } else {
                await api.signIn(email, password)
            }
            await continueAfterAuthentication()
        } catch (caughtError) {
            setError(formatApiError(caughtError))
        } finally {
            setPending(false)
        }
    }

    function handleSetup() {
        setError(null)
        void navigate({ to: '/setup' })
    }

    function handleModeChange(nextMode: AuthMode) {
        setError(null)
        if (invitationFlow) {
            setMode(nextMode)
        } else {
            handleSetup()
        }
    }

    async function continueAfterAuthentication() {
        if (search.continue !== undefined) {
            window.location.assign(search.continue)
        } else {
            await navigate({ to: '/dashboard' })
        }
    }

    return (
        <AuthShell>
            <AuthForm
                description={invitationFlow ? m.auth_invitation_account_description() : undefined}
                error={error}
                mode={mode}
                modeToggleLabels={
                    invitationFlow
                        ? {
                              signIn: m.auth_create_account_instead(),
                              signUp: m.auth_already_have_account(),
                          }
                        : undefined
                }
                onForgotPassword={
                    invitationFlow ? undefined : () => void navigate({ to: '/forgot-password' })
                }
                onModeChange={handleModeChange}
                onSubmit={handleSubmit}
                pending={pending}
                showSetupAction={invitationFlow || setupStatus.setupAvailable}
                title={invitationFlow && mode === 'sign-up' ? m.auth_join_postdot() : undefined}
            />
        </AuthShell>
    )
}

function isOrganizationInvitationContinuation(value: string | undefined) {
    if (value === undefined) return false

    try {
        const url = new URL(value, 'https://postdot.invalid')
        return (
            url.origin === 'https://postdot.invalid' &&
            ((url.pathname === '/invite' && url.searchParams.has('invitationId')) ||
                (url.pathname === '/dashboard/settings/access' &&
                    url.searchParams.has('organizationInvitation')))
        )
    } catch {
        return false
    }
}

function safeDashboardPath(value: string) {
    if (
        value.includes('\\') ||
        (value !== '/dashboard' && !value.startsWith('/dashboard/') && !value.startsWith('/invite'))
    ) {
        return undefined
    }

    try {
        const url = new URL(value, 'https://postdot.invalid')
        return url.origin === 'https://postdot.invalid' ? value : undefined
    } catch {
        return undefined
    }
}
