import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { Label } from '@postdot/ui/components/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { AddIcon } from '@solar-icons/react/linear/add'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ChannelCadenceDialog } from '@/components/channel-cadence-dialog'
import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import { ChannelRow, ChannelActionsMenu, channelStatus } from '@/components/channel-row'
import { ChannelScopeSwitch } from '@/components/channel-scope-switch'
import { ChannelSharingDialog } from '@/components/channel-sharing-dialog'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { channelProfileLabel } from '@/components/dashboard-publication-parts'
import { EmptyState } from '@/components/empty-state'
import { PageColumn } from '@/components/page-column'
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

export function WorkspaceChannelsPage({ projectId }: { readonly projectId?: string }) {
    const global = useDashboardGlobal()
    useLanguage()
    if (!global.selectedWorkspaceId)
        return (
            <main className="px-4 py-8">
                <DashboardPageHeader column="management" title={m.channels_title()} />
            </main>
        )
    return (
        <WorkspaceChannelContent
            key={global.selectedWorkspaceId}
            workspaceId={global.selectedWorkspaceId}
            projectId={projectId}
        />
    )
}
function WorkspaceChannelContent({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId?: string
}) {
    const [includeArchived, setIncludeArchived] = useState(false)
    const [creating, setCreating] = useState(false)
    const [initialProjectId, setInitialProjectId] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sharingChannelId, setSharingChannelId] = useState<string | null>(null)
    const [cadenceChannel, setCadenceChannel] = useState<WorkspaceChannel | null>(null)
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: ['workspace-channels', workspaceId, true],
        staleTime: 0,
        queryFn: () => api.listWorkspaceChannels(workspaceId, true),
    })
    const data = query.data
    const visibleChannels =
        data?.channels.filter(channel => includeArchived || channel.state === 'active') ?? []
    const archivedCount = data?.channels.filter(channel => channel.state === 'archived').length ?? 0
    const projects = data?.projects ?? []
    const sharingChannel = data?.channels.find(channel => channel.id === sharingChannelId) ?? null
    const canCreate = projects.filter(p => p.canCreate)
    async function refresh() {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: ['workspace-channels', workspaceId],
                refetchType: 'active',
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
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                column="management"
                title={m.channels_title()}
                action={
                    canCreate.length ? (
                        <Button onClick={() => setCreating(value => !value)}>
                            {creating ? null : <AddIcon aria-hidden="true" />}
                            {creating ? m.common_cancel() : m.channel_add()}
                        </Button>
                    ) : undefined
                }>
                <ChannelScopeSwitch scope="workspace" projectId={projectId} />
            </DashboardPageHeader>
            <PageColumn variant="management" className="space-y-5">
                {creating ? (
                    <section
                        className="max-w-xl space-y-3"
                        aria-label={m.workspace_channel_initial_project()}>
                        <Label htmlFor="workspace-channel-initial-project">
                            {m.workspace_channel_initial_project()}
                        </Label>
                        <p
                            id="workspace-channel-initial-project-description"
                            className="text-sm text-muted-foreground">
                            {m.channel_transfer_description()}
                        </p>
                        <Select
                            value={initialProjectId}
                            onValueChange={setInitialProjectId}
                            items={canCreate.map(p => ({ value: p.id, label: p.name }))}>
                            <SelectTrigger
                                aria-describedby="workspace-channel-initial-project-description"
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
                {data && visibleChannels.length === 0 ? (
                    <EmptyState
                        icon={<LinkIcon aria-hidden="true" />}
                        title={m.workspace_channels_empty()}
                        description={m.workspace_channels_visibility()}
                        layout="compact"
                    />
                ) : null}
                {visibleChannels.length ? (
                    <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/60 bg-surface-raised shadow-surface">
                        {visibleChannels.map(channel => {
                            const manager = channel.management
                            const managerLabel =
                                manager.kind === 'workspace'
                                    ? m.channel_share_manager_workspace()
                                    : manager.project
                                      ? m.channel_share_manager_project({
                                            project: manager.project.name,
                                        })
                                      : m.channel_share_manager_other()
                            const usedBy = channel.usages
                                .filter(usage => usage.state === 'active')
                                .map(usage => usage.name)
                            return (
                                <ChannelRow
                                    key={channel.id}
                                    channel={channel}
                                    status={channelStatus({
                                        archived: channel.state === 'archived',
                                        connectionState: channel.connectionState,
                                        manual: channel.profileId === 'manual-message',
                                    })}
                                    secondary={[
                                        channel.profileId === 'manual-message'
                                            ? m.channel_platform_manual()
                                            : channelProfileLabel(channel.profileId),
                                        managerLabel,
                                        ...(usedBy.length === 1
                                            ? [m.channels_used_by({ projects: usedBy[0]! })]
                                            : usedBy.length > 1
                                              ? [m.channels_used_by_count({ count: usedBy.length })]
                                              : []),
                                    ]}
                                    menu={
                                        <ChannelActionsMenu
                                            channel={channel}
                                            disabled={false}
                                            canManage={channel.canManage}
                                            onShare={() => setSharingChannelId(channel.id)}
                                            sharingLabel={m.nav_projects()}
                                            onCadence={
                                                channel.canManage
                                                    ? () => setCadenceChannel(channel)
                                                    : undefined
                                            }
                                        />
                                    }
                                />
                            )
                        })}
                    </div>
                ) : null}
                {archivedCount > 0 ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="self-start text-muted-foreground"
                        aria-pressed={includeArchived}
                        onClick={() => setIncludeArchived(value => !value)}>
                        {includeArchived
                            ? m.workspace_channels_hide_archived()
                            : m.workspace_channels_show_archived({ count: archivedCount })}
                    </Button>
                ) : null}
            </PageColumn>
            {sharingChannel ? (
                <ChannelSharingDialog
                    key={sharingChannel.id}
                    workspaceId={workspaceId}
                    candidates={projects.filter(project => project.canAttach)}
                    channel={sharingChannel}
                    open={true}
                    onOpenChange={open => {
                        if (!open) setSharingChannelId(null)
                    }}
                    onChanged={refresh}
                />
            ) : null}
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
