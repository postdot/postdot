import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { AuthForm, type AuthFormValues } from '@/components/auth-form'
import { AuthShell } from '@/components/auth-shell'
import { ApiError, api, formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/setup')({
    loader: async () => {
        const status = await api.getInstanceSetupStatus()
        if (!status.setupAvailable) {
            throw redirect({
                to: '/login',
                search: { continue: undefined },
                replace: true,
            })
        }
        return status
    },
    component: SetupPage,
})

function SetupPage() {
    const navigate = useNavigate()
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    async function handleSubmit({ name, email, password }: AuthFormValues) {
        setError(null)
        setPending(true)

        try {
            await api.signUp(name ?? '', email, password)
            await navigate({ to: '/dashboard', replace: true })
        } catch (caughtError) {
            setError(
                caughtError instanceof ApiError && caughtError.code === 'FAILED_TO_CREATE_USER'
                    ? m.auth_setup_unavailable()
                    : formatApiError(caughtError)
            )
        } finally {
            setPending(false)
        }
    }

    return (
        <AuthShell>
            <AuthForm
                description={m.auth_setup_administrator_description()}
                mode="sign-up"
                onSubmit={handleSubmit}
                pending={pending}
                showSetupAction={false}
                error={error}
            />
        </AuthShell>
    )
}
