import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { CopyIcon } from '@solar-icons/react/bold/copy'
import { KeyMinimalisticIcon } from '@solar-icons/react/bold/key-minimalistic'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useEffect, useState, type FormEvent } from 'react'

import { api, ApiError, formatApiError, type AccessInvitation, type AccessSummary } from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface InstanceAccessSettingsPageProps {
    readonly invitationToken?: string
    readonly onInvitationHandled: () => Promise<void>
}

interface CreatedInvitationView {
    readonly invitation: AccessInvitation
    readonly link: string
}

export function InstanceAccessSettingsPage({
    invitationToken,
    onInvitationHandled,
}: InstanceAccessSettingsPageProps) {
    const { locale } = useLanguage()
    const global = useDashboardGlobal()
    const [access, setAccess] = useState<AccessSummary | null>(null)
    const [invitations, setInvitations] = useState<AccessInvitation[] | null>(null)
    const [email, setEmail] = useState('')
    const [createdInvitation, setCreatedInvitation] = useState<CreatedInvitationView | null>(null)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState(false)
    const [pendingAction, setPendingAction] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        async function load() {
            setAccess(null)
            setInvitations(null)
            setError(null)
            try {
                const summary = await api.getInstanceAccess()
                if (cancelled) return
                setAccess(summary)
                if (summary.isAdmin) {
                    const response = await api.listAccessInvitations()
                    if (!cancelled) setInvitations(response.invitations)
                } else {
                    setInvitations([])
                }
            } catch (caughtError) {
                if (!cancelled) setError(accessErrorMessage(caughtError))
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [])

    const pendingInvitations =
        invitations?.filter(invitation => invitation.state === 'pending') ?? []

    async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const targetEmail = email.trim().toLowerCase()
        if (targetEmail === '' || pendingAction !== null) return

        await runAction('create', async () => {
            const response = await api.createAccessInvitation(targetEmail)
            const url = new URL('/dashboard/settings/access', window.location.origin)
            url.searchParams.set('invitation', response.token)
            setCreatedInvitation({ invitation: response.invitation, link: url.toString() })
            setCopied(false)
            setCopyError(false)
            setEmail('')
            setInvitations(current =>
                current === null ? [response.invitation] : [response.invitation, ...current]
            )
            setNotice(m.access_invitation_created())
        })
    }

    async function handleCopyInvitation() {
        if (createdInvitation === null) return

        setCopyError(false)
        try {
            await navigator.clipboard.writeText(createdInvitation.link)
            setCopied(true)
        } catch {
            setCopyError(true)
        }
    }

    async function handleRevokeInvitation(invitationId: string) {
        if (pendingAction !== null) return

        await runAction(`revoke:${invitationId}`, async () => {
            await api.revokeAccessInvitation(invitationId)
            setInvitations(
                current => current?.filter(invitation => invitation.id !== invitationId) ?? null
            )
            setNotice(m.access_invitation_revoked())
        })
    }

    async function handleAcceptInvitation() {
        if (invitationToken === undefined || pendingAction !== null) return

        await runAction('accept', async () => {
            const response = await api.acceptAccessInvitation(invitationToken)
            setAccess(current =>
                current === null ? current : { ...current, membership: response.instanceMembership }
            )
            setNotice(m.access_invitation_accepted())
            await onInvitationHandled()
        })
    }

    async function runAction(action: string, operation: () => Promise<void>) {
        setError(null)
        setNotice(null)
        setPendingAction(action)
        try {
            await operation()
        } catch (caughtError) {
            setError(accessErrorMessage(caughtError))
        } finally {
            setPendingAction(null)
        }
    }

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto max-w-5xl">
                <header className="flex items-start gap-3">
                    <KeyMinimalisticIcon
                        className="mt-1 size-5 shrink-0 text-primary"
                        aria-hidden="true"
                    />
                    <div className="min-w-0">
                        <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                            {m.access_instance_title()}
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                            {m.access_instance_summary()}
                        </p>
                    </div>
                </header>

                {error ? (
                    <Alert className="mt-6" variant="destructive">
                        <AlertTitle>{m.access_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {notice ? (
                    <div
                        className="mt-6 flex items-center gap-2 text-sm text-state-success"
                        role="status">
                        <CheckReadIcon aria-hidden="true" className="size-4" />
                        <span>{notice}</span>
                    </div>
                ) : null}

                {invitationToken ? (
                    <section
                        aria-labelledby="accept-invitation-title"
                        className="mt-8 bg-primary/10 p-5 shadow-surface sm:p-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2
                                    id="accept-invitation-title"
                                    className="font-heading text-base font-medium">
                                    {m.access_accept_invitation_title()}
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {m.access_accept_invitation_description()}
                                </p>
                            </div>
                            <Button
                                type="button"
                                disabled={pendingAction !== null || access === null}
                                onClick={() => void handleAcceptInvitation()}>
                                {m.access_accept_invitation_button()}
                            </Button>
                        </div>
                    </section>
                ) : null}

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <section className="bg-surface-raised p-5 shadow-surface sm:p-6">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="font-heading text-base font-medium">
                                    {m.access_membership_title()}
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {global.session.user.email}
                                </p>
                            </div>
                            {access ? (
                                <Badge variant="secondary">
                                    {access.instance.state === 'claimed'
                                        ? m.access_instance_claimed()
                                        : m.access_instance_claimable()}
                                </Badge>
                            ) : null}
                        </div>

                        {access === null ? (
                            <p className="mt-6 text-sm text-muted-foreground" role="status">
                                {m.access_instance_loading()}
                            </p>
                        ) : access.membership === null ? (
                            <Empty className="mt-6 min-h-36 bg-muted/50 p-4">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <KeyMinimalisticIcon aria-hidden="true" />
                                    </EmptyMedia>
                                    <EmptyTitle>{m.access_no_membership()}</EmptyTitle>
                                    <EmptyDescription>
                                        {m.access_no_membership_description()}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <div className="mt-6 flex items-center justify-between gap-3 bg-muted/60 p-3 shadow-field">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                        {access.membership.name}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {access.membership.email}
                                    </p>
                                </div>
                                <Badge
                                    variant={
                                        access.membership.role === 'admin' ? 'default' : 'secondary'
                                    }>
                                    {instanceRoleLabel(access.membership.role)}
                                </Badge>
                            </div>
                        )}
                    </section>

                    {access?.isAdmin ? (
                        <section className="min-w-0 bg-surface-raised p-5 shadow-surface sm:p-6">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="font-heading text-base font-medium">
                                        {m.access_admin_title()}
                                    </h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {m.access_admin_summary()}
                                    </p>
                                </div>
                                <Badge variant="secondary">{m.access_role_admin()}</Badge>
                            </div>

                            <form
                                className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
                                onSubmit={handleCreateInvitation}>
                                <Field className="min-w-0 flex-1 gap-1.5">
                                    <FieldLabel htmlFor="instance-access-email">
                                        {m.access_invite_email()}
                                    </FieldLabel>
                                    <Input
                                        id="instance-access-email"
                                        type="email"
                                        required
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        placeholder={m.access_invite_email_placeholder()}
                                    />
                                </Field>
                                <Button type="submit" disabled={pendingAction !== null}>
                                    <AddIcon aria-hidden="true" />
                                    {m.access_invite_button()}
                                </Button>
                            </form>

                            {createdInvitation ? (
                                <div className="mt-5 bg-primary/10 p-4 shadow-surface">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium">
                                                {m.access_invitation_created_for({
                                                    email: createdInvitation.invitation.targetEmail,
                                                })}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {m.access_invitation_copy_once()}
                                            </p>
                                        </div>
                                        <Badge variant="default">{m.access_pending()}</Badge>
                                    </div>
                                    <code className="mt-3 block overflow-x-auto bg-background px-3 py-2 text-xs leading-5 text-foreground shadow-field">
                                        {createdInvitation.link}
                                    </code>
                                    {copyError ? (
                                        <p className="mt-2 text-xs text-state-failed" role="alert">
                                            {m.access_copy_link_unavailable()}
                                        </p>
                                    ) : null}
                                    <Button
                                        type="button"
                                        className="mt-3"
                                        size="sm"
                                        onClick={() => void handleCopyInvitation()}>
                                        <CopyIcon aria-hidden="true" />
                                        {copied ? m.access_copied() : m.access_copy_link()}
                                    </Button>
                                </div>
                            ) : null}

                            <div className="mt-6">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-sm font-medium">
                                        {m.access_pending_title()}
                                    </h3>
                                    <span className="text-xs text-muted-foreground">
                                        {pendingInvitations.length}
                                    </span>
                                </div>

                                {invitations === null ? (
                                    <p className="mt-4 text-sm text-muted-foreground" role="status">
                                        {m.access_instance_loading()}
                                    </p>
                                ) : pendingInvitations.length === 0 ? (
                                    <p className="mt-4 text-sm text-muted-foreground">
                                        {m.access_pending_empty()}
                                    </p>
                                ) : (
                                    <ul
                                        className="mt-3 grid gap-2"
                                        aria-label={m.access_pending_title()}>
                                        {pendingInvitations.map(invitation => (
                                            <li
                                                className="flex flex-col gap-3 bg-muted/60 p-3 shadow-field sm:flex-row sm:items-center sm:justify-between"
                                                key={invitation.id}>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">
                                                        {invitation.targetEmail}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {formatInvitationExpiry(
                                                            invitation.expiresAt,
                                                            locale
                                                        )}
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={pendingAction !== null}
                                                    onClick={() =>
                                                        void handleRevokeInvitation(invitation.id)
                                                    }>
                                                    <TrashBinMinimalisticIcon aria-hidden="true" />
                                                    {m.access_revoke_invitation()}
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </section>
                    ) : null}
                </div>
            </div>
        </main>
    )
}

function instanceRoleLabel(role: 'admin' | 'member') {
    return role === 'admin' ? m.access_role_admin() : m.access_role_member()
}

function formatInvitationExpiry(timestamp: number, locale: string) {
    return m.access_invitation_expires({
        date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp),
    })
}

function accessErrorMessage(error: unknown) {
    if (error instanceof ApiError) {
        if (error.code === 'invalid_invitation') return m.access_invalid_invitation()
        if (error.code === 'invitation_not_pending') return m.access_invitation_not_pending()
    }
    return formatApiError(error)
}
