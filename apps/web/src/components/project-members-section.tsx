import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { MenuDotsIcon } from '@solar-icons/react/linear/menu-dots'
import { UserCrossRoundedIcon } from '@solar-icons/react/linear/user-cross-rounded'
import { UserPlusRoundedIcon } from '@solar-icons/react/linear/user-plus-rounded'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { useEffect, useState, type FormEvent } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { EmptyState } from '@/components/empty-state'
import { UserAvatar } from '@/components/identity-visuals'
import { PageColumn } from '@/components/page-column'
import { StatusText } from '@/components/status-text'
import {
    api,
    ApiError,
    formatApiError,
    type ProjectInvitation,
    type ProjectMember,
    type ProjectMemberRole,
    type ProjectTeamGrant,
    type ProjectUserGrant,
    type WorkspaceSummary,
} from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useOptionalProjectAccess } from '@/lib/project-access'
import * as m from '@/paraglide/messages.js'

type EditableProjectRole = Exclude<ProjectMemberRole, 'owner'>

interface CreatedProjectInvitation {
    readonly id: string
    readonly email: string
    readonly link: string
}

interface ProjectMembersSectionProps {
    readonly currentUserId: string
    readonly projectId: string
    readonly projectName: string
    readonly workspaceId: string | null
}

interface ProjectAccessSnapshot {
    readonly userGrants: ProjectUserGrant[]
    readonly teamGrants: ProjectTeamGrant[]
    readonly workspace: WorkspaceSummary | null
}

type AccessRemovalTarget =
    | { readonly kind: 'user'; readonly grant: ProjectUserGrant }
    | { readonly kind: 'team'; readonly grant: ProjectTeamGrant }

const emptyProjectAccessSnapshot: ProjectAccessSnapshot = {
    userGrants: [],
    teamGrants: [],
    workspace: null,
}

