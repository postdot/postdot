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
    const status = Route.useLoaderData()
    const tokenRequired = status.bootstrapMode === 'token_required'
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    async function handleSubmit({ name, email, password, bootstrapToken }: AuthFormValues) {
        setError(null)
        setPending(true)

        try {
            if (tokenRequired) {
                await api.bootstrapInstance({
                    name: name ?? '',
                    email,
                    password,
                    bootstrapToken,
                })
            } else {
                await api.signUp(name ?? '', email, password)
            }
            await navigate({ to: '/dashboard', replace: true })
        } catch (caughtError) {
            if (caughtError instanceof ApiError && caughtError.code === 'invalid_bootstrap_token') {
                setError(m.auth_setup_invalid_bootstrap_token())
            } else if (
                caughtError instanceof ApiError &&
                (caughtError.code === 'already_claimed' ||
                    caughtError.code === 'FAILED_TO_CREATE_USER')
            ) {
                setError(m.auth_setup_unavailable())
            } else {
                setError(formatApiError(caughtError))
            }
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
                showBootstrapToken={tokenRequired}
                showSetupAction={false}
                error={error}
            />
        </AuthShell>
    )
}
