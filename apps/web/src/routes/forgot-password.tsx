import { Button } from '@herald/ui/components/button'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useId, useState, type FormEvent } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { ApiError, api, formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
    const navigate = useNavigate()
    const emailId = useId()
    const [email, setEmail] = useState('')
    const [pending, setPending] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        setPending(true)

        try {
            await api.requestPasswordReset(email.trim(), `${window.location.origin}/reset-password`)
            setSubmitted(true)
        } catch (caughtError) {
            setError(
                caughtError instanceof ApiError && caughtError.code === 'RESET_PASSWORD_DISABLED'
                    ? m.auth_password_reset_unavailable()
                    : formatApiError(caughtError)
            )
        } finally {
            setPending(false)
        }
    }

    return (
        <AuthShell>
            <h1 className="font-heading text-3xl font-semibold">{m.auth_password_reset_title()}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {m.auth_password_reset_description()}
            </p>

            {submitted ? (
                <p
                    aria-live="polite"
                    className="mt-8 rounded-lg bg-muted px-4 py-3 text-sm leading-6"
                    role="status">
                    {m.auth_password_reset_requested()}
                </p>
            ) : (
                <form className="mt-8 grid gap-5" onSubmit={event => void handleSubmit(event)}>
                    <Field>
                        <FieldLabel htmlFor={emailId}>{m.auth_email()}</FieldLabel>
                        <Input
                            autoComplete="email"
                            className="h-11 rounded-lg px-3.5"
                            id={emailId}
                            required
                            type="email"
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                        />
                    </Field>

                    {error ? (
                        <p aria-live="polite" className="text-sm text-state-failed" role="alert">
                            {error}
                        </p>
                    ) : null}

                    <Button
                        className="h-11 w-full rounded-lg"
                        disabled={pending}
                        size="lg"
                        type="submit">
                        {pending ? m.auth_working() : m.auth_password_reset_send()}
                    </Button>
                </form>
            )}

            <div className="mt-6 text-center">
                <Button
                    onClick={() => void navigate({ to: '/login', search: { continue: undefined } })}
                    size="sm"
                    variant="link">
                    {m.auth_back_to_sign_in()}
                </Button>
            </div>
        </AuthShell>
    )
}
