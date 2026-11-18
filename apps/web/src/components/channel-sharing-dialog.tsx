import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
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
import { toast } from '@postdot/ui/components/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postdot/ui/components/tooltip'
import { AddCircleIcon } from '@solar-icons/react/linear/add-circle'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { api, formatApiError, ApiError, type Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import { ChannelManagementTransfer } from './channel-management-transfer'

const sharingKey = (projectId: string, channelId: string) =>
    ['channel-sharing', projectId, channelId] as const

/** Use one channel in other projects of the same workspace; the server remains the authority. */
export function ChannelSharingDialog({
    candidates,
    channel,
    onChanged,
    onOpenChange,
    open,
    projectId,
    workspaceId,
}: {
    /** Other projects of this workspace, from the caller's own project list. */
    readonly candidates: readonly { id: string; name: string }[]
    readonly channel: Pick<Channel, 'id' | 'name' | 'revision' | 'state'> | null
    /** Refresh channel lists after any change. */
    readonly onChanged: () => Promise<void>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly projectId?: string
    readonly workspaceId?: string
}) {
    useLanguage()
    const queryClient = useQueryClient()
    const channelId = channel?.id ?? ''
    const contextId = workspaceId ?? projectId ?? ''
    const queryKey = [...sharingKey(contextId, channelId), workspaceId ? 'workspace' : 'project']
    const sharing = useQuery({
        queryKey,
        queryFn: async () => {
            if (workspaceId) {
                const data = await api.listWorkspaceChannels(workspaceId, true)
                const found = data.channels.find(candidate => candidate.id === channelId)
                if (!found) throw new Error(m.channels_unavailable())
                return { channel: found, usages: found.usages }
            }
            return api.getChannelSharing(projectId!, channelId)
        },
        enabled: open && channel !== null,
    })
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lastProject, setLastProject] = useState<{
        id: string
        name: string
    } | null>(null)

    if (channel === null) return null
    const view = sharing.data
    const usedIds = new Set(view?.usages.filter(u => u.state === 'active').map(u => u.projectId))
    const active = view?.usages.filter(usage => usage.state === 'active') ?? []
    const history = workspaceId
        ? (view?.usages.filter(usage => usage.state === 'detached') ?? [])
        : []
    const available = candidates.filter(
        candidate => candidate.id !== projectId && !usedIds.has(candidate.id)
    )
    const canChange = view?.channel.canShare === true

    async function run(
        operation: () => Promise<unknown>,
        success: string,
        onRetirement?: () => void
    ) {
        setPending(true)
        setError(null)
        try {
            await operation()
            await queryClient.invalidateQueries({
                queryKey,
            })
            await onChanged()
            toast.add({ title: success, type: 'success' })
            setLastProject(null)
        } catch (caught) {
            if (caught instanceof ApiError && caught.code === 'retirement_required' && onRetirement)
                onRetirement()
            else {
                setError(formatApiError(caught))
                if (caught instanceof ApiError && caught.code === 'stale_revision')
                    await sharing.refetch()
            }
        } finally {
            setPending(false)
        }
    }

    const revision = view?.channel.revision ?? channel.revision
    const manager = view?.channel.management
    const managerLabel =
        manager === undefined
            ? null
            : manager.kind === 'workspace'
              ? m.channel_share_manager_workspace()
              : manager.project === null
                ? m.channel_share_manager_other()
                : m.channel_share_manager_project({ project: manager.project.name })

    function withdraw(targetId: string, archive = false) {
        return workspaceId
            ? api.withdrawWorkspaceChannel(
                  workspaceId,
                  channelId,
                  targetId,
                  revision,
                  archive ? 'archive' : undefined
              )
            : api.withdrawChannel(projectId!, channelId, targetId, {
                  expectedRevision: revision,
                  ...(archive ? { lastAttachment: 'archive' as const } : {}),
              })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 max-w-lg flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle>
                        {workspaceId
                            ? m.channels_projects_title({ channel: channel.name })
                            : m.channel_share_title({ channel: channel.name })}
                    </DialogTitle>
                    <DialogDescription>{m.channel_share_description()}</DialogDescription>
                </DialogHeader>

                <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain">
                    {sharing.isPending ? (
                        <p className="text-sm text-muted-foreground">{m.channel_share_loading()}</p>
                    ) : null}
                    {sharing.isError ? (
                        <Alert variant="destructive" role="alert">
                            <AlertDescription>{formatApiError(sharing.error)}</AlertDescription>
                        </Alert>
                    ) : null}

                    {view ? (
                        <>
                            {managerLabel && !canChange ? (
                                <p className="text-xs text-muted-foreground">{managerLabel}</p>
                            ) : null}
                            {canChange ? null : (
                                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                                    {m.channel_share_unavailable()}
                                </p>
                            )}

                            <section aria-labelledby="channel-share-used" className="space-y-2">
                                <h3 id="channel-share-used" className="text-sm font-medium">
                                    {m.channel_share_used_by()}
                                </h3>
                                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                                    {active.map(usage => {
                                        const manages =
                                            manager?.kind === 'project' &&
                                            manager.project?.id === usage.projectId
                                        return (
                                            <li
                                                key={usage.projectId}
                                                className="flex min-h-11 items-center justify-between gap-3 py-1.5 pr-1.5 pl-3">
                                                <span className="min-w-0">
                                                    {workspaceId ? (
                                                        <Link
                                                            className="block break-words text-sm text-link hover:underline"
                                                            to="/dashboard/projects/$projectId/channels"
                                                            params={{ projectId: usage.projectId }}
                                                            onClick={() => onOpenChange(false)}>
                                                            {usage.name}
                                                        </Link>
                                                    ) : (
                                                        <span className="block truncate text-sm">
                                                            {usage.name}
                                                        </span>
                                                    )}
                                                    {manages ? (
                                                        <span className="block text-xs text-muted-foreground">
                                                            {m.channel_share_manages()}
                                                        </span>
                                                    ) : null}
                                                </span>
                                                {canChange ? (
                                                    <Tooltip>
                                                        <TooltipTrigger
                                                            render={
                                                                <Button
                                                                    type="button"
                                                                    size="icon-sm"
                                                                    variant="ghost"
                                                                    disabled={pending}
                                                                    aria-label={m.channel_share_withdraw(
                                                                        {
                                                                            project: usage.name,
                                                                        }
                                                                    )}
                                                                    onClick={() =>
                                                                        void run(
                                                                            () =>
                                                                                withdraw(
                                                                                    usage.projectId
                                                                                ),
                                                                            m.channel_share_withdrawn(
                                                                                {
                                                                                    project:
                                                                                        usage.name,
                                                                                    channel:
                                                                                        channel.name,
                                                                                }
                                                                            ),
                                                                            () =>
                                                                                setLastProject({
                                                                                    id: usage.projectId,
                                                                                    name: usage.name,
                                                                                })
                                                                        )
                                                                    }>
                                                                    <CloseIcon aria-hidden="true" />
                                                                </Button>
                                                            }
                                                        />
                                                        <TooltipContent>
                                                            {m.channel_share_withdraw({
                                                                project: usage.name,
                                                            })}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                ) : null}
                                            </li>
                                        )
                                    })}
                                </ul>
                                {canChange && active.length > 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        {m.channel_share_withdraw_consequence()}
                                    </p>
                                ) : null}
                                {canChange ? (
                                    available.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                            {m.channel_share_none_available()}
                                        </p>
                                    ) : (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                render={
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={pending}>
                                                        <AddCircleIcon aria-hidden="true" />
                                                        {m.channel_share_available()}
                                                    </Button>
                                                }
                                            />
                                            <DropdownMenuContent align="start">
                                                {available.map(candidate => (
                                                    <DropdownMenuItem
                                                        key={candidate.id}
                                                        onClick={() =>
                                                            void run(
                                                                () =>
                                                                    workspaceId
                                                                        ? api.attachWorkspaceChannel(
                                                                              workspaceId,
                                                                              channel.id,
                                                                              candidate.id,
                                                                              revision
                                                                          )
                                                                        : api.attachChannel(
                                                                              projectId!,
                                                                              channel.id,
                                                                              candidate.id,
                                                                              revision
                                                                          ),
                                                                m.channel_share_added({
                                                                    project: candidate.name,
                                                                    channel: channel.name,
                                                                })
                                                            )
                                                        }>
                                                        {candidate.name}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )
                                ) : null}
                            </section>

                            {history.length > 0 ? (
                                <section
                                    className="space-y-2"
                                    aria-label={m.channels_previous_projects()}>
                                    <h3 className="text-sm font-medium">
                                        {m.channels_previous_projects()}
                                    </h3>
                                    <ul className="space-y-2">
                                        {history.map(usage => (
                                            <li
                                                key={usage.projectId}
                                                className="flex justify-between gap-3 text-sm">
                                                <Link
                                                    className="min-w-0 break-words text-link hover:underline"
                                                    to="/dashboard/projects/$projectId/channels"
                                                    params={{ projectId: usage.projectId }}
                                                    onClick={() => onOpenChange(false)}>
                                                    {usage.name}
                                                </Link>
                                                <span className="text-xs text-muted-foreground">
                                                    {m.workspace_channel_detached()}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ) : null}
                            {lastProject ? (
                                <Alert role="alert">
                                    <AlertDescription className="space-y-3">
                                        <p>
                                            {m.channel_share_withdraw_last({
                                                project: lastProject.name,
                                            })}
                                        </p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="destructive"
                                            disabled={pending}
                                            onClick={() =>
                                                void run(
                                                    () => withdraw(lastProject.id, true),
                                                    m.channel_share_withdrawn({
                                                        project: lastProject.name,
                                                        channel: channel.name,
                                                    })
                                                )
                                            }>
                                            {m.channel_share_withdraw_archive()}
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            {canChange ? (
                                <ChannelManagementTransfer
                                    managerLabel={managerLabel}
                                    pending={pending}
                                    projects={active
                                        .filter(
                                            usage =>
                                                usage.canAcceptManagement &&
                                                (manager?.kind !== 'project' ||
                                                    manager.project?.id !== usage.projectId)
                                        )
                                        .map(usage => ({
                                            id: usage.projectId,
                                            name: usage.name,
                                        }))}
                                    onTransfer={async targetId => {
                                        let success = false
                                        await run(async () => {
                                            await (workspaceId
                                                ? api.transferWorkspaceChannelManagement(
                                                      workspaceId,
                                                      channel.id,
                                                      targetId,
                                                      revision
                                                  )
                                                : api.transferChannelManagement(
                                                      projectId!,
                                                      channel.id,
                                                      targetId,
                                                      revision
                                                  ))
                                            success = true
                                        }, m.channel_transfer_saved())
                                        return success
                                    }}
                                />
                            ) : null}
                        </>
                    ) : null}

                    {error ? (
                        <Alert variant="destructive" role="alert">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}
                </div>

                <DialogFooter className="shrink-0">
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                        {m.channel_share_done()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
