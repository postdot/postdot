import { Button } from '@postbot/ui/components/button'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import { EyeIcon } from '@solar-icons/react/linear/eye'
import { EyeClosedIcon } from '@solar-icons/react/linear/eye-closed'
import { useEffect, useId, useState, type FormEvent } from 'react'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export type AuthMode = 'sign-in' | 'sign-up'

export interface AuthFormValues {
    readonly name?: string
    readonly email: string
    readonly password: string
}

interface AuthFormProps {
    readonly description?: string
    readonly emailReadOnly?: boolean
    readonly error?: string | null
    readonly initialEmail?: string
    readonly mode?: AuthMode
    readonly modeToggleLabels?: {
        readonly signIn: string
        readonly signUp: string
    }
    readonly onModeChange?: (mode: AuthMode) => void
    readonly onForgotPassword?: () => void
    readonly onSubmit: (values: AuthFormValues) => void | Promise<void>
    readonly pending?: boolean
    readonly showSetupAction?: boolean
    readonly title?: string
}

export function AuthForm({
    description,
    emailReadOnly = false,
    error = null,
    initialEmail = '',
    mode = 'sign-in',
    modeToggleLabels,
    onModeChange,
    onForgotPassword,
    onSubmit,
    pending = false,
    showSetupAction = true,
    title,
}: AuthFormProps) {
    useLanguage()
    const formId = useId()
    const [name, setName] = useState('')
    const [email, setEmail] = useState(initialEmail)
    const [password, setPassword] = useState('')
    const [passwordVisible, setPasswordVisible] = useState(false)
    const isSignUp = mode === 'sign-up'
    const nameId = `auth-name-${formId}`
    const emailId = `auth-email-${formId}`
    const passwordId = `auth-password-${formId}`
    const resolvedModeToggleLabels = modeToggleLabels ?? {
        signIn: m.auth_setup_postbot(),
        signUp: m.auth_back_to_sign_in(),
    }

    useEffect(() => {
        setName('')
        setPassword('')
        setPasswordVisible(false)
    }, [mode])

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        void onSubmit({
            ...(isSignUp ? { name } : {}),
            email,
            password,
        })
    }

    function handleModeChange(nextMode: AuthMode) {
        setPasswordVisible(false)
        onModeChange?.(nextMode)
    }

    return (
        <div>
            <h1 className="font-heading text-3xl font-semibold">
                {title ?? (isSignUp ? m.auth_start_workspace_title() : m.auth_sign_in_title())}
            </h1>
            {description ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
            ) : null}

            <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
                {isSignUp ? (
                    <Field>
                        <FieldLabel htmlFor={nameId}>{m.auth_name()}</FieldLabel>
                        <Input
                            autoComplete="name"
                            className="h-11 rounded-lg px-3.5"
                            id={nameId}
                            required
                            value={name}
                            onChange={event => setName(event.target.value)}
                        />
                    </Field>
                ) : null}

                <Field>
                    <FieldLabel htmlFor={emailId}>{m.auth_email()}</FieldLabel>
                    <Input
                        autoComplete="email"
                        className="h-11 rounded-lg px-3.5"
                        id={emailId}
                        readOnly={emailReadOnly}
                        required
                        type="email"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                    />
                </Field>

                <Field>
                    <FieldLabel htmlFor={passwordId}>{m.auth_password()}</FieldLabel>
                    <div className="relative">
                        <Input
                            aria-invalid={error !== null || undefined}
                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                            className="h-11 rounded-lg px-3.5 pr-10"
                            id={passwordId}
                            minLength={8}
                            required
                            type={passwordVisible ? 'text' : 'password'}
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                        />
                        <Button
                            aria-label={
                                passwordVisible ? m.auth_hide_password() : m.auth_show_password()
                            }
                            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setPasswordVisible(value => !value)}
                            size="icon-sm"
                            type="button"
                            variant="ghost">
                            {passwordVisible ? (
                                <EyeClosedIcon aria-hidden="true" />
                            ) : (
                                <EyeIcon aria-hidden="true" />
                            )}
                        </Button>
                    </div>
                </Field>

                {!isSignUp && onForgotPassword ? (
                    <div className="-mt-3 flex justify-end">
                        <button
                            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                            onClick={onForgotPassword}
                            type="button">
                            {m.auth_forgot_password()}
                        </button>
                    </div>
                ) : null}

                {error ? (
                    <div
                        aria-live="polite"
                        className="rounded-lg bg-state-failed/10 px-3 py-2 text-sm text-state-failed shadow-field"
                        role="alert">
                        {error}
                    </div>
                ) : null}

                <Button
                    className="h-11 w-full rounded-lg"
                    disabled={pending}
                    size="lg"
                    type="submit">
                    {pending
                        ? m.auth_working()
                        : isSignUp
                          ? m.auth_create_account_button()
                          : m.auth_sign_in_button()}
                </Button>
            </form>

            {showSetupAction && onModeChange ? (
                <div className="mt-6 text-center text-sm">
                    <button
                        className="font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                        onClick={() => handleModeChange(isSignUp ? 'sign-in' : 'sign-up')}
                        type="button">
                        {isSignUp
                            ? resolvedModeToggleLabels.signUp
                            : resolvedModeToggleLabels.signIn}
                    </button>
                </div>
            ) : null}
        </div>
    )
}
