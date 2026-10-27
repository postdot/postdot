import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import { Label } from '@postdot/ui/components/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { Switch } from '@postdot/ui/components/switch'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { AccessPageHeader } from '@/components/access-page-header'
import { ChannelCadenceDialog } from '@/components/channel-cadence-dialog'
import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import { ChannelManagementTransfer } from '@/components/channel-management-transfer'
import { EmptyState } from '@/components/empty-state'
import { ChannelAvatar } from '@/components/identity-visuals'
import {
    api,
    ApiError,
    formatApiError,
    type ChannelCreationProfile,
    type ChannelCreationOutcome,
} from '@/lib/api'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

type WorkspaceChannels = Awaited<ReturnType<typeof api.listWorkspaceChannels>>
type WorkspaceChannel = WorkspaceChannels['channels'][number]

export function WorkspaceChannelsPage() {
    const global = useDashboardGlobal()
    useLanguage()
    if (!global.selectedWorkspaceId)
        return (
            <main className="px-4 py-8">
                <AccessPageHeader title={m.workspace_channels_title()} />
            </main>
        )
    return (
        <WorkspaceChannelContent
            key={global.selectedWorkspaceId}
            workspaceId={global.selectedWorkspaceId}
        />
    )
}
function WorkspaceChannelContent({ workspaceId }: { workspaceId: string }) {
    const [includeArchived, setIncludeArchived] = useState(false)
    const [creating, setCreating] = useState(false)
    const [initialProjectId, setInitialProjectId] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [cadenceChannel, setCadenceChannel] = useState<WorkspaceChannel | null>(null)
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: ['workspace-channels', workspaceId, includeArchived],
        staleTime: 0,
        queryFn: () => api.listWorkspaceChannels(workspaceId, includeArchived),
    })
    const data = query.data
    const projects = data?.projects ?? []
    const canCreate = projects.filter(p => p.canCreate)
    async function refresh() {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: ['workspace-channels', workspaceId],
                refetchType: 'none',
            }),
            queryClient.invalidateQueries({ queryKey: ['channel-sharing'], refetchType: 'none' }),
            queryClient.invalidateQueries({ queryKey: ['channel-cadence'], refetchType: 'none' }),
            ...projects.map(p =>
                queryClient.invalidateQueries({
                    queryKey: ['project', p.id, 'data'],
                    refetchType: 'none',
                })
            ),
        ])
        await query.refetch()
    }
    async function create(
        name: string,
        profile: ChannelCreationProfile
    ): Promise<ChannelCreationOutcome> {
        if (!initialProjectId) return { created: false, profileIssues: [], profileIssueCount: 0 }
        setPending(true)
        setError(null)
        try {
            await api.createChannel(initialProjectId, name, profile)
            await refresh()
            return { created: true, profileIssues: [], profileIssueCount: 0 }
        } catch (caught) {
            setError(formatApiError(caught))
            return {
                created: false,
                profileIssues: caught instanceof ApiError ? caught.profileIssues : [],
                profileIssueCount: caught instanceof ApiError ? caught.profileIssueCount : 0,
            }
        } finally {
            setPending(false)
        }
    }
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <AccessPageHeader
                title={m.workspace_channels_title()}
                action={
                    canCreate.length ? (
                        <Button onClick={() => setCreating(value => !value)}>
                            {creating ? m.common_cancel() : m.channel_add()}
                        </Button>
                    ) : undefined
                }
            />
            <div className="mx-auto w-full max-w-5xl space-y-5">
                {creating ? (
                    <section
                        className="max-w-xl space-y-3"
                        aria-label={m.workspace_channel_initial_project()}>
                        <Label htmlFor="workspace-channel-initial-project">
                            {m.workspace_channel_initial_project()}
                        </Label>
                        <Select
                            value={initialProjectId}
                            onValueChange={setInitialProjectId}
                            items={canCreate.map(p => ({ value: p.id, label: p.name }))}>
                            <SelectTrigger
                                id="workspace-channel-initial-project"
                                className="w-full"
                                disabled={pending}>
                                <SelectValue placeholder={m.channel_transfer_choose()} />
                            </SelectTrigger>
                            <SelectContent>
                                {canCreate.map(project => (
                                    <SelectItem key={project.id} value={project.id}>
                                        {project.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {initialProjectId ? (
                            <ChannelCreationDialog
                                projectId={initialProjectId}
                                channels={
                                    data?.channels.filter(
                                        channel =>
                                            channel.state === 'active' &&
                                            channel.usages.some(
                                                usage =>
                                                    usage.projectId === initialProjectId &&
                                                    usage.state === 'active'
                                            )
                                    ) ?? []
                                }
                                pending={pending}
                                onCreate={create}
                            />
                        ) : null}
                    </section>
                ) : null}
                <div className="flex items-center gap-2">
                    <Switch
                        id="workspace-channels-archived"
                        checked={includeArchived}
                        onCheckedChange={value => setIncludeArchived(value === true)}
                    />
                    <Label htmlFor="workspace-channels-archived">
                        {m.workspace_channels_archived()}
                    </Label>
                </div>
                {query.isPending ? (
                    <p className="text-sm text-muted-foreground" role="status">
                        {m.workspace_channels_loading()}
                    </p>
                ) : null}
                {query.isError || error ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{error ?? formatApiError(query.error)}</AlertDescription>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setError(null)
                                void query.refetch()
                            }}>
                            {m.common_retry()}
                        </Button>
                    </Alert>
                ) : null}
                {data?.channels.length === 0 ? (
                    <EmptyState
                        icon={<LinkIcon aria-hidden="true" />}
                        title={m.workspace_channels_empty()}
                        description={m.workspace_channels_visibility()}
                        layout="compact"
                    />
                ) : null}
                {data?.channels.length ? (
                    <div className="divide-y divide-border/50">
                        {data.channels.map(channel => (
                            <WorkspaceChannelRow
                                key={channel.id}
                                channel={channel}
                                workspaceId={workspaceId}
                                projects={projects}
                                onChanged={refresh}
                                onCadence={() => setCadenceChannel(channel)}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
            {cadenceChannel ? (
                <ChannelCadenceDialog
                    workspaceId={workspaceId}
                    channel={cadenceChannel}
                    timeZone={projects[0]?.timeZone ?? 'UTC'}
                    onClose={() => setCadenceChannel(null)}
                    onChanged={refresh}
                />
            ) : null}
        </main>
    )
}
function WorkspaceChannelRow({
    channel,
    workspaceId,
    projects,
    onChanged,
    onCadence,
}: {
    channel: WorkspaceChannel
    workspaceId: string
    projects: WorkspaceChannels['projects']
    onChanged: () => Promise<void>
    onCadence: () => void
}) {
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lastProjectId, setLastProjectId] = useState<string | null>(null)
    const [adding, setAdding] = useState(false)
    const active = channel.usages.filter(u => u.state === 'active')
    const available = projects.filter(p => p.canAttach && !active.some(u => u.projectId === p.id))
    const manager = channel.management
    const managerLabel =
        manager.kind === 'workspace'
            ? m.channel_share_manager_workspace()
            : manager.project
              ? m.channel_share_manager_project({ project: manager.project.name })
              : m.channel_share_manager_other()
    async function run(operation: () => Promise<unknown>) {
        setPending(true)
        setError(null)
        try {
            await operation()
            setLastProjectId(null)
            await onChanged()
            return true
        } catch (caught) {
            setError(formatApiError(caught))
            if (caught instanceof ApiError && caught.code === 'stale_revision') await onChanged()
            return false
        } finally {
            setPending(false)
        }
    }
    return (
        <details className="group py-4" data-workspace-channel={channel.id}>
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-sm p-1 focus-visible:outline-2 focus-visible:outline-ring">
                <ChannelAvatar channel={channel} size="md" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-sm font-medium">{channel.name}</h2>
                        {channel.shared ? (
                            <Badge variant="outline">{m.channel_shared_badge()}</Badge>
                        ) : null}
                        {channel.state === 'archived' ? (
                            <Badge variant="outline">{m.channel_archived()}</Badge>
                        ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{managerLabel}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {m.workspace_channel_inspect()}
                </span>
            </summary>
            <div className="mt-5 space-y-5 pl-1 sm:pl-14">
                <section className="space-y-2">
                    <h3 className="text-sm font-medium">{m.channel_share_used_by()}</h3>
                    <p className="text-xs text-muted-foreground">
                        {m.workspace_channels_visibility()}
                    </p>
                    <ul className="space-y-2">
                        {channel.usages.map(usage => (
                            <li
                                key={usage.projectId}
                                className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <Link
                                    className="min-w-0 break-words text-link hover:underline"
                                    to="/dashboard/projects/$projectId/channels"
                                    params={{ projectId: usage.projectId }}>
                                    {usage.name}
                                </Link>
                                {usage.state === 'detached' ? (
                                    <span className="text-xs text-muted-foreground">
                                        {m.workspace_channel_detached()}
                                    </span>
                                ) : channel.canShare ? (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={pending}
                                        onClick={() => {
                                            setLastProjectId(usage.projectId)
                                        }}>
                                        {m.channel_share_withdraw({ project: usage.name })}
                                    </Button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </section>
                {lastProjectId ? (
                    <Alert>
                        <AlertDescription>
                            <p>{m.workspace_channel_withdraw_confirm()}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                    disabled={pending}
                                    onClick={() =>
                                        void run(() =>
                                            api.withdrawWorkspaceChannel(
                                                workspaceId,
                                                channel.id,
                                                lastProjectId,
                                                channel.revision
                                            )
                                        )
                                    }>
                                    {m.workspace_channel_withdraw()}
                                </Button>
                                <Button
                                    variant="outline"
                                    disabled={pending}
                                    onClick={() =>
                                        void run(() =>
                                            api.withdrawWorkspaceChannel(
                                                workspaceId,
                                                channel.id,
                                                lastProjectId,
                                                channel.revision,
                                                'archive'
                                            )
                                        )
                                    }>
                                    {m.channel_share_withdraw_archive()}
                                </Button>
                                <Button
                                    variant="ghost"
                                    disabled={pending}
                                    onClick={() => setLastProjectId(null)}>
                                    {m.common_cancel()}
                                </Button>
                            </div>
                        </AlertDescription>
                    </Alert>
                ) : null}
                {channel.canManage && channel.state === 'active' ? (
                    <Button size="sm" variant="outline" onClick={onCadence}>
                        {m.cadence_action()}
                    </Button>
                ) : null}
                {channel.canShare && channel.state === 'active' ? (
                    <section className="space-y-3">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => setAdding(value => !value)}>
                            {m.channel_share_action()}
                        </Button>
                        {adding ? (
                            <>
                                <p className="text-sm text-muted-foreground">
                                    {m.channel_share_description()}
                                </p>
                                {available.length ? (
                                    <ul className="space-y-2">
                                        {available.map(project => (
                                            <li
                                                key={project.id}
                                                className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                                <span className="break-words">{project.name}</span>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={pending}
                                                    onClick={() =>
                                                        void run(() =>
                                                            api.attachWorkspaceChannel(
                                                                workspaceId,
                                                                channel.id,
                                                                project.id,
                                                                channel.revision
                                                            )
                                                        )
                                                    }>
                                                    {m.channel_share_add({ project: project.name })}
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        {m.channel_share_none_available()}
                                    </p>
                                )}
                            </>
                        ) : null}
                    </section>
                ) : null}
                {channel.canShare ? (
                    <ChannelManagementTransfer
                        pending={pending}
                        projects={active
                            .filter(
                                u =>
                                    u.canAcceptManagement &&
                                    (manager.kind !== 'project' ||
                                        manager.project?.id !== u.projectId)
                            )
                            .map(u => ({ id: u.projectId, name: u.name }))}
                        onTransfer={projectId =>
                            run(() =>
                                api.transferWorkspaceChannelManagement(
                                    workspaceId,
                                    channel.id,
                                    projectId,
                                    channel.revision
                                )
                            )
                        }
                    />
                ) : null}
                {error ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
            </div>
        </details>
    )
}
