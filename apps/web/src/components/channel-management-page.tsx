import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { ArchiveIcon } from '@solar-icons/react/bold/archive'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { MenuDotsIcon } from '@solar-icons/react/bold/menu-dots'
import { Pen2Icon } from '@solar-icons/react/bold/pen-2'
import { RestartIcon } from '@solar-icons/react/bold/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useState } from 'react'

import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import {
    ChannelLifecycleDialog,
    type ChannelLifecycleAction,
} from '@/components/channel-lifecycle-dialog'
import { ChannelProfileEditorDialog } from '@/components/channel-profile-editor-dialog'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { channelMarkerClass, channelProfileLabel } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublisherConnectionPanel } from '@/components/publisher-connection-panel'
import type { Channel } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'

export function ChannelManagementPage() {
    const {
        channels,
        connections,
        error,
        onArchiveChannel,
        onConnectCustomHttpPublisher,
        onCreateChannel,
        onDeleteChannel,
        onDisconnectPublisher,
        onRefreshProject,
        onRenameChannel,
        onRestoreChannel,
        onStartLinkedInConnection,
        onStartBlueskyConnection,
        pending,
        project,
    } = useProjectDashboard()
    const [profileChannel, setProfileChannel] = useState<Channel | null>(null)
    const [lifecycle, setLifecycle] = useState<{
        readonly action: ChannelLifecycleAction
        readonly channel: Channel
    } | null>(null)

    async function handleLifecycleAction(
        action: ChannelLifecycleAction,
        channel: Channel,
        name: string
    ): Promise<boolean> {
        const completed =
            action === 'rename'
                ? await onRenameChannel(channel.id, name, channel.revision)
                : action === 'archive'
                  ? await onArchiveChannel(channel.id, channel.revision)
                  : action === 'restore'
                    ? await onRestoreChannel(channel.id, channel.revision)
                    : await onDeleteChannel(channel.id, channel.revision)
        if (completed) setLifecycle(null)
        return completed
    }

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={<ChannelCreationDialog onCreate={onCreateChannel} pending={pending} />}
                title="Channels">
                <p className="mt-2 text-sm text-muted-foreground">{project.name}</p>
            </DashboardPageHeader>

            {error ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>Channel action failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <section>
                <DashboardSectionHeading
                    meta={`${channels.length} channel${channels.length === 1 ? '' : 's'}`}
                    title="Project channels"
                />

                {channels.length > 0 ? (
                    <div className="mt-4 divide-y divide-border/70">
                        {channels.map(channel => (
                            <ChannelRow
                                key={channel.id}
                                channel={channel}
                                disabled={pending}
                                onEditProfile={() => setProfileChannel(channel)}
                                onLifecycleAction={action => setLifecycle({ action, channel })}
                            />
                        ))}
                    </div>
                ) : (
                    <Empty className="mt-4 min-h-32 bg-muted">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <LinkIcon aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>No channels in this project</EmptyTitle>
                            <EmptyDescription>
                                Create a channel before composing a publication.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                )}
            </section>

            <div className="mt-10">
                <PublisherConnectionPanel
                    channels={channels}
                    connections={connections}
                    pending={pending}
                    onConnectCustomHttpPublisher={onConnectCustomHttpPublisher}
                    onStartLinkedInConnection={onStartLinkedInConnection}
                    onStartBlueskyConnection={onStartBlueskyConnection}
                    onDisconnectPublisher={onDisconnectPublisher}
                />
            </div>

            <ChannelProfileEditorDialog
                channel={profileChannel}
                open={profileChannel !== null}
                pending={pending}
                onOpenChange={open => {
                    if (!open) setProfileChannel(null)
                }}
                onRefreshProject={onRefreshProject}
            />
            <ChannelLifecycleDialog
                action={lifecycle?.action ?? null}
                channel={lifecycle?.channel ?? null}
                open={lifecycle !== null}
                pending={pending}
                onAction={handleLifecycleAction}
                onOpenChange={open => {
                    if (!open) setLifecycle(null)
                }}
            />
        </main>
    )
}

function ChannelRow({
    channel,
    disabled,
    onEditProfile,
    onLifecycleAction,
}: {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onEditProfile: () => void
    readonly onLifecycleAction: (action: ChannelLifecycleAction) => void
}) {
    const archived = channel.state === 'archived'

    return (
        <div className="flex min-w-0 flex-col gap-3 px-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-3">
            <div className="flex min-w-0 items-center gap-3">
                <span
                    className={`size-2.5 shrink-0 rounded-full bg-current ${channelMarkerClass(channel.profileId)} ${archived ? 'opacity-35' : ''}`}
                    aria-hidden="true"
                />
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{channel.name}</p>
                        <Badge variant={archived ? 'outline' : 'secondary'}>
                            {archived ? 'Archived' : 'Active'}
                        </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                        {channelProfileLabel(channel.profileId)} · profile v
                        {channel.profileVersionId.slice(0, 8)}
                    </p>
                </div>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            aria-label={`Manage ${channel.name}`}
                            variant="ghost"
                            size="icon-sm"
                            disabled={disabled}>
                            <MenuDotsIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onEditProfile}>
                        <Pen2Icon aria-hidden="true" />
                        Edit profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onLifecycleAction('rename')}>
                        <Pen2Icon aria-hidden="true" />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {archived ? (
                        <DropdownMenuItem onClick={() => onLifecycleAction('restore')}>
                            <RestartIcon aria-hidden="true" />
                            Restore
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onClick={() => onLifecycleAction('archive')}>
                            <ArchiveIcon aria-hidden="true" />
                            Archive
                        </DropdownMenuItem>
                    )}
                    {archived ? (
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onLifecycleAction('delete')}>
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                            Delete permanently
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
