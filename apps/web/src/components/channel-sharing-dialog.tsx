import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { toast } from '@postdot/ui/components/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, formatApiError, ApiError, type Channel, type Project } from '@/lib/api'
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
}: {
    /** Other projects of this workspace, from the caller's own project list. */
    readonly candidates: readonly Project[]
    readonly channel: Channel | null
    /** Refresh channel lists after any change. */
    readonly onChanged: () => Promise<void>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly projectId: string
}) {
    useLanguage()
    const queryClient = useQueryClient()
    const channelId = channel?.id ?? ''
    const sharing = useQuery({
        queryKey: sharingKey(projectId, channelId),
        queryFn: () => api.getChannelSharing(projectId, channelId),
        enabled: open && channel !== null,
    })
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [lastProject, setLastProject] = useState<{ id: string; name: string } | null>(null)

    if (channel === null) return null
    const view = sharing.data
    const usedIds = new Set(view?.usages.filter(u => u.state === 'active').map(u => u.projectId))
    const active = view?.usages.filter(usage => usage.state === 'active') ?? []
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
            await queryClient.invalidateQueries({ queryKey: sharingKey(projectId, channelId) })
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 max-w-lg flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle>{m.channel_share_title({ channel: channel.name })}</DialogTitle>
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
                            {managerLabel ? (
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
                                {canChange && active.length > 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {m.channel_share_withdraw_consequence()}
                                    </p>
                                ) : null}
                                <ul className="divide-y rounded-md border">
                                    {active.map(usage => (
                                        <li
                                            key={usage.projectId}
                                            className="flex items-center justify-between gap-3 px-3 py-2">
                                            <span className="min-w-0 truncate text-sm">
                                                {usage.name}
                                                {usage.projectId === projectId ? (
                                                    <Badge variant="outline" className="ml-2">
                                                        {m.channel_shared_badge()}
                                                    </Badge>
                                                ) : null}
                                            </span>
                                            {canChange ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={pending}
                                                    aria-label={m.channel_share_withdraw({
                                                        project: usage.name,
                                                    })}
                                                    onClick={() =>
                                                        void run(
                                                            () =>
                                                                api.withdrawChannel(
                                                                    projectId,
                                                                    channel.id,
                                                                    usage.projectId,
                                                                    { expectedRevision: revision }
                                                                ),
                                                            m.channel_share_withdrawn({
                                                                project: usage.name,
                                                                channel: channel.name,
                                                            }),
                                                            () =>
                                                                setLastProject({
                                                                    id: usage.projectId,
                                                                    name: usage.name,
                                                                })
                                                        )
                                                    }>
                                                    {m.channel_share_withdraw({
                                                        project: usage.name,
                                                    })}
                                                </Button>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            </section>

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
                                                    () =>
                                                        api.withdrawChannel(
                                                            projectId,
                                                            channel.id,
                                                            lastProject.id,
                                                            {
                                                                expectedRevision: revision,
                                                                lastAttachment: 'archive',
                                                            }
                                                        ),
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
                                    pending={pending}
                                    projects={active
                                        .filter(
                                            usage =>
                                                usage.canAcceptManagement &&
                                                (manager?.kind !== 'project' ||
                                                    manager.project?.id !== usage.projectId)
                                        )
                                        .map(usage => ({ id: usage.projectId, name: usage.name }))}
                                    onTransfer={async targetId => {
                                        let success = false
                                        await run(async () => {
                                            await api.transferChannelManagement(
                                                projectId,
                                                channel.id,
                                                targetId,
                                                revision
                                            )
                                            success = true
                                        }, m.channel_transfer_saved())
                                        return success
                                    }}
                                />
                            ) : null}
                            {canChange ? (
                                <section
                                    aria-labelledby="channel-share-available"
                                    className="space-y-2">
                                    <h3
                                        id="channel-share-available"
                                        className="text-sm font-medium">
                                        {m.channel_share_available()}
                                    </h3>
                                    {available.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            {m.channel_share_none_available()}
                                        </p>
                                    ) : (
                                        <ul className="divide-y rounded-md border">
                                            {available.map(candidate => (
                                                <li
                                                    key={candidate.id}
                                                    className="flex items-center justify-between gap-3 px-3 py-2">
                                                    <span className="min-w-0 truncate text-sm">
                                                        {candidate.name}
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={pending}
                                                        aria-label={m.channel_share_add({
                                                            project: candidate.name,
                                                        })}
                                                        onClick={() =>
                                                            void run(
                                                                () =>
                                                                    api.attachChannel(
                                                                        projectId,
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
                                                        {m.channel_share_add({
                                                            project: candidate.name,
                                                        })}
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </section>
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