export function ProjectMembersSection({
    currentUserId,
    projectId,
    projectName,
    workspaceId,
}: ProjectMembersSectionProps) {
    useLanguage()
    const [form, setForm] = useState<'invite' | 'member' | null>(null)
    const access = useOptionalProjectAccess()
    const [loadedAccessRevision, setLoadedAccessRevision] = useState<number | null>(null)
    const [members, setMembers] = useState<ProjectMember[] | null>(null)
    const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
    const [userGrants, setUserGrants] = useState<ProjectUserGrant[] | null>(null)
    const [teamGrants, setTeamGrants] = useState<ProjectTeamGrant[] | null>(null)
    const [invitations, setInvitations] = useState<ProjectInvitation[] | null>(null)
    const [selectedUserId, setSelectedUserId] = useState('')
    const [selectedTeamId, setSelectedTeamId] = useState('')
    const [directRole, setDirectRole] = useState<EditableProjectRole>('editor')
    const [groupRole, setGroupRole] = useState<EditableProjectRole>('editor')
    const [email, setEmail] = useState('')
    const [inviteRole, setInviteRole] = useState<EditableProjectRole>('editor')
    const [createdInvitation, setCreatedInvitation] = useState<CreatedProjectInvitation | null>(
        null
    )
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState(false)
    const [removalTarget, setRemovalTarget] = useState<AccessRemovalTarget | null>(null)
    const [pendingAction, setPendingAction] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setMembers(null)
        setWorkspace(null)
        setUserGrants(null)
        setTeamGrants(null)
        setInvitations(null)
        setSelectedUserId('')
        setSelectedTeamId('')
        setError(null)
        setNotice(null)
        setCreatedInvitation(null)

        async function load() {
            try {
                const accessSnapshotPromise: Promise<ProjectAccessSnapshot> =
                    workspaceId === null
                        ? Promise.resolve(emptyProjectAccessSnapshot)
                        : Promise.all([
                              api.getWorkspace(workspaceId),
                              api.listProjectUserGrants(projectId),
                              api.listProjectTeamGrants(projectId),
                          ]).then(([workspaceResponse, userGrantResponse, teamGrantResponse]) => ({
                              workspace: workspaceResponse,
                              userGrants: userGrantResponse.grants,
                              teamGrants: teamGrantResponse.grants,
                          }))
                const [memberResponse, accessSnapshot] = await Promise.all([
                    api.listProjectMembers(projectId),
                    accessSnapshotPromise,
                ])
                if (cancelled) return

                setLoadedAccessRevision(access?.revision ?? 0)
                setMembers(memberResponse.members)
                setWorkspace(accessSnapshot.workspace)
                setUserGrants(accessSnapshot.userGrants)
                setTeamGrants(accessSnapshot.teamGrants)
                if (isWorkspaceAdmin(accessSnapshot.workspace)) {
                    const response = await api.listProjectInvitations(projectId)
                    if (!cancelled) setInvitations(response.invitations)
                } else setInvitations([])
            } catch (caughtError) {
                if (!cancelled) {
                    setError(projectMembersErrorMessage(caughtError))
                }
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [currentUserId, projectId, workspaceId, access?.revision])

    const accessSnapshotConfirmed =
        access === null ||
        (access.status === 'confirmed' && loadedAccessRevision === access.revision)
    const canManageProject =
        accessSnapshotConfirmed &&
        (members?.some(member => member.userId === currentUserId && member.role === 'owner') ??
            false)
    const canManageWorkspace = accessSnapshotConfirmed && isWorkspaceAdmin(workspace)
    const canManageAccess = canManageProject || canManageWorkspace
    const pendingInvitations =
        invitations?.filter(invitation => invitation.status === 'pending') ?? []
    const assignableTeams =
        workspace?.teams.filter(team => !teamGrants?.some(grant => grant.teamId === team.id)) ?? []

    async function refreshMembers() {
        const response = await api.listProjectMembers(projectId)
        setMembers(response.members)
    }

    async function handleCreateUserGrant(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (selectedUserId === '' || pendingAction !== null || !canManageAccess) return

        await runAction(`grant-user:${selectedUserId}`, async () => {
            const response = await api.createProjectUserGrant(projectId, selectedUserId, directRole)
            setUserGrants(current => replaceUserGrant(current ?? [], response.grant))
            setSelectedUserId('')
            setForm(null)
            await refreshMembers()
            setNotice(m.access_project_member_updated())
        })
    }

    async function handleCreateTeamGrant(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (selectedTeamId === '' || pendingAction !== null || !canManageAccess) return

        await runAction(`grant-team:${selectedTeamId}`, async () => {
            const response = await api.createProjectTeamGrant(projectId, selectedTeamId, groupRole)
            setTeamGrants(current => replaceTeamGrant(current ?? [], response.grant))
            setSelectedTeamId('')
            await refreshMembers()
            setNotice(m.access_project_member_updated())
        })
    }

    async function handleUpdateUserGrant(grant: ProjectUserGrant, role: EditableProjectRole) {
        if (pendingAction !== null || !canManageAccess || grant.role === 'owner') return

        await runAction(`role-user:${grant.userId}`, async () => {
            const response = await api.updateProjectUserGrant(projectId, grant.userId, role)
            setUserGrants(current => replaceUserGrant(current ?? [], response.grant))
            await refreshMembers()
            setNotice(m.access_project_member_updated())
        })
    }

    async function handleUpdateTeamGrant(grant: ProjectTeamGrant, role: EditableProjectRole) {
        if (pendingAction !== null || !canManageAccess || grant.role === 'owner') return

        await runAction(`role-team:${grant.teamId}`, async () => {
            const response = await api.updateProjectTeamGrant(projectId, grant.teamId, role)
            setTeamGrants(current => replaceTeamGrant(current ?? [], response.grant))
            await refreshMembers()
            setNotice(m.access_project_member_updated())
        })
    }

    async function handleRemoveAccess() {
        if (removalTarget === null || pendingAction !== null || !canManageAccess) return

        const action =
            removalTarget.kind === 'user'
                ? `remove-user:${removalTarget.grant.userId}`
                : `remove-team:${removalTarget.grant.teamId}`

        await runAction(action, async () => {
            if (removalTarget.kind === 'user') {
                await api.removeProjectUserGrant(projectId, removalTarget.grant.userId)
                setUserGrants(
                    current =>
                        current?.filter(grant => grant.userId !== removalTarget.grant.userId) ??
                        null
                )
            } else {
                await api.removeProjectTeamGrant(projectId, removalTarget.grant.teamId)
                setTeamGrants(
                    current =>
                        current?.filter(grant => grant.teamId !== removalTarget.grant.teamId) ??
                        null
                )
            }
            await refreshMembers()
            setRemovalTarget(null)
            setNotice(m.access_project_member_updated())
        })
    }

    async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const normalizedEmail = email.trim().toLowerCase()
        if (normalizedEmail === '' || pendingAction !== null || !canManageWorkspace) return

        await runAction('invite', async () => {
            const response = await api.createProjectInvitation(
                projectId,
                normalizedEmail,
                inviteRole
            )
            const invitationResponse = await api.listProjectInvitations(projectId)
            setCreatedInvitation({
                id: response.invitation.id,
                email: response.invitation.email,
                link: projectInvitationLink(
                    projectId,
                    response.invitation.organizationId,
                    response.invitation.id
                ),
            })
            setCopied(false)
            setCopyError(false)
            setEmail('')
            setInvitations(invitationResponse.invitations)
            setForm(null)
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
        if (pendingAction !== null || !canManageWorkspace) return

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

    async function handleResendInvitation(invitationId: string) {
        if (pendingAction !== null || !canManageWorkspace) return

        await runAction(`resend:${invitationId}`, async () => {
            const response = await api.resendProjectInvitation(projectId, invitationId)
            const invitationResponse = await api.listProjectInvitations(projectId)
            setInvitations(invitationResponse.invitations)
            setCreatedInvitation({
                id: response.invitation.id,
                email: response.invitation.email,
                link: projectInvitationLink(
                    projectId,
                    response.invitation.organizationId,
                    response.invitation.id
                ),
            })
            setCopied(false)
            setCopyError(false)
            setNotice(m.access_project_invitation_resent())
        })
    }

    async function runAction(action: string, operation: () => Promise<void>) {
        if (access !== null && !access.canWrite()) return
        setError(null)
        setNotice(null)
        setPendingAction(action)
        try {
            await operation()
        } catch (caughtError) {
            access?.reportRefusal(caughtError)
            setError(projectMembersErrorMessage(caughtError))
        } finally {
            setPendingAction(null)
        }
    }

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <AccessPageHeader
                column="management"
                title={m.access_title()}
                action={
                    canManageWorkspace ? (
                        <Button
                            onClick={() => {
                                setError(null)
                                setForm('invite')
                            }}>
                            <UserPlusRoundedIcon aria-hidden="true" />
                            {m.access_project_invite_button()}
                        </Button>
                    ) : undefined
                }
            />
            <PageColumn variant="management">
                {error && form === null ? (
                    <Alert className="mb-5" variant="destructive">
                        <AlertTitle>{m.access_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {notice ? (
                    <p className="mb-5 text-sm text-state-success" role="status">
                        {notice}
                    </p>
                ) : null}
                {members === null ? (
                    <p className="text-sm text-muted-foreground" role="status">
                        {m.access_instance_loading()}
                    </p>
                ) : members.length === 0 ? (
                    <EmptyState
                        icon={<UsersGroupTwoRoundedIcon aria-hidden="true" />}
                        layout="compact"
                        title={m.access_project_effective_empty()}
                    />
                ) : (
                    <ul className="divide-y divide-border" aria-label={m.access_members_title()}>
                        {members.map(member => {
                            const direct = userGrants?.find(grant => grant.userId === member.userId)
                            const editable =
                                canManageAccess &&
                                member.userId !== currentUserId &&
                                direct !== undefined &&
                                direct.role !== 'owner'
                            return (
                                <li
                                    key={member.userId}
                                    className="flex min-w-0 items-center gap-3 py-4">
                                    <UserAvatar
                                        imageUrl={member.image}
                                        name={member.name}
                                        seed={member.userId}
                                        size="sm"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                            {member.name}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {member.email}
                                        </p>
                                    </div>
                                    <span className="text-sm text-muted-foreground">
                                        {projectRoleLabel(member.role)}
                                    </span>
                                    {editable ? (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                render={
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={m.people_actions({
                                                            name: member.name,
                                                        })}
                                                        disabled={pendingAction !== null}
                                                    />
                                                }>
                                                <MenuDotsIcon aria-hidden="true" />
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {(['editor', 'viewer'] as const)
                                                    .filter(role => role !== direct.role)
                                                    .map(role => (
                                                        <DropdownMenuItem
                                                            key={role}
                                                            onClick={() =>
                                                                void handleUpdateUserGrant(
                                                                    direct,
                                                                    role
                                                                )
                                                            }>
                                                            {m.people_change_role({
                                                                role: projectRoleLabel(role),
                                                            })}
                                                        </DropdownMenuItem>
                                                    ))}
                                                <DropdownMenuItem
                                                    variant="destructive"
                                                    onClick={() =>
                                                        setRemovalTarget({
                                                            kind: 'user',
                                                            grant: direct,
                                                        })
                                                    }>
                                                    {m.access_project_remove_access_button()}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : null}
                                </li>
                            )
                        })}
                    </ul>
                )}
                {canManageAccess &&
                workspace?.members.some(
                    member => !userGrants?.some(grant => grant.userId === member.userId)
                ) ? (
                    <Button
                        className="mt-4"
                        variant="outline"
                        onClick={() => {
                            setError(null)
                            setForm('member')
                        }}>
                        {m.access_project_add_member()}
                    </Button>
                ) : null}
                {pendingInvitations.length > 0 ? (
                    <section className="mt-8" aria-labelledby="project-invitations-title">
                        <h2
                            id="project-invitations-title"
                            className="font-heading text-base font-medium">
                            {m.access_project_pending_title()}
                        </h2>
                        <ul className="mt-2 divide-y divide-border">
                            {pendingInvitations.map(invitation => (
                                <li
                                    key={invitation.id}
                                    className="flex min-w-0 items-center gap-3 py-4">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm">{invitation.email}</p>
                                        <span className="text-xs text-muted-foreground">
                                            {projectRoleLabel(invitation.role)}
                                        </span>
                                    </div>
                                    <StatusText tone="neutral">
                                        {isProjectInvitationExpired(invitation)
                                            ? m.access_project_invitation_expired()
                                            : m.people_invited()}
                                    </StatusText>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger
                                            render={
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={m.people_actions({
                                                        name: invitation.email,
                                                    })}
                                                    disabled={pendingAction !== null}
                                                />
                                            }>
                                            <MenuDotsIcon aria-hidden="true" />
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    void handleResendInvitation(invitation.id)
                                                }>
                                                {m.access_project_invitation_resend()}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                variant="destructive"
                                                onClick={() =>
                                                    void handleCancelInvitation(invitation.id)
                                                }>
                                                {m.access_project_cancel_invitation()}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
                {createdInvitation ? (
                    <div className="mt-5 space-y-3">
                        <p className="text-sm font-medium">
                            {m.access_project_invitation_created_for({
                                email: createdInvitation.email,
                            })}
                        </p>
                        <code className="block break-all text-xs text-muted-foreground">
                            {createdInvitation.link}
                        </code>
                        {copyError ? (
                            <p role="alert" className="text-sm text-destructive">
                                {m.access_project_copy_link_unavailable()}
                            </p>
                        ) : null}
                        <Button variant="outline" onClick={() => void handleCopyInvitation()}>
                            <CopyIcon aria-hidden="true" />
                            {copied ? m.access_copied() : m.access_project_copy_link()}
                        </Button>
                    </div>
                ) : null}
                {workspace !== null &&
                (workspace.teams.length > 0 || (teamGrants?.length ?? 0) > 0) ? (
                    <div className="mt-10">
                        <GroupAccessSection
                            canManage={canManageAccess}
                            grants={teamGrants}
                            pendingAction={pendingAction}
                            selectedTeamId={selectedTeamId}
                            role={groupRole}
                            assignableTeams={assignableTeams}
                            onRoleChange={setGroupRole}
                            onSelectTeam={setSelectedTeamId}
                            onSubmit={handleCreateTeamGrant}
                            onUpdate={grant =>
                                void handleUpdateTeamGrant(grant, grant.role as EditableProjectRole)
                            }
                            onRemove={grant => setRemovalTarget({ kind: 'team', grant })}
                        />
                    </div>
                ) : null}
            </PageColumn>
            <Dialog
                open={form !== null}
                onOpenChange={open => {
                    if (!open && pendingAction === null) setForm(null)
                }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {form === 'invite'
                                ? m.access_invite_to_scope({ name: projectName })
                                : m.access_project_add_member()}
                        </DialogTitle>
                    </DialogHeader>
                    {error ? (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    ) : null}
                    <form
                        className="grid gap-4"
                        onSubmit={
                            form === 'invite' ? handleCreateInvitation : handleCreateUserGrant
                        }>
                        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                            <Field className="min-w-0 gap-2">
                                <FieldLabel htmlFor="project-member-invite-email">
                                    {form === 'invite'
                                        ? m.access_project_invite_email()
                                        : m.access_members_title()}
                                </FieldLabel>
                                {form === 'invite' ? (
                                    <Input
                                        id="project-member-invite-email"
                                        type="email"
                                        required
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        disabled={pendingAction !== null}
                                        autoComplete="email"
                                    />
                                ) : (
                                    <Select
                                        value={selectedUserId}
                                        onValueChange={value => setSelectedUserId(value ?? '')}>
                                        <SelectTrigger id="project-member-invite-email">
                                            <SelectValue
                                                placeholder={m.access_project_member_placeholder()}
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {workspace?.members
                                                .filter(
                                                    member =>
                                                        !userGrants?.some(
                                                            grant => grant.userId === member.userId
                                                        )
                                                )
                                                .map(member => (
                                                    <SelectItem
                                                        key={member.userId}
                                                        value={member.userId}>
                                                        {member.name}
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </Field>
                            <Field className="min-w-0 gap-2">
                                <FieldLabel htmlFor="project-member-invite-role">
                                    {m.access_project_invite_role()}
                                </FieldLabel>
                                <Select
                                    value={form === 'invite' ? inviteRole : directRole}
                                    onValueChange={value =>
                                        setEditableRole(
                                            value,
                                            form === 'invite' ? setInviteRole : setDirectRole
                                        )
                                    }>
                                    <SelectTrigger
                                        className="w-full"
                                        id="project-member-invite-role">
                                        <SelectValue>
                                            {projectRoleLabel(
                                                form === 'invite' ? inviteRole : directRole
                                            )}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(['editor', 'viewer'] as const).map(role => (
                                            <SelectItem key={role} value={role}>
                                                {projectRoleLabel(role)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                        <DialogFooter>
                            <DialogClose
                                render={
                                    <Button variant="outline" disabled={pendingAction !== null} />
                                }>
                                {m.common_cancel()}
                            </DialogClose>
                            <Button
                                type="submit"
                                disabled={
                                    pendingAction !== null ||
                                    (form === 'member' && selectedUserId === '')
                                }>
                                {form === 'invite'
                                    ? m.access_project_invite_button()
                                    : m.people_add()}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <Dialog
                open={removalTarget !== null}
                onOpenChange={open => {
                    if (!open && pendingAction === null) setRemovalTarget(null)
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.access_project_remove_title()}</DialogTitle>
                        <DialogDescription>
                            {removalTarget?.kind === 'team'
                                ? m.access_project_remove_group_description({
                                      name: removalTarget.grant.teamName,
                                  })
                                : m.access_project_remove_description()}
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
                            onClick={() => void handleRemoveAccess()}>
                            <UserCrossRoundedIcon aria-hidden="true" />
                            {m.access_project_remove_access_button()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}

function GroupAccessSection({
    canManage,
    grants,
    pendingAction,
    selectedTeamId,
    role,
    assignableTeams,
    onRoleChange,
    onSelectTeam,
    onSubmit,
    onUpdate,
    onRemove,
}: {
    readonly canManage: boolean
    readonly grants: ProjectTeamGrant[] | null
    readonly pendingAction: string | null
    readonly selectedTeamId: string
    readonly role: EditableProjectRole
    readonly assignableTeams: WorkspaceSummary['teams']
    readonly onRoleChange: (role: EditableProjectRole) => void
    readonly onSelectTeam: (teamId: string) => void
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
    readonly onUpdate: (grant: ProjectTeamGrant) => void
    readonly onRemove: (grant: ProjectTeamGrant) => void
}) {
    if (grants?.length === 0 && !canManage) return null

    return (
        <section className="min-w-0" aria-labelledby="project-group-access-title">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2
                        id="project-group-access-title"
                        className="font-heading text-base font-medium">
                        {m.access_project_groups_title()}
                    </h2>
                </div>
            </div>

            {grants === null ? (
                <p className="mt-4 text-sm text-muted-foreground" role="status">
                    {m.access_instance_loading()}
                </p>
            ) : grants.length === 0 ? null : (
                <ul className="mt-4 grid gap-2">
                    {grants.map(grant => {
                        const isOwner = grant.role === 'owner'
                        const isPending = pendingAction?.includes(grant.teamId) ?? false
                        return (
                            <li
                                key={grant.id}
                                aria-busy={isPending}
                                className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex size-8 shrink-0 items-center justify-center bg-primary/10 text-primary">
                                        <UsersGroupTwoRoundedIcon
                                            aria-hidden="true"
                                            className="size-4"
                                        />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">
                                            {grant.teamName}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                                    {isOwner ? (
                                        <span className="text-sm text-muted-foreground">
                                            {projectRoleLabel(grant.role)}
                                        </span>
                                    ) : canManage ? (
                                        <>
                                            <Select
                                                value={grant.role}
                                                onValueChange={value => {
                                                    if (value === 'editor' || value === 'viewer') {
                                                        onUpdate({ ...grant, role: value })
                                                    }
                                                }}>
                                                <SelectTrigger
                                                    aria-label={m.access_project_role_label({
                                                        email: grant.teamName,
                                                    })}
                                                    className="min-w-28"
                                                    disabled={pendingAction !== null}
                                                    size="sm">
                                                    <SelectValue>
                                                        {projectRoleLabel(grant.role)}
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
                                                aria-label={`${m.access_project_remove_member()} ${grant.teamName}`}
                                                size="icon-sm"
                                                variant="ghost"
                                                disabled={pendingAction !== null}
                                                onClick={() => onRemove(grant)}>
                                                <UserCrossRoundedIcon aria-hidden="true" />
                                            </Button>
                                        </>
                                    ) : (
                                        <span className="text-sm text-muted-foreground">
                                            {projectRoleLabel(grant.role)}
                                        </span>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}

            {canManage && assignableTeams.length > 0 ? (
                <form
                    className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]"
                    onSubmit={onSubmit}>
                    <Select
                        value={selectedTeamId}
                        onValueChange={value => onSelectTeam(value ?? '')}>
                        <SelectTrigger aria-label={m.access_project_add_group()} size="sm">
                            <SelectValue placeholder={m.access_project_group_placeholder()} />
                        </SelectTrigger>
                        <SelectContent align="start">
                            {assignableTeams.map(team => (
                                <SelectItem key={team.id} value={team.id}>
                                    {team.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={role}
                        onValueChange={value => setEditableRole(value, onRoleChange)}>
                        <SelectTrigger aria-label={m.access_project_invite_role()} size="sm">
                            <SelectValue>{projectRoleLabel(role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="editor">{m.access_project_role_editor()}</SelectItem>
                            <SelectItem value="viewer">{m.access_project_role_viewer()}</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button
                        className="sm:col-span-2 sm:justify-self-end"
                        type="submit"
                        variant="outline"
                        disabled={pendingAction !== null || selectedTeamId === ''}>
                        <UsersGroupTwoRoundedIcon aria-hidden="true" />
                        {m.access_project_group_grant_button()}
                    </Button>
                </form>
            ) : null}
        </section>
    )
}

function isWorkspaceAdmin(workspace: WorkspaceSummary | null) {
    return workspace?.membership.role === 'owner' || workspace?.membership.role === 'admin'
}

function setEditableRole(value: string | null, onChange: (role: EditableProjectRole) => void) {
    if (value === 'editor' || value === 'viewer') onChange(value)
}

function replaceUserGrant(grants: ProjectUserGrant[], replacement: ProjectUserGrant) {
    const index = grants.findIndex(grant => grant.userId === replacement.userId)
    if (index === -1) return [...grants, replacement]
    return grants.map(grant => (grant.userId === replacement.userId ? replacement : grant))
}

function replaceTeamGrant(grants: ProjectTeamGrant[], replacement: ProjectTeamGrant) {
    const index = grants.findIndex(grant => grant.teamId === replacement.teamId)
    if (index === -1) return [...grants, replacement]
    return grants.map(grant => (grant.teamId === replacement.teamId ? replacement : grant))
}

function projectRoleLabel(role: ProjectMemberRole) {
    if (role === 'owner') return m.access_project_role_owner()
    if (role === 'editor') return m.access_project_role_editor()
    return m.access_project_role_viewer()
}

function projectInvitationLink(projectId: string, organizationId: string, invitationId: string) {
    const url = new URL('/invite', window.location.origin)
    url.searchParams.set('invitationId', invitationId)
    url.searchParams.set('organizationId', organizationId)
    url.searchParams.set('projectId', projectId)
    return url.toString()
}

function isProjectInvitationExpired(invitation: ProjectInvitation) {
    return invitation.expiresAt <= Date.now()
}

function projectMembersErrorMessage(error: unknown) {
    if (error instanceof ApiError) {
        if (error.code === 'owner_membership_protected') {
            return m.access_project_owner_protected()
        }
        if (error.code === 'self_membership_update') {
            return m.access_project_self_protected()
        }
        if (error.code === 'workspace_member_requires_grant') {
            return m.access_project_workspace_member_requires_grant()
        }
        if (error.code === 'inherited_membership') {
            return m.access_project_inherited_protected()
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
