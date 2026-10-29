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
                beforeForm={
                    <ol
                        aria-label={m.auth_setup_steps_label()}
                        className="mt-6 grid gap-2 text-sm leading-6 text-muted-foreground">
                        {[
                            m.auth_setup_step_admin(),
                            m.auth_setup_step_close(),
                            m.auth_setup_step_invite(),
                        ].map((step, index) => (
                            <li key={step} className="flex gap-3">
                                <span className="w-4 shrink-0 font-medium text-foreground tabular-nums">
                                    {index + 1}
                                </span>
                                <span>{step}</span>
                            </li>
                        ))}
                    </ol>
                }
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
