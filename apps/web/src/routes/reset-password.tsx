import { Button } from '@postdot/ui/components/button'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useId, useState, type FormEvent } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { ApiError, api, formatApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/reset-password')({
    validateSearch: (search: Record<string, unknown>) => ({
        error: typeof search.error === 'string' ? search.error : undefined,
        token: typeof search.token === 'string' ? search.token : undefined,
    }),
    component: ResetPasswordPage,
})

function ResetPasswordPage() {
    const navigate = useNavigate()
    const search = Route.useSearch()
    const passwordId = useId()
    const confirmationId = useId()
    const [password, setPassword] = useState('')
    const [confirmation, setConfirmation] = useState('')
    const [pending, setPending] = useState(false)
    const [complete, setComplete] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const invalidLink = search.error !== undefined || search.token === undefined

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        if (password !== confirmation) {
            setError(m.auth_password_reset_mismatch())
            return
        }
        if (search.token === undefined) return

        setPending(true)
        try {
            await api.resetPassword(search.token, password)
            setComplete(true)
        } catch (caughtError) {
            setError(
                caughtError instanceof ApiError && caughtError.status === 400
                    ? m.auth_password_reset_invalid_token()
                    : formatApiError(caughtError)
            )
        } finally {
            setPending(false)
        }
    }

    return (
        <AuthShell>
            <h1 className="font-heading text-3xl font-semibold">
                {complete
                    ? m.auth_password_reset_complete_title()
                    : invalidLink
                      ? m.auth_password_reset_invalid_title()
                      : m.auth_password_reset_new_title()}
            </h1>

            {complete ? (
                <>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {m.auth_password_reset_complete_description()}
                    </p>
                    <Button
                        className="mt-8 h-11 w-full rounded-lg"
                        onClick={() =>
                            void navigate({ to: '/login', search: { continue: undefined } })
                        }
                        size="lg">
                        {m.auth_sign_in_button()}
                    </Button>
                </>
            ) : invalidLink ? (
                <>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {m.auth_password_reset_invalid_description()}
                    </p>
                    <Button
                        className="mt-8 h-11 w-full rounded-lg"
                        onClick={() => void navigate({ to: '/forgot-password' })}
                        size="lg">
                        {m.auth_password_reset_request_again()}
                    </Button>
                </>
            ) : (
                <form className="mt-8 grid gap-5" onSubmit={event => void handleSubmit(event)}>
                    <Field>
                        <FieldLabel htmlFor={passwordId}>{m.auth_password_new()}</FieldLabel>
                        <Input
                            autoComplete="new-password"
                            className="h-11 rounded-lg px-3.5"
                            id={passwordId}
                            maxLength={128}
                            minLength={8}
                            required
                            type="password"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={confirmationId}>
                            {m.auth_password_confirm()}
                        </FieldLabel>
                        <Input
                            autoComplete="new-password"
                            className="h-11 rounded-lg px-3.5"
                            id={confirmationId}
                            maxLength={128}
                            minLength={8}
                            required
                            type="password"
                            value={confirmation}
                            onChange={event => setConfirmation(event.target.value)}
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
                        {pending ? m.auth_working() : m.auth_password_reset_save()}
                    </Button>
                </form>
            )}
        </AuthShell>
    )
}
