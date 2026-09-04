import { Button } from '@herald/ui/components/button'
import { HeraldLogo } from '@herald/ui/components/herald-logo'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { ApiError, api } from '@/lib/api'

export const Route = createFileRoute('/login')({
    component: LoginPage,
})

function LoginPage() {
    const navigate = useNavigate()
    const [isSignUp, setIsSignUp] = useState(false)
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        setPending(true)

        try {
            if (isSignUp) {
                await api.signUp(name, email, password)
            } else {
                await api.signIn(email, password)
            }
            await navigate({ to: '/dashboard' })
        } catch (caughtError) {
            setError(
                caughtError instanceof ApiError
                    ? caughtError.message
                    : 'Authentication could not be completed'
            )
        } finally {
            setPending(false)
        }
    }

    return (
        <section className="mx-auto max-w-md py-16 sm:py-24">
            <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <HeraldLogo className="size-8" />
                </div>
                <p className="mt-8 text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                    {isSignUp ? 'Create an account' : 'Welcome back'}
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                    {isSignUp ? 'Start your Herald workspace.' : 'Sign in to Herald.'}
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Herald keeps automated and manual publications in one source of truth.
                </p>

                <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                    {isSignUp ? (
                        <label className="grid gap-2 text-sm font-medium">
                            Name
                            <input
                                required
                                value={name}
                                onChange={event => setName(event.target.value)}
                                className="h-10 rounded-lg border bg-background px-3 font-normal outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/20"
                            />
                        </label>
                    ) : null}
                    <label className="grid gap-2 text-sm font-medium">
                        Email
                        <input
                            required
                            type="email"
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                            className="h-10 rounded-lg border bg-background px-3 font-normal outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/20"
                        />
                    </label>
                    <label className="grid gap-2 text-sm font-medium">
                        Password
                        <input
                            required
                            minLength={8}
                            type="password"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            className="h-10 rounded-lg border bg-background px-3 font-normal outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/20"
                        />
                    </label>
                    {error ? (
                        <p
                            role="alert"
                            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error}
                        </p>
                    ) : null}
                    <Button className="w-full" size="lg" type="submit" disabled={pending}>
                        {pending ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
                    </Button>
                </form>

                <div className="mt-6 text-sm">
                    <button
                        type="button"
                        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() => {
                            setIsSignUp(value => !value)
                            setError(null)
                        }}>
                        {isSignUp ? 'Already have an account?' : 'Need an account?'}
                    </button>
                </div>
            </div>
        </section>
    )
}
