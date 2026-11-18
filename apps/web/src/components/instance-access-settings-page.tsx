import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@postdot/ui/components/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { KeyMinimalisticIcon } from '@solar-icons/react/linear/key-minimalistic'
import { MenuDotsIcon } from '@solar-icons/react/linear/menu-dots'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { useEffect, useState, type FormEvent } from 'react'

import { EmptyState } from '@/components/empty-state'
import { UserAvatar } from '@/components/identity-visuals'
import {
    SettingsPage,
    SettingsSection,
    SettingsCard,
    SettingsRow,
} from '@/components/settings-layout'
import {
    api,
    ApiError,
    formatApiError,
    type AccessInstanceMembership,
    type AccessInstanceMembershipUpdate,
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
        <SettingsPage
            title={m.access_instance_title()}
            action={
                access?.isAdmin ? (
                    <Button size="sm" onClick={() => setInviteOpen(true)}>
                        <AddIcon aria-hidden="true" />
                        {m.access_invite_button()}
                    </Button>
                ) : undefined
            }>
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
                <SettingsSection id="installation-loading" title={m.access_instance_title()}>
                    <SettingsCard>
                        <p className="text-sm text-muted-foreground" role="status">
                            {m.access_instance_loading()}
                        </p>
                    </SettingsCard>
                </SettingsSection>
            ) : error !== null ? null : (
                <>
                    {invitationToken ? (
                        <SettingsSection
                            id="accept-invitation-title"
                            title={m.access_accept_invitation_title()}>
                            <SettingsCard>
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
                            </SettingsCard>
                        </SettingsSection>
                    ) : null}

                    {organizationInvitationId ? (
                        <SettingsSection
                            id="accept-organization-invitation-title"
                            title={m.access_accept_invitation_title()}>
                            <SettingsCard>
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
                                        onClick={() => void handleAcceptOrganizationInvitation()}>
                                        {organizationInvitationProjectId === undefined
                                            ? m.access_workspace_invitation_accept_button()
                                            : m.access_project_invitation_accept_button()}
                                    </Button>
                                </div>
                            </SettingsCard>
                        </SettingsSection>
                    ) : null}

                    <div className="grid gap-6">
                        {!access?.isAdmin ? (
                            <SettingsSection
                                id="installation-membership"
                                title={m.access_membership_title()}>
                                <SettingsCard>
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {global.session.user.email}
                                            </p>
                                        </div>
                                        {access ? (
                                            <span className="text-sm text-muted-foreground">
                                                {access.instance.state === 'claimed'
                                                    ? m.access_instance_claimed()
                                                    : m.access_instance_claimable()}
                                            </span>
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
                                            <span className="text-sm text-muted-foreground">
                                                {instanceRoleLabel(access.membership.role)}
                                            </span>
                                        </div>
                                    )}
                                </SettingsCard>
                            </SettingsSection>
                        ) : null}

                        {access?.isAdmin ? (
                            <>
                                <SettingsSection
                                    id="installation-members"
                                    title={m.access_members_title()}>
                                    <SettingsCard>
                                        <div className="flex items-start justify-between gap-3">
                                            <div></div>
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
                                                                key={member.userId}
                                                                aria-busy={isPending}>
                                                                <SettingsRow
                                                                    icon={
                                                                        <UserAvatar
                                                                            name={member.name}
                                                                            seed={member.userId}
                                                                            imageUrl={
                                                                                isCurrent
                                                                                    ? global.session
                                                                                          .user
                                                                                          .image
                                                                                    : null
                                                                            }
                                                                            size="sm"
                                                                        />
                                                                    }
                                                                    title={member.name}
                                                                    description={member.email}
                                                                    control={
                                                                        <div className="flex items-center gap-3">
                                                                            <span
                                                                                role="group"
                                                                                aria-label={m.access_member_role_label(
                                                                                    {
                                                                                        email: member.email,
                                                                                    }
                                                                                )}
                                                                                className="text-sm text-muted-foreground">
                                                                                {instanceRoleLabel(
                                                                                    member.role
                                                                                )}
                                                                            </span>
                                                                            {isCurrent ? (
                                                                                <span
                                                                                    className="sr-only"
                                                                                    role="group"
                                                                                    aria-label={m.access_member_state_label(
                                                                                        {
                                                                                            email: member.email,
                                                                                        }
                                                                                    )}>
                                                                                    {member.state ===
                                                                                    'enabled'
                                                                                        ? m.access_state_enabled()
                                                                                        : m.access_state_disabled()}
                                                                                </span>
                                                                            ) : (
                                                                                <DropdownMenu>
                                                                                    <DropdownMenuTrigger
                                                                                        render={
                                                                                            <Button
                                                                                                variant="ghost"
                                                                                                size="icon-sm"
                                                                                                disabled={
                                                                                                    pendingAction !==
                                                                                                    null
                                                                                                }
                                                                                                aria-label={m.access_member_role_label(
                                                                                                    {
                                                                                                        email: member.email,
                                                                                                    }
                                                                                                )}
                                                                                            />
                                                                                        }>
                                                                                        <MenuDotsIcon />
                                                                                    </DropdownMenuTrigger>
                                                                                    <DropdownMenuContent align="end">
                                                                                        {(
                                                                                            [
                                                                                                'admin',
                                                                                                'member',
                                                                                            ] as const
                                                                                        ).map(
                                                                                            role => (
                                                                                                <DropdownMenuItem
                                                                                                    key={
                                                                                                        role
                                                                                                    }
                                                                                                    disabled={
                                                                                                        member.role ===
                                                                                                        role
                                                                                                    }
                                                                                                    onClick={() =>
                                                                                                        void handleUpdateMember(
                                                                                                            member.userId,
                                                                                                            {
                                                                                                                role,
                                                                                                            }
                                                                                                        )
                                                                                                    }>
                                                                                                    {instanceRoleLabel(
                                                                                                        role
                                                                                                    )}
                                                                                                </DropdownMenuItem>
                                                                                            )
                                                                                        )}
                                                                                        <DropdownMenuItem
                                                                                            onClick={() =>
                                                                                                void handleUpdateMember(
                                                                                                    member.userId,
                                                                                                    {
                                                                                                        state:
                                                                                                            member.state ===
                                                                                                            'enabled'
                                                                                                                ? 'disabled'
                                                                                                                : 'enabled',
                                                                                                    }
                                                                                                )
                                                                                            }>
                                                                                            {member.state ===
                                                                                            'enabled'
                                                                                                ? m.access_state_disabled()
                                                                                                : m.access_state_enabled()}
                                                                                        </DropdownMenuItem>
                                                                                    </DropdownMenuContent>
                                                                                </DropdownMenu>
                                                                            )}
                                                                        </div>
                                                                    }
                                                                />
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
                                                            name: 'Postdot',
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
                                                        name: 'Postdot',
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
                                    </SettingsCard>
                                </SettingsSection>
                                {invitations === null || pendingInvitations.length > 0 ? (
                                    <SettingsSection
                                        id="installation-invitations"
                                        title={m.access_pending_title()}>
                                        <SettingsCard>
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
                                                        <li key={invitation.id}>
                                                            <SettingsRow
                                                                title={
                                                                    createdInvitation?.invitation
                                                                        .id === invitation.id
                                                                        ? m.access_invitation_created_for(
                                                                              {
                                                                                  email: invitation.targetEmail,
                                                                              }
                                                                          )
                                                                        : invitation.targetEmail
                                                                }
                                                                description={formatInvitationExpiry(
                                                                    invitation.expiresAt,
                                                                    locale
                                                                )}
                                                                control={
                                                                    <DropdownMenu>
                                                                        <DropdownMenuTrigger
                                                                            render={
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon-sm"
                                                                                    aria-label={m.people_actions(
                                                                                        {
                                                                                            name: invitation.targetEmail,
                                                                                        }
                                                                                    )}
                                                                                    disabled={
                                                                                        pendingAction !==
                                                                                        null
                                                                                    }
                                                                                />
                                                                            }>
                                                                            <MenuDotsIcon aria-hidden="true" />
                                                                        </DropdownMenuTrigger>
                                                                        <DropdownMenuContent align="end">
                                                                            <DropdownMenuItem
                                                                                disabled={
                                                                                    pendingAction !==
                                                                                    null
                                                                                }
                                                                                onClick={() =>
                                                                                    void handleRevokeInvitation(
                                                                                        invitation.id
                                                                                    )
                                                                                }>
                                                                                {m.access_revoke_invitation()}
                                                                            </DropdownMenuItem>
                                                                        </DropdownMenuContent>
                                                                    </DropdownMenu>
                                                                }
                                                            />
                                                            {createdInvitation?.invitation.id ===
                                                            invitation.id ? (
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
                                        </SettingsCard>
                                    </SettingsSection>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                </>
            )}
        </SettingsPage>
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
