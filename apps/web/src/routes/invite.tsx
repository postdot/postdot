import { Button } from '@postdot/ui/components/button'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { AuthForm, type AuthFormValues, type AuthMode } from '@/components/auth-form'
import { AuthShell } from '@/components/auth-shell'
import { ApiError, api, formatApiError } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/invite')({
    validateSearch: (search: Record<string, unknown>) => ({
        invitationId:
            typeof search.invitationId === 'string' && search.invitationId.length > 0
                ? search.invitationId
                : undefined,
        organizationId:
            typeof search.organizationId === 'string' && search.organizationId.length > 0
                ? search.organizationId
                : undefined,
        projectId:
            typeof search.projectId === 'string' && search.projectId.length > 0
                ? search.projectId
                : undefined,
        token:
            typeof search.token === 'string' && search.token.length > 0 ? search.token : undefined,
    }),
    component: InvitationPage,
})

function InvitationPage() {
    const search = Route.useSearch()

    if (search.invitationId !== undefined) {
        return (
            <OrganizationInvitationPage
                invitationId={search.invitationId}
                organizationId={search.organizationId}
                projectId={search.projectId}
            />
        )
    }

    return <InstanceInvitationPage token={search.token} />
}

function InstanceInvitationPage({ token }: { readonly token?: string }) {
    const navigate = useNavigate()
    useLanguage()
    const [preview, setPreview] = useState<{
        readonly targetEmail: string
        readonly expiresAt: number
    } | null>(null)
    const [authenticated, setAuthenticated] = useState(false)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [retryable, setRetryable] = useState(false)
    const [loadAttempt, setLoadAttempt] = useState(0)
    const [mode, setMode] = useState<AuthMode>('sign-up')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    useEffect(() => {
        let cancelled = false
        setPreview(null)
        setAuthenticated(false)
        setLoadError(null)
        setRetryable(false)
        setLoading(true)

        if (token === undefined) {
            setLoading(false)
            setLoadError(m.auth_invitation_invalid_description())
            return () => {
                cancelled = true
            }
        }

        void Promise.all([api.getAccessInvitationPreview(token), api.getSession()])
            .then(([invitation, session]) => {
                if (cancelled) return
                setPreview(invitation)
                setAuthenticated(session !== null)
                setLoading(false)
            })
            .catch(caughtError => {
                if (cancelled) return
                setLoadError(invitationErrorMessage(caughtError))
                setRetryable(
                    !(caughtError instanceof ApiError && caughtError.code === 'invalid_invitation')
                )
                setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [token, loadAttempt])

    async function handleSubmit({ name, email, password }: AuthFormValues) {
        if (token === undefined || pending) return

        setError(null)
        setPending(true)
        try {
            if (mode === 'sign-up') {
                await api.signUp(name ?? '', email, password)
            } else {
                await api.signIn(email, password)
            }
            await acceptInvitation()
        } catch (caughtError) {
            setError(invitationErrorMessage(caughtError))
        } finally {
            setPending(false)
        }
    }

    async function acceptInvitation() {
        if (token === undefined) return

        setError(null)
        setPending(true)
        try {
            await api.acceptAccessInvitation(token)
            await navigate({ to: '/dashboard', replace: true })
        } catch (caughtError) {
            setError(invitationErrorMessage(caughtError))
        } finally {
            setPending(false)
        }
    }

    if (loading) {
        return (
            <AuthShell>
                <p className="text-sm text-muted-foreground" role="status">
                    {m.auth_invitation_loading()}
                </p>
            </AuthShell>
        )
    }

    if (retryable) {
        return (
            <AuthShell>
                <InvitationLoadError onRetry={() => setLoadAttempt(attempt => attempt + 1)} />
            </AuthShell>
        )
    }

    if (preview === null || loadError !== null) {
        return (
            <AuthShell>
                <div>
                    <h1 className="font-heading text-3xl font-semibold">
                        {m.auth_invitation_invalid_title()}
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {loadError ?? m.auth_invitation_invalid_description()}
                    </p>
                    <Link
                        className="mt-6 inline-flex text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        search={{ continue: undefined }}
                        to="/login">
                        {m.auth_back_to_sign_in()}
                    </Link>
                </div>
            </AuthShell>
        )
    }

    if (authenticated) {
        return (
            <AuthShell>
                <div>
                    <h1 className="font-heading text-3xl font-semibold">
                        {m.access_accept_invitation_title()}
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {m.access_accept_invitation_description()}
                    </p>
                    {error ? (
                        <p
                            className="mt-6 rounded-lg bg-state-failed/10 px-3 py-2 text-sm text-state-failed"
                            role="alert">
                            {error}
                        </p>
                    ) : null}
                    <Button
                        className="mt-8 w-full"
                        disabled={pending}
                        onClick={() => void acceptInvitation()}>
                        {m.access_accept_invitation_button()}
                    </Button>
                </div>
            </AuthShell>
        )
    }

    return (
        <AuthShell>
            <AuthForm
                description={m.auth_invitation_description()}
                emailReadOnly
                error={error}
                initialEmail={preview.targetEmail}
                mode={mode}
                modeToggleLabels={{
                    signIn: m.auth_use_existing_account(),
                    signUp: m.auth_create_account_instead(),
                }}
                onModeChange={setMode}
                onSubmit={handleSubmit}
                pending={pending}
                showSetupAction
                title={m.auth_join_postdot()}
            />
        </AuthShell>
    )
}

function OrganizationInvitationPage({
    invitationId,
    organizationId,
    projectId,
}: {
    readonly invitationId: string
    readonly organizationId?: string
    readonly projectId?: string
}) {
    const navigate = useNavigate()
    useLanguage()
    const [loading, setLoading] = useState(true)
    const [ready, setReady] = useState(false)
    const [loadAttempt, setLoadAttempt] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        setReady(false)

        void api
            .getSession()
            .then(session => {
                if (cancelled) return
                if (session === null) {
                    void navigate({
                        to: '/login',
                        search: {
                            continue: createInvitationContinuation(
                                invitationId,
                                organizationId,
                                projectId
                            ),
                        },
                        replace: true,
                    })
                    return
                }
                setReady(true)
                setLoading(false)
            })
            .catch(caughtError => {
                if (cancelled) return
                setError(formatApiError(caughtError))
                setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [invitationId, navigate, organizationId, projectId, loadAttempt])

    async function handleAccept() {
        if (pending) return

        setError(null)
        setPending(true)
        try {
            await api.acceptOrganizationInvitation(invitationId)
            if (projectId !== undefined) {
                await navigate({
                    to: '/dashboard/projects/$projectId/overview',
                    params: { projectId },
                    replace: true,
                })
            } else {
                await navigate({ to: '/dashboard', replace: true })
            }
        } catch (caughtError) {
            setError(invitationErrorMessage(caughtError))
        } finally {
            setPending(false)
        }
    }

    if (loading) {
        return (
            <AuthShell>
                <p className="text-sm text-muted-foreground" role="status">
                    {m.auth_invitation_loading()}
                </p>
            </AuthShell>
        )
    }

    if (!ready) {
        return (
            <AuthShell>
                <InvitationLoadError onRetry={() => setLoadAttempt(attempt => attempt + 1)} />
            </AuthShell>
        )
    }

    const isProjectInvitation = projectId !== undefined
    return (
        <AuthShell>
            <div>
                <h1 className="font-heading text-3xl font-semibold">
                    {isProjectInvitation
                        ? m.access_project_invitation_accept_title()
                        : m.access_workspace_invitation_accept_title()}
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {isProjectInvitation
                        ? m.access_project_invitation_accept_description()
                        : m.access_workspace_invitation_accept_description()}
                </p>
                {error ? (
                    <p
                        className="mt-6 rounded-lg bg-state-failed/10 px-3 py-2 text-sm text-state-failed"
                        role="alert">
                        {error}
                    </p>
                ) : null}
                <Button
                    className="mt-8 w-full"
                    disabled={pending}
                    onClick={() => void handleAccept()}>
                    {isProjectInvitation
                        ? m.access_project_invitation_accept_button()
                        : m.access_workspace_invitation_accept_button()}
                </Button>
            </div>
        </AuthShell>
    )
}

function InvitationLoadError({ onRetry }: { readonly onRetry: () => void }) {
    return (
        <div>
            <h1 className="font-heading text-3xl font-semibold">{m.common_error_title()}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {m.common_error_description()}
            </p>
            <Button className="mt-6" onClick={onRetry}>
                <RefreshIcon aria-hidden="true" />
                {m.common_retry()}
            </Button>
            <Link
                className="mt-6 block text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                search={{ continue: undefined }}
                to="/login">
                {m.auth_back_to_sign_in()}
            </Link>
        </div>
    )
}

function createInvitationContinuation(
    invitationId: string,
    organizationId?: string,
    projectId?: string
) {
    const url = new URL('/invite', window.location.origin)
    url.searchParams.set('invitationId', invitationId)
    if (organizationId !== undefined) url.searchParams.set('organizationId', organizationId)
    if (projectId !== undefined) url.searchParams.set('projectId', projectId)
    return `${url.pathname}${url.search}`
}

function invitationErrorMessage(error: unknown) {
    if (error instanceof ApiError && error.code === 'invalid_invitation') {
        return m.auth_invitation_invalid_description()
    }
    return formatApiError(error)
}
