import { Alert, AlertDescription, AlertTitle } from '@postbot/ui/components/alert'
import { Badge } from '@postbot/ui/components/badge'
import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { UserCrossRoundedIcon } from '@solar-icons/react/linear/user-cross-rounded'
import { UserPlusRoundedIcon } from '@solar-icons/react/linear/user-plus-rounded'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { useEffect, useState, type FormEvent } from 'react'

import { EmptyState } from '@/components/empty-state'
import { UserAvatar } from '@/components/identity-visuals'
import {
    api,
    ApiError,
    formatApiError,
    type ProjectInvitation,
    type ProjectMember,
    type ProjectMemberRole,
    type ProjectTeamGrant,
    type ProjectUserGrant,
    type WorkspaceMember,
    type WorkspaceSummary,
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
    readonly projectId: string
    readonly projectName: string
    readonly view: 'access' | 'invitations'
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
    view,
    workspaceId,
}: ProjectMembersSectionProps) {
    const { locale } = useLanguage()
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
                if (view === 'invitations') {
                    if (workspaceId === null) {
                        setInvitations([])
                        return
                    }

                    const workspaceResponse = await api.getWorkspace(workspaceId)
                    if (cancelled) return
                    setWorkspace(workspaceResponse)

                    if (!isWorkspaceAdmin(workspaceResponse)) {
                        setInvitations([])
                        return
                    }

                    const invitationResponse = await api.listProjectInvitations(projectId)
                    if (!cancelled) setInvitations(invitationResponse.invitations)
                    return
                }

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

                setMembers(memberResponse.members)
                setWorkspace(accessSnapshot.workspace)
                setUserGrants(accessSnapshot.userGrants)
                setTeamGrants(accessSnapshot.teamGrants)
                setInvitations([])
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
    }, [currentUserId, projectId, view, workspaceId])

    const canManageProject =
        members?.some(member => member.userId === currentUserId && member.role === 'owner') ?? false
    const canManageWorkspace = isWorkspaceAdmin(workspace)
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
            <section aria-label={m.access_title()} className="min-w-0">
                {error ? (
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

                {view === 'access' ? (
                    <>
                        <section aria-labelledby="project-effective-access-title">
                            <div className="flex items-center justify-between gap-3">
                                <h2
                                    id="project-effective-access-title"
                                    className="text-sm font-medium">
                                    {m.access_project_effective_title()}
                                </h2>
                                {members && members.length > 0 ? (
                                    <span className="text-xs tabular-nums text-muted-foreground">
                                        {members.length}
                                    </span>
                                ) : null}
                            </div>

                            {members === null ? (
                                <p className="mt-4 text-sm text-muted-foreground" role="status">
                                    {m.access_instance_loading()}
                                </p>
                            ) : members.length === 0 ? (
                                <EmptyState
                                    className="mt-4"
                                    icon={<UsersGroupTwoRoundedIcon aria-hidden="true" />}
                                    layout="compact"
                                    title={m.access_project_effective_empty()}
                                />
                            ) : (
                                <ul
                                    className="mt-4 grid gap-2"
                                    aria-label={m.access_project_effective_title()}>
                                    {members.map(member => {
                                        const directGrant = userGrants?.find(
                                            grant => grant.userId === member.userId
                                        )
                                        const isCurrent = member.userId === currentUserId
                                        const sourceLabel =
                                            member.role === 'owner'
                                                ? m.access_project_access_owner()
                                                : directGrant === undefined
                                                  ? m.access_project_access_inherited()
                                                  : m.access_project_access_direct()

                                        return (
                                            <li
                                                key={member.userId}
                                                className="flex min-w-0 flex-col gap-3 bg-surface-inset/45 p-3 shadow-field sm:flex-row sm:items-center sm:justify-between">
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
                                                    <Badge
                                                        variant={
                                                            member.role === 'owner'
                                                                ? 'default'
                                                                : 'secondary'
                                                        }>
                                                        {projectRoleLabel(member.role)}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {sourceLabel}
                                                    </span>
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </section>

                        {workspace !== null ? (
                            <div className="mt-6 grid gap-4 lg:grid-cols-2">
                                <DirectAccessSection
                                    canManage={canManageAccess}
                                    grants={userGrants}
                                    members={workspace.members}
                                    pendingAction={pendingAction}
                                    selectedUserId={selectedUserId}
                                    role={directRole}
                                    onRoleChange={setDirectRole}
                                    onSelectUser={setSelectedUserId}
                                    onSubmit={handleCreateUserGrant}
                                    onUpdate={grant =>
                                        void handleUpdateUserGrant(
                                            grant,
                                            grant.role as EditableProjectRole
                                        )
                                    }
                                    onRemove={grant => setRemovalTarget({ kind: 'user', grant })}
                                />
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
                                        void handleUpdateTeamGrant(
                                            grant,
                                            grant.role as EditableProjectRole
                                        )
                                    }
                                    onRemove={grant => setRemovalTarget({ kind: 'team', grant })}
                                />
                            </div>
                        ) : null}
                    </>
                ) : canManageWorkspace ? (
                    <InvitationSection
                        projectName={projectName}
                        copied={copied}
                        copyError={copyError}
                        createdInvitation={createdInvitation}
                        email={email}
                        inviteRole={inviteRole}
                        invitations={invitations}
                        locale={locale}
                        pendingAction={pendingAction}
                        pendingInvitations={pendingInvitations}
                        onCancel={invitationId => void handleCancelInvitation(invitationId)}
                        onCopy={() => void handleCopyInvitation()}
                        onEmailChange={setEmail}
                        onInviteRoleChange={setInviteRole}
                        onResend={invitationId => void handleResendInvitation(invitationId)}
                        onSubmit={handleCreateInvitation}
                    />
                ) : workspace !== null ? (
                    <p className="mt-5 text-xs text-muted-foreground">
                        {m.access_project_workspace_admin_required()}
                    </p>
                ) : null}
            </section>

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
        </>
    )
}

function DirectAccessSection({
    canManage,
    grants,
    members,
    pendingAction,
    selectedUserId,
    role,
    onRoleChange,
    onSelectUser,
    onSubmit,
    onUpdate,
    onRemove,
}: {
    readonly canManage: boolean
    readonly grants: ProjectUserGrant[] | null
    readonly members: WorkspaceMember[]
    readonly pendingAction: string | null
    readonly selectedUserId: string
    readonly role: EditableProjectRole
    readonly onRoleChange: (role: EditableProjectRole) => void
    readonly onSelectUser: (userId: string) => void
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
    readonly onUpdate: (grant: ProjectUserGrant) => void
    readonly onRemove: (grant: ProjectUserGrant) => void
}) {
    const availableMembers = members.filter(
        member => !grants?.some(grant => grant.userId === member.userId)
    )

    if (grants?.length === 0 && !canManage) return null

    return (
        <section
            className="min-w-0 bg-surface-inset/45 p-4 shadow-surface"
            aria-labelledby="project-direct-access-title">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="project-direct-access-title" className="text-sm font-medium">
                        {m.access_project_direct_title()}
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
                        const member = members.find(candidate => candidate.userId === grant.userId)
                        const isOwner = grant.role === 'owner'
                        const isPending = pendingAction?.includes(grant.userId) ?? false

                        return (
                            <li
                                key={grant.id}
                                aria-busy={isPending}
                                className="flex min-w-0 flex-col gap-3 bg-surface-raised p-3 shadow-field sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <UserAvatar
                                        imageUrl={member?.image ?? null}
                                        name={member?.name ?? grant.userId}
                                        seed={grant.userId}
                                        size="sm"
                                    />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">
                                            {member?.name ?? grant.userId}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {member?.email ?? grant.userId}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                                    {isOwner ? (
                                        <Badge>{projectRoleLabel(grant.role)}</Badge>
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
                                                        email: member?.email ?? grant.userId,
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
                                                aria-label={`${m.access_project_remove_member()} ${member?.name ?? grant.userId}`}
                                                size="icon-sm"
                                                variant="ghost"
                                                disabled={pendingAction !== null}
                                                onClick={() => onRemove(grant)}>
                                                <UserCrossRoundedIcon aria-hidden="true" />
                                            </Button>
                                        </>
                                    ) : (
                                        <Badge variant="secondary">
                                            {projectRoleLabel(grant.role)}
                                        </Badge>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}

            {canManage && availableMembers.length > 0 ? (
                <form
                    className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]"
                    onSubmit={onSubmit}>
                    <Select
                        value={selectedUserId}
                        onValueChange={value => onSelectUser(value ?? '')}>
                        <SelectTrigger aria-label={m.access_project_add_member()} size="sm">
                            <SelectValue placeholder={m.access_project_member_placeholder()} />
                        </SelectTrigger>
                        <SelectContent align="start">
                            {availableMembers.map(member => (
                                <SelectItem key={member.userId} value={member.userId}>
                                    {member.name}
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
                        size="sm"
                        disabled={pendingAction !== null || selectedUserId === ''}>
                        <UserPlusRoundedIcon aria-hidden="true" />
                        {m.access_project_grant_button()}
                    </Button>
                </form>
            ) : null}
        </section>
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
        <section
            className="min-w-0 bg-surface-inset/45 p-4 shadow-surface"
            aria-labelledby="project-group-access-title">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="project-group-access-title" className="text-sm font-medium">
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
                                className="flex min-w-0 flex-col gap-3 bg-surface-raised p-3 shadow-field sm:flex-row sm:items-center sm:justify-between">
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
                                        <Badge>{projectRoleLabel(grant.role)}</Badge>
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
                                        <Badge variant="secondary">
                                            {projectRoleLabel(grant.role)}
                                        </Badge>
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
                        size="sm"
                        disabled={pendingAction !== null || selectedTeamId === ''}>
                        <UsersGroupTwoRoundedIcon aria-hidden="true" />
                        {m.access_project_group_grant_button()}
                    </Button>
                </form>
            ) : null}
        </section>
    )
}

function InvitationSection({
    projectName,
    copied,
    copyError,
    createdInvitation,
    email,
    inviteRole,
    invitations,
    locale,
    pendingAction,
    pendingInvitations,
    onCancel,
    onCopy,
    onEmailChange,
    onInviteRoleChange,
    onResend,
    onSubmit,
}: {
    readonly projectName: string
    readonly copied: boolean
    readonly copyError: boolean
    readonly createdInvitation: CreatedProjectInvitation | null
    readonly email: string
    readonly inviteRole: EditableProjectRole
    readonly invitations: ProjectInvitation[] | null
    readonly locale: string
    readonly pendingAction: string | null
    readonly pendingInvitations: ProjectInvitation[]
    readonly onCancel: (invitationId: string) => void
    readonly onCopy: () => void
    readonly onEmailChange: (email: string) => void
    readonly onInviteRoleChange: (role: EditableProjectRole) => void
    readonly onResend: (invitationId: string) => void
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
    return (
        <section
            className="mt-6 bg-surface-inset/45 p-4 shadow-surface"
            aria-labelledby="project-invite-title">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="project-invite-title" className="text-sm font-medium">
                        {m.access_invite_to_scope({ name: projectName })}
                    </h2>
                </div>
            </div>

            <form
                className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
                onSubmit={onSubmit}>
                <Field className="min-w-0 gap-1.5">
                    <FieldLabel htmlFor="project-member-invite-email">
                        {m.access_project_invite_email()}
                    </FieldLabel>
                    <Input
                        id="project-member-invite-email"
                        type="email"
                        required
                        value={email}
                        onChange={event => onEmailChange(event.target.value)}
                        placeholder={m.access_project_invite_email_placeholder()}
                    />
                </Field>
                <Field className="gap-1.5">
                    <FieldLabel htmlFor="project-member-invite-role">
                        {m.access_project_invite_role()}
                    </FieldLabel>
                    <Select
                        value={inviteRole}
                        onValueChange={value => setEditableRole(value, onInviteRoleChange)}>
                        <SelectTrigger id="project-member-invite-role" size="sm">
                            <SelectValue>{projectRoleLabel(inviteRole)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="editor">{m.access_project_role_editor()}</SelectItem>
                            <SelectItem value="viewer">{m.access_project_role_viewer()}</SelectItem>
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
                    <Button type="button" className="mt-3" size="sm" onClick={onCopy}>
                        <CopyIcon aria-hidden="true" />
                        {copied ? m.access_copied() : m.access_project_copy_link()}
                    </Button>
                </div>
            ) : null}

            {invitations === null || pendingInvitations.length > 0 ? (
                <div className="mt-6">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-medium">{m.access_project_pending_title()}</h3>
                        <span className="text-xs tabular-nums text-muted-foreground">
                            {pendingInvitations.length}
                        </span>
                    </div>

                    {invitations === null ? (
                        <p className="mt-4 text-sm text-muted-foreground" role="status">
                            {m.access_instance_loading()}
                        </p>
                    ) : (
                        <ul
                            className="mt-3 grid gap-2"
                            aria-label={m.access_project_pending_title()}>
                            {pendingInvitations.map(invitation => (
                                <li
                                    key={invitation.id}
                                    className="flex min-w-0 flex-col gap-3 bg-surface-raised p-3 shadow-field sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <p className="truncate text-sm font-medium">
                                                {invitation.email}
                                            </p>
                                            {isProjectInvitationExpired(invitation) ? (
                                                <Badge variant="secondary">
                                                    {m.access_project_invitation_expired()}
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {projectInvitationDetails(invitation, locale)}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            type="button"
                                            aria-label={`${m.access_project_invitation_resend()} ${invitation.email}`}
                                            size="sm"
                                            variant="ghost"
                                            disabled={pendingAction !== null}
                                            onClick={() => onResend(invitation.id)}>
                                            <RestartIcon aria-hidden="true" />
                                            {m.access_project_invitation_resend()}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            disabled={pendingAction !== null}
                                            onClick={() => onCancel(invitation.id)}>
                                            {m.access_project_cancel_invitation()}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
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
