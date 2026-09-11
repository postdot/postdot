import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { CopyIcon } from '@solar-icons/react/bold/copy'
import { UserCrossRoundedIcon } from '@solar-icons/react/bold/user-cross-rounded'
import { UserPlusRoundedIcon } from '@solar-icons/react/bold/user-plus-rounded'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/bold/users-group-two-rounded'
import { useEffect, useState, type FormEvent } from 'react'

import { UserAvatar } from '@/components/identity-visuals'
import {
    api,
    ApiError,
    formatApiError,
    type ProjectInvitation,
    type ProjectMember,
    type ProjectMemberRole,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

type EditableProjectRole = Exclude<ProjectMemberRole, 'owner'>

interface CreatedProjectInvitation {
    readonly id: string
    readonly email: string
    readonly link: string
}

interface ProjectMembersSectionProps {
    readonly currentUserId: string
    readonly onManageabilityChange: (canManage: boolean | null) => void
    readonly projectId: string
}

export function ProjectMembersSection({
    currentUserId,
    onManageabilityChange,
    projectId,
}: ProjectMembersSectionProps) {
    const { locale } = useLanguage()
    const [members, setMembers] = useState<ProjectMember[] | null>(null)
    const [invitations, setInvitations] = useState<ProjectInvitation[] | null>(null)
    const [email, setEmail] = useState('')
    const [inviteRole, setInviteRole] = useState<EditableProjectRole>('editor')
    const [createdInvitation, setCreatedInvitation] = useState<CreatedProjectInvitation | null>(
        null
    )
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState(false)
    const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null)
    const [pendingAction, setPendingAction] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        onManageabilityChange(null)
        setMembers(null)
        setInvitations(null)
        setError(null)
        setNotice(null)
        setCreatedInvitation(null)

        async function load() {
            try {
                const memberResponse = await api.listProjectMembers(projectId)
                if (cancelled) return

                setMembers(memberResponse.members)
                const canManage =
                    memberResponse.members.find(member => member.userId === currentUserId)?.role ===
                    'owner'
                onManageabilityChange(canManage)

                if (!canManage) {
                    setInvitations([])
                    return
                }

                const invitationResponse = await api.listProjectInvitations(projectId)
                if (!cancelled) setInvitations(invitationResponse.invitations)
            } catch (caughtError) {
                if (!cancelled) {
                    setError(projectMembersErrorMessage(caughtError))
                    onManageabilityChange(false)
                }
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [currentUserId, onManageabilityChange, projectId])

    const currentMember = members?.find(member => member.userId === currentUserId) ?? null
    const canManage = currentMember?.role === 'owner'
    const pendingInvitations =
        invitations?.filter(invitation => invitation.status === 'pending') ?? []

    async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const normalizedEmail = email.trim().toLowerCase()
        if (normalizedEmail === '' || pendingAction !== null || !canManage) return

        await runAction('invite', async () => {
            const response = await api.createProjectInvitation(
                projectId,
                normalizedEmail,
                inviteRole
            )
            const url = new URL('/dashboard/settings/access', window.location.origin)
            url.searchParams.set('projectId', projectId)
            url.searchParams.set('organizationInvitation', response.invitation.id)
            setCreatedInvitation({
                id: response.invitation.id,
                email: response.invitation.email,
                link: url.toString(),
            })
            setCopied(false)
            setCopyError(false)
            setEmail('')
            setInvitations(current =>
                current === null ? [response.invitation] : [response.invitation, ...current]
            )
            setNotice(m.access_project_invitation_created())
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

    async function handleCancelInvitation(invitationId: string) {
        if (pendingAction !== null || !canManage) return

        await runAction(`cancel:${invitationId}`, async () => {
            const response = await api.cancelProjectInvitation(projectId, invitationId)
            setInvitations(
                current =>
                    current?.map(invitation =>
                        invitation.id === invitationId ? response.invitation : invitation
                    ) ?? null
            )
            if (createdInvitation?.id === invitationId) setCreatedInvitation(null)
            setNotice(m.access_project_invitation_canceled())
        })
    }

    async function handleUpdateMember(member: ProjectMember, role: EditableProjectRole) {
        if (
            pendingAction !== null ||
            !canManage ||
            member.userId === currentUserId ||
            member.role === 'owner'
        )
            return

        await runAction(`role:${member.id}`, async () => {
            const response = await api.updateProjectMember(projectId, member.id, role)
            setMembers(
                current =>
                    current?.map(candidate =>
                        candidate.id === member.id ? response.membership : candidate
                    ) ?? null
            )
            setNotice(m.access_project_member_updated())
        })
    }

    async function handleRemoveMember() {
        if (memberToRemove === null || pendingAction !== null || !canManage) return
        const memberId = memberToRemove.id

        await runAction(`remove:${memberId}`, async () => {
            await api.removeProjectMember(projectId, memberId)
            setMembers(current => current?.filter(member => member.id !== memberId) ?? null)
            setMemberToRemove(null)
            setNotice(m.access_project_member_updated())
        })
    }

    async function runAction(action: string, operation: () => Promise<void>) {
        setError(null)
        setNotice(null)
        setPendingAction(action)
        try {
            await operation()
        } catch (caughtError) {
            setError(projectMembersErrorMessage(caughtError))
        } finally {
            setPendingAction(null)
        }
    }

    return (
        <>
            <section
                aria-labelledby="project-members-title"
                className="bg-surface-raised p-5 shadow-surface sm:p-6">
                <header className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <UsersGroupTwoRoundedIcon
                            aria-hidden="true"
                            className="size-5 shrink-0 text-primary"
                        />
                        <h2
                            id="project-members-title"
                            className="font-heading text-base font-medium">
                            {m.access_project_members()}
                        </h2>
                    </div>
                    {members ? (
                        <span className="text-xs tabular-nums text-muted-foreground">
                            {members.length}
                        </span>
                    ) : null}
                </header>

                {error ? (
                    <Alert className="mt-5" variant="destructive">
                        <AlertTitle>{m.access_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {notice ? (
                    <p className="mt-4 text-sm text-state-success" role="status">
                        {notice}
                    </p>
                ) : null}

                {members === null ? (
                    <p className="mt-5 text-sm text-muted-foreground" role="status">
                        {m.access_instance_loading()}
                    </p>
                ) : members.length === 0 ? (
                    <p className="mt-5 text-sm text-muted-foreground">
                        {m.access_project_members_empty()}
                    </p>
                ) : (
                    <ul className="mt-5 grid gap-2" aria-label={m.access_project_members()}>
                        {members.map(member => {
                            const isCurrent = member.userId === currentUserId
                            const isPending =
                                pendingAction === `role:${member.id}` ||
                                pendingAction === `remove:${member.id}`

                            return (
                                <li
                                    key={member.id}
                                    aria-busy={isPending}
                                    className="flex min-w-0 flex-col gap-3 bg-muted/60 p-3 shadow-field sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <UserAvatar
                                            imageUrl={member.image}
                                            name={member.name}
                                            seed={member.userId}
                                            size="sm"
                                        />
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-2">
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

                                    <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                                        {canManage && !isCurrent && member.role !== 'owner' ? (
                                            <>
                                                <Select
                                                    value={member.role}
                                                    onValueChange={value => {
                                                        if (
                                                            value === 'editor' ||
                                                            value === 'viewer'
                                                        ) {
                                                            void handleUpdateMember(member, value)
                                                        }
                                                    }}>
                                                    <SelectTrigger
                                                        aria-label={m.access_project_role_label({
                                                            email: member.email,
                                                        })}
                                                        className="min-w-28"
                                                        disabled={pendingAction !== null}
                                                        size="sm">
                                                        <SelectValue>
                                                            {projectRoleLabel(member.role)}
                                                        </SelectValue>
                                                    </SelectTrigger>
                                                    <SelectContent align="start">
                                                        <SelectItem value="editor">
                                                            {m.access_project_role_editor()}
                                                        </SelectItem>
                                                        <SelectItem value="viewer">
                                                            {m.access_project_role_viewer()}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    type="button"
                                                    aria-label={`${m.access_project_remove_member()} ${member.name}`}
                                                    size="icon-sm"
                                                    variant="ghost"
                                                    disabled={pendingAction !== null}
                                                    onClick={() => setMemberToRemove(member)}>
                                                    <UserCrossRoundedIcon aria-hidden="true" />
                                                </Button>
                                            </>
                                        ) : (
                                            <Badge
                                                variant={
                                                    member.role === 'owner'
                                                        ? 'default'
                                                        : 'secondary'
                                                }>
                                                {projectRoleLabel(member.role)}
                                            </Badge>
                                        )}
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}

                {canManage ? (
                    <>
                        <form
                            className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
                            onSubmit={handleCreateInvitation}>
                            <Field className="min-w-0 gap-1.5">
                                <FieldLabel htmlFor="project-member-invite-email">
                                    {m.access_project_invite_email()}
                                </FieldLabel>
                                <Input
                                    id="project-member-invite-email"
                                    type="email"
                                    required
                                    value={email}
                                    onChange={event => setEmail(event.target.value)}
                                    placeholder={m.access_project_invite_email_placeholder()}
                                />
                            </Field>
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor="project-member-invite-role">
                                    {m.access_project_invite_role()}
                                </FieldLabel>
                                <Select
                                    value={inviteRole}
                                    onValueChange={value => {
                                        if (value === 'editor' || value === 'viewer') {
                                            setInviteRole(value)
                                        }
                                    }}>
                                    <SelectTrigger id="project-member-invite-role" size="sm">
                                        <SelectValue>{projectRoleLabel(inviteRole)}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent align="start">
                                        <SelectItem value="editor">
                                            {m.access_project_role_editor()}
                                        </SelectItem>
                                        <SelectItem value="viewer">
                                            {m.access_project_role_viewer()}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Button type="submit" disabled={pendingAction !== null}>
                                <UserPlusRoundedIcon aria-hidden="true" />
                                {m.access_project_invite_button()}
                            </Button>
                        </form>

                        {createdInvitation ? (
                            <div className="mt-5 bg-primary/10 p-4 shadow-surface">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">
                                            {m.access_project_invitation_created_for({
                                                email: createdInvitation.email,
                                            })}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {m.access_project_invitation_copy_once()}
                                        </p>
                                    </div>
                                    <Badge variant="default">{m.access_pending()}</Badge>
                                </div>
                                <code className="mt-3 block overflow-x-auto bg-background px-3 py-2 text-xs leading-5 text-foreground shadow-field">
                                    {createdInvitation.link}
                                </code>
                                {copyError ? (
                                    <p className="mt-2 text-xs text-state-failed" role="alert">
                                        {m.access_project_copy_link_unavailable()}
                                    </p>
                                ) : null}
                                <Button
                                    type="button"
                                    className="mt-3"
                                    size="sm"
                                    onClick={() => void handleCopyInvitation()}>
                                    <CopyIcon aria-hidden="true" />
                                    {copied ? m.access_copied() : m.access_project_copy_link()}
                                </Button>
                            </div>
                        ) : null}

                        <div className="mt-6">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-sm font-medium">
                                    {m.access_project_pending_title()}
                                </h3>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {pendingInvitations.length}
                                </span>
                            </div>

                            {invitations === null ? (
                                <p className="mt-4 text-sm text-muted-foreground" role="status">
                                    {m.access_instance_loading()}
                                </p>
                            ) : pendingInvitations.length === 0 ? (
                                <p className="mt-4 text-sm text-muted-foreground">
                                    {m.access_project_pending_empty()}
                                </p>
                            ) : (
                                <ul
                                    className="mt-3 grid gap-2"
                                    aria-label={m.access_project_pending_title()}>
                                    {pendingInvitations.map(invitation => (
                                        <li
                                            key={invitation.id}
                                            className="flex min-w-0 flex-col gap-3 bg-muted/60 p-3 shadow-field sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">
                                                    {invitation.email}
                                                </p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {projectInvitationDetails(invitation, locale)}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                disabled={pendingAction !== null}
                                                onClick={() =>
                                                    void handleCancelInvitation(invitation.id)
                                                }>
                                                {m.access_project_cancel_invitation()}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </>
                ) : null}
            </section>

            <Dialog
                open={memberToRemove !== null}
                onOpenChange={open => {
                    if (!open && pendingAction === null) setMemberToRemove(null)
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.access_project_remove_title()}</DialogTitle>
                        <DialogDescription>
                            {m.access_project_remove_description()}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose
                            render={<Button variant="ghost" disabled={pendingAction !== null} />}>
                            {m.common_cancel()}
                        </DialogClose>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={pendingAction !== null}
                            onClick={() => void handleRemoveMember()}>
                            <UserCrossRoundedIcon aria-hidden="true" />
                            {m.access_project_remove_button()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

function projectRoleLabel(role: ProjectMemberRole) {
    if (role === 'owner') return m.access_project_role_owner()
    if (role === 'editor') return m.access_project_role_editor()
    return m.access_project_role_viewer()
}

function projectInvitationDetails(invitation: ProjectInvitation, locale: string) {
    return `${projectRoleLabel(invitation.role)} · ${m.access_project_invitation_expires({
        date: formatDateTime(invitation.expiresAt, 'UTC', locale),
    })}`
}

function projectMembersErrorMessage(error: unknown) {
    if (error instanceof ApiError) {
        if (error.code === 'owner_membership_protected') {
            return m.access_project_owner_protected()
        }
        if (error.code === 'self_membership_update') {
            return m.access_project_self_protected()
        }
        if (error.code === 'organization_operation_failed') {
            return m.access_project_invitation_failed()
        }
        if (error.code === 'invitation_not_pending') {
            return m.access_invitation_not_pending()
        }
    }
    return formatApiError(error)
}
