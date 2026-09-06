import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { useState } from 'react'

import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import {
    ChannelLifecycleDialog,
    type ChannelLifecycleAction,
} from '@/components/channel-lifecycle-dialog'
import { ChannelProfileEditorDialog } from '@/components/channel-profile-editor-dialog'
import { ChannelRow } from '@/components/channel-row'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
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
        onStartMastodonConnection,
        onConnectDiscordPublisher,
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

            <section id="channels" className="scroll-mt-20">
                <DashboardSectionHeading
                    meta={`${channels.length} channel${channels.length === 1 ? '' : 's'}`}
                    title="Project channels"
                />

                {channels.length > 0 ? (
                    <div className="mt-4 overflow-hidden rounded-md bg-surface-raised shadow-surface">
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
                    onStartMastodonConnection={onStartMastodonConnection}
                    onConnectDiscordPublisher={onConnectDiscordPublisher}
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
