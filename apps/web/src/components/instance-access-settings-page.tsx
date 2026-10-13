import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Badge } from '@postbot/ui/components/badge'
import { Button } from '@postbot/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@postbot/ui/components/dialog'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { KeyMinimalisticIcon } from '@solar-icons/react/linear/key-minimalistic'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { useEffect, useState, type FormEvent } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { EmptyState } from '@/components/empty-state'
import { UserAvatar } from '@/components/identity-visuals'
import {
    api,
    ApiError,
    formatApiError,
    type AccessInstanceMembership,
    type AccessInstanceMembershipState,
    type AccessInstanceMembershipUpdate,
    type AccessInstanceRole,
    type AccessInvitation,
    type AccessSummary,
} from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface InstanceAccessSettingsPageProps {
    readonly invitationToken?: string
    readonly organizationInvitationId?: string
    readonly organizationInvitationProjectId?: string
    readonly onInvitationHandled: () => Promise<void>
}

interface CreatedInvitationView {
    readonly invitation: AccessInvitation
    readonly link: string
}

export function InstanceAccessSettingsPage({
    invitationToken,
    organizationInvitationId,
    organizationInvitationProjectId,
    onInvitationHandled,
}: InstanceAccessSettingsPageProps) {
    const { locale } = useLanguage()
    const global = useDashboardGlobal()
    const [access, setAccess] = useState<AccessSummary | null>(null)
    const [members, setMembers] = useState<AccessInstanceMembership[] | null>(null)
    const [invitations, setInvitations] = useState<AccessInvitation[] | null>(null)
    const [email, setEmail] = useState('')
    const [createdInvitation, setCreatedInvitation] = useState<CreatedInvitationView | null>(null)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState(false)
    const [pendingAction, setPendingAction] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [inviteOpen, setInviteOpen] = useState(false)
    const [reloadVersion, setReloadVersion] = useState(0)

    useEffect(() => {
        let cancelled = false

        async function load() {
            setLoading(true)
            setAccess(null)
            setMembers(null)
            setInvitations(null)
            setError(null)
            setNotice(null)
            try {
                const summary = await api.getInstanceAccess()
                if (cancelled) return
                setAccess(summary)
                if (summary.isAdmin) {
                    const [memberResponse, invitationResponse] = await Promise.all([
                        api.listAccessMembers(),
                        api.listAccessInvitations(),
                    ])
                    if (!cancelled) {
                        setMembers(memberResponse.members)
                        setInvitations(invitationResponse.invitations)
                    }
                } else {
                    setMembers([])
                    setInvitations([])
                }
            } catch (caughtError) {
                if (!cancelled) {
                    setAccess(null)
                    setMembers(null)
                    setInvitations(null)
                    setError(accessErrorMessage(caughtError))
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [reloadVersion])

    const pendingInvitations =
        invitations?.filter(invitation => invitation.state === 'pending') ?? []

    async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const targetEmail = email.trim().toLowerCase()
        if (targetEmail === '' || pendingAction !== null) return

        await runAction('create', async () => {
            const response = await api.createAccessInvitation(targetEmail)
            const url = new URL('/invite', window.location.origin)
            url.searchParams.set('token', response.token)
            setCreatedInvitation({ invitation: response.invitation, link: url.toString() })
            setCopied(false)
            setCopyError(false)
            setEmail('')
            setInviteOpen(false)
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
            setCreatedInvitation(current =>
                current?.invitation.id === invitationId ? null : current
            )
            setNotice(m.access_invitation_revoked())
        })
    }

    async function handleUpdateMember(userId: string, update: AccessInstanceMembershipUpdate) {
        const member = members?.find(candidate => candidate.userId === userId)
        if (
            member === undefined ||
            member.userId === access?.membership?.userId ||
            pendingAction !== null
        )
            return

        await runAction(`member:${userId}`, async () => {
            const response = await api.updateAccessMember(userId, update)
            setMembers(
                current =>
                    current?.map(candidate =>
                        candidate.userId === userId ? response.membership : candidate
                    ) ?? null
            )
            setNotice(m.access_member_updated())
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

    async function handleAcceptOrganizationInvitation() {
        if (organizationInvitationId === undefined || pendingAction !== null) return

        await runAction('accept-project', async () => {
            await api.acceptOrganizationInvitation(organizationInvitationId)
            setNotice(
                organizationInvitationProjectId === undefined
                    ? m.access_workspace_invitation_accepted()
                    : m.access_project_invitation_accepted()
            )
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
            <div className="mx-auto w-full max-w-6xl">
                <AccessPageHeader title={m.access_instance_title()} />

                <div className="mx-auto w-full max-w-xl">
                    {error && !inviteOpen ? (
                        <Alert className="mt-6" variant="destructive">
                            <AlertTitle>{m.access_action_failed()}</AlertTitle>
                            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <span>{error}</span>
                                <Button
                                    className="shrink-0"
                                    disabled={loading}
                                    onClick={() => setReloadVersion(current => current + 1)}
                                    size="sm"
                                    type="button"
                                    variant="ghost">
                                    <RefreshIcon aria-hidden="true" />
                                    {m.common_retry()}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    {notice ? (
                        <div
                            className="mt-6 flex items-center gap-2 text-sm text-state-success"
                            role="status">
                            <CheckIcon aria-hidden="true" className="size-4" />
                            <span>{notice}</span>
                        </div>
                    ) : null}

                    {loading ? (
                        <section className="mt-8 bg-surface-raised p-5 shadow-surface sm:p-6">
                            <p className="text-sm text-muted-foreground" role="status">
                                {m.access_instance_loading()}
                            </p>
                        </section>
                    ) : error !== null ? null : (
                        <>
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

                            {organizationInvitationId ? (
                                <section
                                    aria-labelledby="accept-organization-invitation-title"
                                    className="mt-8 bg-primary/10 p-5 shadow-surface sm:p-6">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <h2
                                                id="accept-organization-invitation-title"
                                                className="font-heading text-base font-medium">
                                                {organizationInvitationProjectId === undefined
                                                    ? m.access_workspace_invitation_accept_title()
                                                    : m.access_project_invitation_accept_title()}
                                            </h2>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {organizationInvitationProjectId === undefined
                                                    ? m.access_workspace_invitation_accept_description()
                                                    : m.access_project_invitation_accept_description()}
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            disabled={pendingAction !== null}
                                            onClick={() =>
                                                void handleAcceptOrganizationInvitation()
                                            }>
                                            {organizationInvitationProjectId === undefined
                                                ? m.access_workspace_invitation_accept_button()
                                                : m.access_project_invitation_accept_button()}
                                        </Button>
                                    </div>
                                </section>
                            ) : null}

                            <div className="grid gap-6">
                                {!access?.isAdmin ? (
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
                                            <p
                                                className="mt-6 text-sm text-muted-foreground"
                                                role="status">
                                                {m.access_instance_loading()}
                                            </p>
                                        ) : access.membership === null ? (
                                            <EmptyState
                                                className="mt-6"
                                                description={m.access_no_membership_description()}
                                                icon={<KeyMinimalisticIcon aria-hidden="true" />}
                                                layout="compact"
                                                title={m.access_no_membership()}
                                            />
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
                                                        access.membership.role === 'admin'
                                                            ? 'default'
                                                            : 'secondary'
                                                    }>
                                                    {instanceRoleLabel(access.membership.role)}
                                                </Badge>
                                            </div>
                                        )}
                                    </section>
                                ) : null}

                                {access?.isAdmin ? (
                                    <section className="min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h2 className="font-heading text-base font-medium">
                                                    {m.access_members_title()}
                                                </h2>
                                            </div>
                                            <Button size="sm" onClick={() => setInviteOpen(true)}>
                                                <AddIcon aria-hidden="true" />
                                                {m.access_invite_button()}
                                            </Button>
                                        </div>

                                        <div className="mt-4">
                                            {members === null ? (
                                                <p
                                                    className="mt-4 text-sm text-muted-foreground"
                                                    role="status">
                                                    {m.access_instance_loading()}
                                                </p>
                                            ) : members.length === 0 ? (
                                                <EmptyState
                                                    className="mt-4"
                                                    icon={
                                                        <UsersGroupTwoRoundedIcon aria-hidden="true" />
                                                    }
                                                    layout="compact"
                                                    title={m.access_members_empty()}
                                                />
                                            ) : (
                                                <ul
                                                    className="mt-3 divide-y divide-border/40"
                                                    aria-label={m.access_members_title()}>
                                                    {members.map(member => {
                                                        const isCurrent =
                                                            member.userId ===
                                                            access.membership?.userId
                                                        const isPending =
                                                            pendingAction ===
                                                            `member:${member.userId}`

                                                        return (
                                                            <li
                                                                className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                                                                key={member.userId}
                                                                aria-busy={isPending}>
                                                                <div className="flex min-w-0 items-center gap-3">
                                                                    <UserAvatar
                                                                        name={member.name}
                                                                        seed={member.userId}
                                                                        imageUrl={
                                                                            member.userId ===
                                                                            global.session.user.id
                                                                                ? global.session
                                                                                      .user.image
                                                                                : null
                                                                        }
                                                                        size="sm"
                                                                    />
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <p className="truncate text-sm font-medium">
                                                                                {member.name}
                                                                            </p>
                                                                            {isCurrent ? (
                                                                                <Badge variant="outline">
                                                                                    {m.access_current_member()}
                                                                                </Badge>
                                                                            ) : null}
                                                                        </div>
                                                                        <p className="truncate text-xs text-muted-foreground">
                                                                            {member.email}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2 sm:flex sm:shrink-0">
                                                                    {isCurrent ? (
                                                                        <>
                                                                            <div
                                                                                role="group"
                                                                                aria-label={m.access_member_role_label(
                                                                                    {
                                                                                        email: member.email,
                                                                                    }
                                                                                )}>
                                                                                <Badge variant="secondary">
                                                                                    {instanceRoleLabel(
                                                                                        member.role
                                                                                    )}
                                                                                </Badge>
                                                                            </div>
                                                                            <div
                                                                                role="group"
                                                                                aria-label={m.access_member_state_label(
                                                                                    {
                                                                                        email: member.email,
                                                                                    }
                                                                                )}>
                                                                                <Badge variant="secondary">
                                                                                    {member.state ===
                                                                                    'enabled'
                                                                                        ? m.access_state_enabled()
                                                                                        : m.access_state_disabled()}
                                                                                </Badge>
                                                                            </div>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Select
                                                                                items={{
                                                                                    admin: m.access_role_admin(),
                                                                                    member: m.access_role_member(),
                                                                                }}
                                                                                value={member.role}
                                                                                onValueChange={value => {
                                                                                    if (
                                                                                        value !==
                                                                                        null
                                                                                    )
                                                                                        void handleUpdateMember(
                                                                                            member.userId,
                                                                                            {
                                                                                                role: value as AccessInstanceRole,
                                                                                            }
                                                                                        )
                                                                                }}>
                                                                                <SelectTrigger
                                                                                    aria-label={m.access_member_role_label(
                                                                                        {
                                                                                            email: member.email,
                                                                                        }
                                                                                    )}
                                                                                    className="w-full min-w-0 sm:w-32"
                                                                                    disabled={
                                                                                        isCurrent ||
                                                                                        pendingAction !==
                                                                                            null
                                                                                    }
                                                                                    size="sm">
                                                                                    <SelectValue />
                                                                                </SelectTrigger>
                                                                                <SelectContent align="start">
                                                                                    <SelectItem value="admin">
                                                                                        {m.access_role_admin()}
                                                                                    </SelectItem>
                                                                                    <SelectItem value="member">
                                                                                        {m.access_role_member()}
                                                                                    </SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                            <Select
                                                                                items={{
                                                                                    enabled:
                                                                                        m.access_state_enabled(),
                                                                                    disabled:
                                                                                        m.access_state_disabled(),
                                                                                }}
                                                                                value={member.state}
                                                                                onValueChange={value => {
                                                                                    if (
                                                                                        value !==
                                                                                        null
                                                                                    )
                                                                                        void handleUpdateMember(
                                                                                            member.userId,
                                                                                            {
                                                                                                state: value as AccessInstanceMembershipState,
                                                                                            }
                                                                                        )
                                                                                }}>
                                                                                <SelectTrigger
                                                                                    aria-label={m.access_member_state_label(
                                                                                        {
                                                                                            email: member.email,
                                                                                        }
                                                                                    )}
                                                                                    className="w-full min-w-0 sm:min-w-32"
                                                                                    disabled={
                                                                                        isCurrent ||
                                                                                        pendingAction !==
                                                                                            null
                                                                                    }
                                                                                    size="sm">
                                                                                    <SelectValue />
                                                                                </SelectTrigger>
                                                                                <SelectContent align="start">
                                                                                    <SelectItem value="enabled">
                                                                                        {m.access_state_enabled()}
                                                                                    </SelectItem>
                                                                                    <SelectItem value="disabled">
                                                                                        {m.access_state_disabled()}
                                                                                    </SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </li>
                                                        )
                                                    })}
                                                </ul>
                                            )}
                                        </div>

                                        <Dialog
                                            open={inviteOpen}
                                            onOpenChange={open => {
                                                if (pendingAction === null) setInviteOpen(open)
                                            }}>
                                            <DialogContent
                                                className="bg-surface-raised"
                                                showCloseButton={pendingAction === null}>
                                                <DialogHeader>
                                                    <DialogTitle>
                                                        {m.access_invite_to_scope({
                                                            name: 'Postbot',
                                                        })}
                                                    </DialogTitle>
                                                </DialogHeader>
                                                {error ? (
                                                    <Alert variant="destructive">
                                                        <AlertDescription>{error}</AlertDescription>
                                                    </Alert>
                                                ) : null}
                                                <form
                                                    className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
                                                    aria-label={m.access_invite_to_scope({
                                                        name: 'Postbot',
                                                    })}
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
                                                            onChange={event =>
                                                                setEmail(event.target.value)
                                                            }
                                                            placeholder={m.access_invite_email_placeholder()}
                                                        />
                                                    </Field>
                                                    <Button
                                                        type="submit"
                                                        disabled={pendingAction !== null}>
                                                        <AddIcon aria-hidden="true" />
                                                        {m.access_invite_button()}
                                                    </Button>
                                                </form>
                                            </DialogContent>
                                        </Dialog>

                                        {invitations === null || pendingInvitations.length > 0 ? (
                                            <div className="mt-6">
                                                <div className="flex items-center justify-between gap-3">
                                                    <h3 className="text-sm font-medium">
                                                        {m.access_pending_title()}
                                                    </h3>
                                                </div>

                                                {invitations === null ? (
                                                    <p
                                                        className="mt-4 text-sm text-muted-foreground"
                                                        role="status">
                                                        {m.access_instance_loading()}
                                                    </p>
                                                ) : (
                                                    <ul
                                                        className="mt-3 divide-y divide-border/40"
                                                        aria-label={m.access_pending_title()}>
                                                        {pendingInvitations.map(invitation => (
                                                            <li
                                                                className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                                                                key={invitation.id}>
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-medium">
                                                                        {createdInvitation
                                                                            ?.invitation.id ===
                                                                        invitation.id
                                                                            ? m.access_invitation_created_for(
                                                                                  {
                                                                                      email: invitation.targetEmail,
                                                                                  }
                                                                              )
                                                                            : invitation.targetEmail}
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
                                                                    disabled={
                                                                        pendingAction !== null
                                                                    }
                                                                    onClick={() =>
                                                                        void handleRevokeInvitation(
                                                                            invitation.id
                                                                        )
                                                                    }>
                                                                    <TrashBinMinimalisticIcon aria-hidden="true" />
                                                                    {m.access_revoke_invitation()}
                                                                </Button>
                                                                {createdInvitation?.invitation
                                                                    .id === invitation.id ? (
                                                                    <div className="min-w-0 space-y-2 sm:col-span-2">
                                                                        <p className="text-xs text-muted-foreground">
                                                                            {m.access_invitation_copy_once()}
                                                                        </p>
                                                                        <code className="block overflow-x-auto rounded-md bg-surface-field px-3 py-2 text-xs leading-5 text-foreground shadow-field">
                                                                            {createdInvitation.link}
                                                                        </code>
                                                                        {copyError ? (
                                                                            <p
                                                                                className="text-xs text-state-failed"
                                                                                role="alert">
                                                                                {m.access_copy_link_unavailable()}
                                                                            </p>
                                                                        ) : null}
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            onClick={() =>
                                                                                void handleCopyInvitation()
                                                                            }>
                                                                            <CopyIcon aria-hidden="true" />
                                                                            {copied
                                                                                ? m.access_copied()
                                                                                : m.access_copy_link()}
                                                                        </Button>
                                                                    </div>
                                                                ) : null}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        ) : null}
                                    </section>
                                ) : null}
                            </div>
                        </>
                    )}
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
        if (error.code === 'last_admin') return m.access_last_admin()
        if (error.code === 'self_membership_update') return m.access_self_membership_update()
        if (error.code === 'invalid_invitation') return m.access_invalid_invitation()
        if (error.code === 'invitation_not_pending') return m.access_invitation_not_pending()
    }
    return formatApiError(error)
}
