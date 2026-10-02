import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@herald/ui/components/tabs'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { PenIcon } from '@solar-icons/react/linear/pen'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
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
    type WorkspaceInvitation,
    type WorkspaceSummary,
    type ProjectTeamGrant,
    type WorkspaceTeamMember,
} from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import * as m from '@/paraglide/messages.js'

interface WorkspaceGroupsSectionProps {
    readonly workspaceId: string
}

type TeamMembersById = Record<string, WorkspaceTeamMember[]>

interface WorkspaceTeamProject {
    readonly id: string
    readonly name: string
    readonly role: ProjectTeamGrant['role']
}

type TeamProjectsById = Record<string, WorkspaceTeamProject[]>

export function WorkspaceGroupsSection({ workspaceId }: WorkspaceGroupsSectionProps) {
    const { session } = useDashboardGlobal()
    const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
    const [teamMembers, setTeamMembers] = useState<TeamMembersById>({})
    const [teamProjects, setTeamProjects] = useState<TeamProjectsById>({})
    const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
    const [addingToTeam, setAddingToTeam] = useState<string | null>(null)
    const [view, setView] = useState('members')
    const [activeForm, setActiveForm] = useState<'invite' | 'group' | null>(null)
    const [newTeamName, setNewTeamName] = useState('')
    const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
    const [editingTeamName, setEditingTeamName] = useState('')
    const [selectedMemberByTeam, setSelectedMemberByTeam] = useState<Record<string, string>>({})
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteTeamId, setInviteTeamId] = useState('')
    const [pendingAction, setPendingAction] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [reloadVersion, setReloadVersion] = useState(0)

    useEffect(() => {
        let cancelled = false

        async function load() {
            setWorkspace(null)
            setTeamMembers({})
            setTeamProjects({})
            setInvitations([])
            setSelectedMemberByTeam({})
            setEditingTeamId(null)
            setActiveForm(null)
            setNewTeamName('')
            setInviteEmail('')
            setInviteTeamId('')
            setError(null)
            setNotice(null)

            try {
                const summary = await api.getWorkspace(workspaceId)
                const canManageSummary =
                    summary.membership.role === 'owner' || summary.membership.role === 'admin'
                const [members, workspaceInvitations, workspaceProjects] = await Promise.all([
                    Promise.all(
                        summary.teams.map(async team => ({
                            teamId: team.id,
                            members: (await api.listWorkspaceTeamMembers(workspaceId, team.id))
                                .members,
                        }))
                    ),
                    canManageSummary
                        ? api.listWorkspaceInvitations(workspaceId)
                        : Promise.resolve({ invitations: [] as WorkspaceInvitation[] }),
                    canManageSummary
                        ? api.listProjects()
                        : Promise.resolve({
                              projects: [] as Array<{
                                  id: string
                                  name: string
                                  workspaceId: string | null
                              }>,
                          }),
                ])
                const projects = workspaceProjects.projects.filter(
                    project => project.workspaceId === workspaceId
                )
                const projectGrants = await Promise.all(
                    projects.map(async project => ({
                        project,
                        grants: (await api.listProjectTeamGrants(project.id)).grants,
                    }))
                )
                const projectsByTeamId: TeamProjectsById = {}
                const knownTeamIds = new Set(summary.teams.map(team => team.id))
                for (const { project, grants } of projectGrants) {
                    for (const grant of grants) {
                        if (!knownTeamIds.has(grant.teamId)) continue
                        projectsByTeamId[grant.teamId] = [
                            ...(projectsByTeamId[grant.teamId] ?? []),
                            { id: project.id, name: project.name, role: grant.role },
                        ]
                    }
                }
                if (cancelled) return
                setWorkspace(summary)
                setTeamMembers(Object.fromEntries(members.map(item => [item.teamId, item.members])))
                setTeamProjects(projectsByTeamId)
                setInvitations(
                    workspaceInvitations.invitations.filter(
                        invitation => invitation.status === 'pending'
                    )
                )
            } catch (caughtError) {
                if (!cancelled) setError(workspaceGroupsErrorMessage(caughtError))
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [reloadVersion, workspaceId])

    const canManage =
        workspace?.membership.role === 'owner' || workspace?.membership.role === 'admin'

    async function runAction(action: string, operation: () => Promise<void>) {
        setPendingAction(action)
        setError(null)
        setNotice(null)
        try {
            await operation()
        } catch (caughtError) {
            setError(workspaceGroupsErrorMessage(caughtError))
        } finally {
            setPendingAction(null)
        }
    }

    async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const name = newTeamName.trim()
        if (!canManage || name === '' || pendingAction !== null) return

        await runAction('create', async () => {
            const response = await api.createWorkspaceTeam(workspaceId, name)
            setWorkspace(current =>
                current === null
                    ? current
                    : { ...current, teams: [...current.teams, response.team] }
            )
            setTeamMembers(current => ({ ...current, [response.team.id]: [] }))
            setNewTeamName('')
            setNotice(m.access_workspace_group_created())
            setActiveForm(null)
        })
    }

    function beginRename(teamId: string, name: string) {
        setEditingTeamId(teamId)
        setEditingTeamName(name)
        setError(null)
        setNotice(null)
    }

    function cancelRename() {
        setEditingTeamId(null)
        setEditingTeamName('')
    }

    async function handleRenameTeam(event: FormEvent<HTMLFormElement>, teamId: string) {
        event.preventDefault()
        const name = editingTeamName.trim()
        if (!canManage || name === '' || pendingAction !== null) return

        await runAction(`rename:${teamId}`, async () => {
            const response = await api.renameWorkspaceTeam(workspaceId, teamId, name)
            setWorkspace(current =>
                current === null
                    ? current
                    : {
                          ...current,
                          teams: current.teams.map(team =>
                              team.id === teamId ? response.team : team
                          ),
                      }
            )
            cancelRename()
            setNotice(m.access_workspace_group_updated())
        })
    }

    async function handleAddMember(teamId: string) {
        const userId = selectedMemberByTeam[teamId]
        if (!canManage || userId === undefined || userId === '' || pendingAction !== null) return

        await runAction(`add:${teamId}`, async () => {
            const response = await api.addWorkspaceTeamMember(workspaceId, teamId, userId)
            setTeamMembers(current => ({
                ...current,
                [teamId]: [...(current[teamId] ?? []), response.member],
            }))
            updateTeamMemberCount(teamId, 1)
            setSelectedMemberByTeam(current => ({ ...current, [teamId]: '' }))
            setNotice(m.access_workspace_group_member_added())
        })
    }

    async function handleRemoveMember(teamId: string, userId: string) {
        if (!canManage || pendingAction !== null) return

        await runAction(`remove:${teamId}:${userId}`, async () => {
            await api.removeWorkspaceTeamMember(workspaceId, teamId, userId)
            setTeamMembers(current => ({
                ...current,
                [teamId]: (current[teamId] ?? []).filter(member => member.userId !== userId),
            }))
            updateTeamMemberCount(teamId, -1)
            setNotice(m.access_workspace_group_member_removed())
        })
    }

    async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const email = inviteEmail.trim().toLowerCase()
        if (!canManage || email === '' || inviteTeamId === '' || pendingAction !== null) {
            return
        }

        await runAction('invite', async () => {
            const response = await api.createWorkspaceInvitation(workspaceId, email, inviteTeamId)
            setInvitations(current => [response.invitation, ...current])
            setInviteEmail('')
            setInviteTeamId('')
            setNotice(m.access_workspace_invite_created())
            setActiveForm(null)
        })
    }

    async function handleRevokeInvitation(invitationId: string) {
        if (!canManage || pendingAction !== null) return

        await runAction(`revoke-invite:${invitationId}`, async () => {
            await api.cancelWorkspaceInvitation(workspaceId, invitationId)
            setInvitations(current => current.filter(invitation => invitation.id !== invitationId))
            setNotice(m.access_workspace_invite_revoked())
        })
    }

    async function handleUpdateWorkspaceMember(memberId: string, role: 'admin' | 'member') {
        if (!canManage || pendingAction !== null) return

        await runAction(`workspace-member:${memberId}`, async () => {
            const response = await api.updateWorkspaceMemberRole(workspaceId, memberId, role)
            setWorkspace(current =>
                current === null
                    ? current
                    : {
                          ...current,
                          members: current.members.map(member =>
                              member.id === memberId ? response.member : member
                          ),
                      }
            )
            setNotice(m.access_workspace_member_updated())
        })
    }

    async function handleRemoveWorkspaceMember(memberId: string) {
        if (!canManage || pendingAction !== null) return

        const member = workspace?.members.find(candidate => candidate.id === memberId)
        if (member === undefined) return

        await runAction(`remove-workspace-member:${memberId}`, async () => {
            await api.removeWorkspaceMember(workspaceId, memberId)
            setWorkspace(current => {
                if (current === null) return current
                return {
                    ...current,
                    members: current.members.filter(candidate => candidate.id !== memberId),
                    teams: current.teams.map(team => {
                        const wasInTeam = (teamMembers[team.id] ?? []).some(
                            teamMember => teamMember.userId === member.userId
                        )
                        return wasInTeam
                            ? { ...team, memberCount: Math.max(0, team.memberCount - 1) }
                            : team
                    }),
                }
            })
            setTeamMembers(current =>
                Object.fromEntries(
                    Object.entries(current).map(([teamId, members]) => [
                        teamId,
                        members.filter(teamMember => teamMember.userId !== member.userId),
                    ])
                )
            )
            setNotice(m.access_workspace_member_removed())
        })
    }

    function updateTeamMemberCount(teamId: string, delta: number) {
        setWorkspace(current =>
            current === null
                ? current
                : {
                      ...current,
                      teams: current.teams.map(team =>
                          team.id === teamId
                              ? { ...team, memberCount: Math.max(0, team.memberCount + delta) }
                              : team
                      ),
                  }
        )
    }

    if (workspace === null) {
        return (
            <section className="mt-6 bg-surface-raised p-5 shadow-surface sm:p-6">
                {error ? (
                    <Alert variant="destructive">
                        <AlertTitle>{m.access_workspace_groups_action_failed()}</AlertTitle>
                        <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span>{error}</span>
                            <Button
                                className="shrink-0"
                                onClick={() => setReloadVersion(current => current + 1)}
                                size="sm"
                                type="button"
                                variant="ghost">
                                <RefreshIcon aria-hidden="true" />
                                {m.common_retry()}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : (
                    <p className="text-sm text-muted-foreground" role="status">
                        {m.access_workspace_groups_loading()}
                    </p>
                )}
            </section>
        )
    }

    const workspaceMembersById = new Map(
        workspace.members.map(member => [member.userId, member] as const)
    )
    const workspaceTeamsById = new Map(workspace.teams.map(team => [team.id, team] as const))

    return (
        <Dialog
            open={activeForm !== null}
            onOpenChange={open => {
                if (!open && pendingAction === null) setActiveForm(null)
            }}>
            <div className="space-y-6">
                {error && activeForm === null ? (
                    <Alert variant="destructive">
                        <AlertTitle>{m.access_workspace_groups_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {notice ? (
                    <p className="flex items-center gap-2 text-sm text-state-success" role="status">
                        <CheckIcon aria-hidden="true" className="size-4" />
                        {notice}
                    </p>
                ) : null}

                <Tabs value={view} onValueChange={value => setView(String(value))}>
                    <TabsList className="h-10 w-full">
                        <TabsTrigger value="members">
                            {m.access_workspace_members_title()}
                        </TabsTrigger>
                        <TabsTrigger value="groups">
                            {m.access_workspace_groups_title()}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="members" className="space-y-8">
                        <section aria-labelledby="workspace-members-title" className="min-w-0">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 id="workspace-members-title" className="sr-only">
                                        {m.access_workspace_members_title()}
                                    </h2>
                                </div>
                                {canManage ? (
                                    <DialogTrigger
                                        onClick={() => {
                                            setError(null)
                                            setActiveForm('invite')
                                        }}
                                        render={
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={pendingAction !== null}
                                            />
                                        }>
                                        <UserPlusRoundedIcon aria-hidden="true" />
                                        {m.access_workspace_invite_title()}
                                    </DialogTrigger>
                                ) : (
                                    <Badge variant="secondary">
                                        {m.access_workspace_groups_read_only()}
                                    </Badge>
                                )}
                            </div>

                            <ul
                                className="mt-5 divide-y divide-border/40"
                                aria-label={m.access_workspace_members_title()}>
                                {workspace.members.map(member => {
                                    const isCurrent = member.userId === session.user.id
                                    const isOwner = hasWorkspaceMemberRole(member.role, 'owner')
                                    const pendingMemberAction =
                                        pendingAction === `workspace-member:${member.id}` ||
                                        pendingAction === `remove-workspace-member:${member.id}`

                                    return (
                                        <li
                                            className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                                            key={member.id}
                                            aria-busy={pendingMemberAction}>
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

                                            <div className="flex shrink-0 items-center gap-2">
                                                {isOwner ? (
                                                    <Badge variant="secondary">
                                                        {m.access_project_role_owner()}
                                                    </Badge>
                                                ) : (
                                                    <Select
                                                        items={{
                                                            admin: m.access_role_admin(),
                                                            member: m.access_role_member(),
                                                        }}
                                                        value={
                                                            hasWorkspaceMemberRole(
                                                                member.role,
                                                                'admin'
                                                            )
                                                                ? 'admin'
                                                                : 'member'
                                                        }
                                                        onValueChange={value => {
                                                            if (
                                                                value === 'admin' ||
                                                                value === 'member'
                                                            ) {
                                                                void handleUpdateWorkspaceMember(
                                                                    member.id,
                                                                    value
                                                                )
                                                            }
                                                        }}>
                                                        <SelectTrigger
                                                            aria-label={m.access_workspace_member_role_label(
                                                                {
                                                                    name: member.name,
                                                                }
                                                            )}
                                                            className="min-w-28"
                                                            disabled={
                                                                !canManage ||
                                                                isCurrent ||
                                                                pendingAction !== null
                                                            }
                                                            size="sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent align="end">
                                                            <SelectItem value="admin">
                                                                {m.access_role_admin()}
                                                            </SelectItem>
                                                            <SelectItem value="member">
                                                                {m.access_role_member()}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                                {canManage && !isOwner && !isCurrent ? (
                                                    <Button
                                                        aria-label={m.access_workspace_member_remove_label(
                                                            {
                                                                name: member.name,
                                                            }
                                                        )}
                                                        disabled={pendingAction !== null}
                                                        onClick={() =>
                                                            void handleRemoveWorkspaceMember(
                                                                member.id
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="ghost">
                                                        <UserCrossRoundedIcon aria-hidden="true" />
                                                        {m.access_workspace_member_remove()}
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        </section>

                        {canManage && invitations.length > 0 ? (
                            <section aria-labelledby="workspace-invite-title" className="min-w-0">
                                <div className="min-w-0">
                                    <h2
                                        id="workspace-invite-title"
                                        className="font-heading text-base font-medium">
                                        {m.access_workspace_invite_pending_title()}
                                    </h2>
                                </div>

                                {invitations.length > 0 ? (
                                    <div className="mt-4">
                                        <ul className="divide-y divide-border/40">
                                            {invitations.map(invitation => (
                                                <li
                                                    className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
                                                    key={invitation.id}>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-medium">
                                                            {invitation.email}
                                                        </p>
                                                        <p className="truncate text-xs text-muted-foreground">
                                                            {invitation.teamId === undefined
                                                                ? m.access_workspace_invite_no_group()
                                                                : (workspaceTeamsById.get(
                                                                      invitation.teamId
                                                                  )?.name ??
                                                                  m.access_workspace_invite_no_group())}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        aria-label={m.access_workspace_invite_revoke_label(
                                                            {
                                                                email: invitation.email,
                                                            }
                                                        )}
                                                        disabled={pendingAction !== null}
                                                        onClick={() =>
                                                            void handleRevokeInvitation(
                                                                invitation.id
                                                            )
                                                        }
                                                        size="sm"
                                                        type="button"
                                                        variant="ghost">
                                                        <CloseIcon aria-hidden="true" />
                                                        {m.access_workspace_invite_revoke()}
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                            </section>
                        ) : null}
                    </TabsContent>
                    <TabsContent value="groups">
                        <section aria-labelledby="workspace-groups-title" className="pt-1">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 id="workspace-groups-title" className="sr-only">
                                        {m.access_workspace_groups_title()}
                                    </h2>
                                </div>
                                {canManage ? (
                                    <DialogTrigger
                                        onClick={() => {
                                            setError(null)
                                            setActiveForm('group')
                                        }}
                                        render={
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={pendingAction !== null}
                                            />
                                        }>
                                        <AddIcon aria-hidden="true" />
                                        {m.access_workspace_group_create()}
                                    </DialogTrigger>
                                ) : (
                                    <Badge variant="secondary">
                                        {m.access_workspace_groups_read_only()}
                                    </Badge>
                                )}
                            </div>

                            {workspace.teams.length === 0 ? (
                                <EmptyState
                                    className="mt-5 min-h-48"
                                    icon={<UsersGroupTwoRoundedIcon aria-hidden="true" />}
                                    layout="compact"
                                    title={m.access_workspace_groups_empty()}
                                />
                            ) : (
                                <div className="mt-4 space-y-8">
                                    {workspace.teams.map(team => {
                                        const members = teamMembers[team.id] ?? []
                                        const projects = teamProjects[team.id] ?? []
                                        const memberIds = new Set(
                                            members.map(member => member.userId)
                                        )
                                        const availableMembers = workspace.members.filter(
                                            member => !memberIds.has(member.userId)
                                        )
                                        const isRenaming = editingTeamId === team.id

                                        return (
                                            <article
                                                aria-busy={pendingAction?.includes(team.id)}
                                                className="min-w-0 border-t border-border/50 pt-5"
                                                key={team.id}>
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        {isRenaming ? (
                                                            <form
                                                                className="flex items-center gap-2"
                                                                onSubmit={event =>
                                                                    void handleRenameTeam(
                                                                        event,
                                                                        team.id
                                                                    )
                                                                }>
                                                                <Input
                                                                    aria-label={m.access_workspace_group_new_name()}
                                                                    autoFocus
                                                                    className="h-8"
                                                                    value={editingTeamName}
                                                                    onChange={event =>
                                                                        setEditingTeamName(
                                                                            event.target.value
                                                                        )
                                                                    }
                                                                />
                                                                <Button
                                                                    aria-label={m.common_save()}
                                                                    disabled={
                                                                        pendingAction !== null
                                                                    }
                                                                    size="icon-sm"
                                                                    type="submit">
                                                                    <CheckIcon aria-hidden="true" />
                                                                </Button>
                                                                <Button
                                                                    aria-label={m.common_cancel()}
                                                                    disabled={
                                                                        pendingAction !== null
                                                                    }
                                                                    onClick={cancelRename}
                                                                    size="icon-sm"
                                                                    type="button"
                                                                    variant="ghost">
                                                                    <CloseIcon aria-hidden="true" />
                                                                </Button>
                                                            </form>
                                                        ) : (
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <h3 className="truncate text-sm font-medium">
                                                                    {team.name}
                                                                </h3>
                                                                {team.isDefault ? (
                                                                    <Badge variant="secondary">
                                                                        {m.access_workspace_group_default()}
                                                                    </Badge>
                                                                ) : null}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {canManage && !isRenaming ? (
                                                        <Button
                                                            aria-label={m.access_workspace_group_rename_label(
                                                                {
                                                                    name: team.name,
                                                                }
                                                            )}
                                                            disabled={pendingAction !== null}
                                                            onClick={() =>
                                                                beginRename(team.id, team.name)
                                                            }
                                                            size="icon-sm"
                                                            type="button"
                                                            variant="ghost">
                                                            <PenIcon aria-hidden="true" />
                                                        </Button>
                                                    ) : null}
                                                </div>

                                                {members.length > 0 ? (
                                                    <ul
                                                        className="mt-4 divide-y divide-border/40"
                                                        aria-label={team.name}>
                                                        {members.map(teamMember => {
                                                            const member = workspaceMembersById.get(
                                                                teamMember.userId
                                                            )
                                                            const displayName =
                                                                member?.name ?? teamMember.userId
                                                            return (
                                                                <li
                                                                    className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0"
                                                                    key={teamMember.id}>
                                                                    <UserAvatar
                                                                        imageUrl={
                                                                            member?.image ?? null
                                                                        }
                                                                        name={displayName}
                                                                        seed={teamMember.userId}
                                                                        size="sm"
                                                                    />
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="truncate text-sm font-medium">
                                                                            {displayName}
                                                                        </p>
                                                                        <p className="truncate text-xs text-muted-foreground">
                                                                            {member?.email ??
                                                                                teamMember.userId}
                                                                        </p>
                                                                    </div>
                                                                    {canManage ? (
                                                                        <Button
                                                                            aria-label={m.access_workspace_group_remove_member_label(
                                                                                {
                                                                                    name: displayName,
                                                                                }
                                                                            )}
                                                                            disabled={
                                                                                pendingAction !==
                                                                                null
                                                                            }
                                                                            onClick={() =>
                                                                                void handleRemoveMember(
                                                                                    team.id,
                                                                                    teamMember.userId
                                                                                )
                                                                            }
                                                                            size="icon-sm"
                                                                            type="button"
                                                                            variant="ghost">
                                                                            <UserCrossRoundedIcon aria-hidden="true" />
                                                                        </Button>
                                                                    ) : null}
                                                                </li>
                                                            )
                                                        })}
                                                    </ul>
                                                ) : null}

                                                {canManage ? (
                                                    <div className="mt-4">
                                                        {projects.length > 0 ? (
                                                            <h4 className="text-xs font-medium text-muted-foreground">
                                                                {m.access_workspace_group_project_access()}
                                                            </h4>
                                                        ) : null}
                                                        {projects.length === 0 ? (
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                {m.access_workspace_group_no_projects()}
                                                            </p>
                                                        ) : (
                                                            <ul className="mt-2 flex flex-wrap gap-1.5">
                                                                {projects.map(project => (
                                                                    <li
                                                                        className="bg-surface-raised px-2 py-1 text-xs shadow-field"
                                                                        key={project.id}>
                                                                        <span>{project.name}</span>
                                                                        <span className="ml-1 text-muted-foreground">
                                                                            {project.role ===
                                                                            'editor'
                                                                                ? m.access_project_role_editor()
                                                                                : m.access_project_role_viewer()}
                                                                        </span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                    </div>
                                                ) : null}

                                                {canManage ? (
                                                    availableMembers.length > 0 ? (
                                                        <div className="mt-4">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    setAddingToTeam(current =>
                                                                        current === team.id
                                                                            ? null
                                                                            : team.id
                                                                    )
                                                                }
                                                                aria-expanded={
                                                                    addingToTeam === team.id
                                                                }>
                                                                <UserPlusRoundedIcon aria-hidden="true" />
                                                                {m.access_workspace_invite_title()}
                                                            </Button>
                                                            {addingToTeam === team.id ? (
                                                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                                                    <Select
                                                                        items={Object.fromEntries(
                                                                            availableMembers.map(
                                                                                member => [
                                                                                    member.userId,
                                                                                    member.name,
                                                                                ]
                                                                            )
                                                                        )}
                                                                        value={
                                                                            selectedMemberByTeam[
                                                                                team.id
                                                                            ] ?? ''
                                                                        }
                                                                        onValueChange={value =>
                                                                            setSelectedMemberByTeam(
                                                                                current => ({
                                                                                    ...current,
                                                                                    [team.id]:
                                                                                        value ?? '',
                                                                                })
                                                                            )
                                                                        }>
                                                                        <SelectTrigger
                                                                            aria-label={m.access_workspace_group_add_member()}
                                                                            className="min-w-0 flex-1"
                                                                            disabled={
                                                                                pendingAction !==
                                                                                null
                                                                            }
                                                                            size="sm">
                                                                            <SelectValue
                                                                                placeholder={m.access_workspace_group_member_placeholder()}
                                                                            />
                                                                        </SelectTrigger>
                                                                        <SelectContent align="start">
                                                                            {availableMembers.map(
                                                                                member => (
                                                                                    <SelectItem
                                                                                        key={
                                                                                            member.userId
                                                                                        }
                                                                                        value={
                                                                                            member.userId
                                                                                        }>
                                                                                        {
                                                                                            member.name
                                                                                        }
                                                                                    </SelectItem>
                                                                                )
                                                                            )}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Button
                                                                        disabled={
                                                                            pendingAction !==
                                                                                null ||
                                                                            (selectedMemberByTeam[
                                                                                team.id
                                                                            ] ?? '') === ''
                                                                        }
                                                                        onClick={() =>
                                                                            void handleAddMember(
                                                                                team.id
                                                                            )
                                                                        }
                                                                        size="sm"
                                                                        type="button">
                                                                        <UserPlusRoundedIcon aria-hidden="true" />
                                                                        {m.access_workspace_group_add_button()}
                                                                    </Button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : null
                                                ) : null}
                                            </article>
                                        )
                                    })}
                                </div>
                            )}
                        </section>
                    </TabsContent>
                </Tabs>
            </div>
            <DialogContent className="bg-surface-raised" showCloseButton={pendingAction === null}>
                <DialogTitle className="pr-6">
                    {activeForm === 'invite'
                        ? m.access_invite_to_scope({ name: workspace.workspace.name })
                        : m.access_workspace_group_create()}
                </DialogTitle>
                {error ? (
                    <Alert variant="destructive">
                        <AlertTitle>{m.access_workspace_groups_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                {activeForm === 'invite' ? (
                    <form
                        className="grid gap-4"
                        onSubmit={event => void handleCreateInvitation(event)}>
                        <Field className="min-w-0 gap-1.5">
                            <FieldLabel htmlFor="workspace-invite-email">
                                {m.access_workspace_invite_email()}
                            </FieldLabel>
                            <Input
                                disabled={pendingAction !== null}
                                id="workspace-invite-email"
                                placeholder={m.access_workspace_invite_email_placeholder()}
                                required
                                type="email"
                                value={inviteEmail}
                                onChange={event => setInviteEmail(event.target.value)}
                            />
                        </Field>
                        <Field className="min-w-0 gap-1.5">
                            <FieldLabel htmlFor="workspace-invite-group">
                                {m.access_workspace_invite_group()}
                            </FieldLabel>
                            <Select
                                items={Object.fromEntries(
                                    workspace.teams.map(team => [team.id, team.name])
                                )}
                                value={inviteTeamId}
                                onValueChange={value => setInviteTeamId(value ?? '')}>
                                <SelectTrigger
                                    aria-label={m.access_workspace_invite_group()}
                                    className="w-full"
                                    disabled={pendingAction !== null}
                                    id="workspace-invite-group">
                                    <SelectValue
                                        placeholder={m.access_workspace_invite_group_placeholder()}
                                    />
                                </SelectTrigger>
                                <SelectContent align="start">
                                    {workspace.teams.map(team => (
                                        <SelectItem key={team.id} value={team.id}>
                                            {team.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Button
                            className="justify-self-end"
                            disabled={
                                pendingAction !== null ||
                                inviteEmail.trim() === '' ||
                                inviteTeamId === ''
                            }
                            type="submit">
                            <UserPlusRoundedIcon aria-hidden="true" />
                            {m.access_workspace_invite_button()}
                        </Button>
                    </form>
                ) : (
                    <form className="grid gap-4" onSubmit={handleCreateTeam}>
                        <Field className="min-w-0 flex-1 gap-1.5">
                            <FieldLabel htmlFor="workspace-group-name">
                                {m.access_workspace_group_new_name()}
                            </FieldLabel>
                            <Input
                                disabled={pendingAction !== null}
                                id="workspace-group-name"
                                maxLength={80}
                                placeholder={m.access_workspace_group_new_name_placeholder()}
                                value={newTeamName}
                                onChange={event => setNewTeamName(event.target.value)}
                            />
                        </Field>
                        <Button
                            className="justify-self-end"
                            disabled={pendingAction !== null || newTeamName.trim() === ''}
                            type="submit">
                            <AddIcon aria-hidden="true" />
                            {m.access_workspace_group_create()}
                        </Button>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}

function hasWorkspaceMemberRole(role: string, expected: 'owner' | 'admin') {
    return role.split(',').some(part => part.trim() === expected)
}

function workspaceGroupsErrorMessage(error: unknown) {
    if (error instanceof ApiError && error.code === 'workspace_operation_failed') {
        return m.access_workspace_groups_action_failed()
    }
    if (error instanceof ApiError) {
        if (error.code === 'workspace_owner_protected') {
            return m.access_workspace_owner_protected()
        }
        if (error.code === 'workspace_self_update') {
            return m.access_workspace_self_update()
        }
        if (error.code === 'workspace_self_removal') {
            return m.access_workspace_self_removal()
        }
        if (error.code === 'workspace_last_admin') {
            return m.access_workspace_last_admin()
        }
    }
    return formatApiError(error)
}
