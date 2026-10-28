import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button, buttonVariants } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { ChannelCreationDialog } from '@/components/channel-creation-dialog'
import {
    ChannelLifecycleDialog,
    type ChannelLifecycleAction,
} from '@/components/channel-lifecycle-dialog'
import { ChannelProfileEditorDialog } from '@/components/channel-profile-editor-dialog'
import { ChannelSharingDialog } from '@/components/channel-sharing-dialog'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmptyState } from '@/components/empty-state'
import { FacebookPagePickerDialog } from '@/components/facebook-page-picker-dialog'
import { PublisherConnectionPanel } from '@/components/publisher-connection-panel'
import type { Channel } from '@/lib/api'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { useProjectChannelActions } from '@/lib/project-channel-actions'
import { usePublicationComposer } from '@/lib/publication-composer-context'
import {
    hasRecoverablePublicationContent,
    readPublicationRecovery,
} from '@/lib/publication-recovery'
import type { PublisherCallbackResult } from '@/lib/publisher-connection-feedback'
import * as m from '@/paraglide/messages.js'

import { ChannelCadenceDialog } from './channel-cadence-dialog'

interface ChannelManagementPageProps {
    readonly facebookSelection?: { readonly selection: string; readonly channelId: string }
    readonly onDismissPublisherFeedback?: () => Promise<void>
    readonly startCreating?: boolean
    readonly publisherFeedback?: {
        readonly channelId?: string
        readonly result: PublisherCallbackResult
    }
}

export function ChannelManagementPage({
    onDismissPublisherFeedback,
    publisherFeedback,
    facebookSelection,
    startCreating = false,
}: ChannelManagementPageProps) {
    useLanguage()
    const { isInstanceAdmin, projects } = useDashboardGlobal()
    const { channels, connections, project, projectRole } = useProjectDashboard()
    const { postContent, postTitle, publicationTargets, sourceMedia } = usePublicationComposer()
    const {
        error,
        onArchiveChannel,
        onConnectCustomHttpPublisher,
        onPublisherConnected,
        onCreateChannel,
        onDeleteChannel,
        onDisconnectPublisher,
        onRefreshProject,
        onRenameChannel,
        onRestoreChannel,
        pending,
    } = useProjectChannelActions()
    const canEditProject = projectRole === 'owner' || projectRole === 'editor'
    const canResumeComposition =
        canEditProject &&
        (hasRecoverablePublicationContent({
            postContent,
            postTitle,
            publicationTargets,
            sourceMedia,
        }) ||
            readPublicationRecovery(project.id) !== null)
    const backLabel = canResumeComposition
        ? m.publication_resume_composition()
        : m.nav_back_to_overview()
    const [profileChannel, setProfileChannel] = useState<Channel | null>(null)
    const [cadenceChannel, setCadenceChannel] = useState<Channel | null>(null)
    const [sharingChannel, setSharingChannel] = useState<Channel | null>(null)
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
            {facebookSelection && canEditProject ? (
                <FacebookPagePickerDialog
                    key={facebookSelection.selection}
                    projectId={project.id}
                    channelId={facebookSelection.channelId}
                    channelName={
                        channels.find(channel => channel.id === facebookSelection.channelId)
                            ?.name ?? 'Facebook'
                    }
                    selection={facebookSelection.selection}
                    onClose={() => void onDismissPublisherFeedback?.()}
                    onConnected={async () => {
                        await onDismissPublisherFeedback?.()
                        await onRefreshProject()
                    }}
                />
            ) : null}
            <DashboardPageHeader
                action={
                    canEditProject ? (
                        <ChannelCreationDialog
                            projectId={project.id}
                            channels={channels}
                            onCreate={onCreateChannel}
                            pending={pending}
                            defaultOpen={startCreating}
                        />
                    ) : undefined
                }
                back={
                    <Link
                        aria-label={backLabel}
                        className={buttonVariants({
                            variant: 'ghost',
                            size: 'icon',
                            className: canResumeComposition
                                ? 'w-auto justify-self-start gap-1.5 px-2.5 text-muted-foreground hover:text-foreground'
                                : 'justify-self-start text-muted-foreground hover:text-foreground lg:w-auto lg:gap-1.5 lg:px-2.5',
                        })}
                        params={{ projectId: project.id }}
                        to={
                            canResumeComposition
                                ? '/dashboard/projects/$projectId/publications/new'
                                : '/dashboard/projects/$projectId/overview'
                        }>
                        <AltArrowLeftIcon aria-hidden="true" />
                        <span className={canResumeComposition ? undefined : 'hidden lg:inline'}>
                            {backLabel}
                        </span>
                    </Link>
                }
                title={m.channels_title()}
            />

            {error && lifecycle === null ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>{m.channels_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            {publisherFeedback ? (
                <PublisherCallbackFeedback
                    canResumeComposition={canResumeComposition}
                    channelId={publisherFeedback.channelId}
                    onDismiss={onDismissPublisherFeedback}
                    onRefreshProject={onRefreshProject}
                    projectId={project.id}
                    result={publisherFeedback.result}
                />
            ) : null}

            <section id="channels" className="scroll-mt-20">
                {channels.length > 0 ? (
                    <PublisherConnectionPanel
                        channels={channels}
                        connections={connections}
                        pending={pending}
                        onEditProfile={setProfileChannel}
                        onLifecycleAction={(action, channel) => setLifecycle({ action, channel })}
                        onCadence={setCadenceChannel}
                        onShare={canEditProject ? setSharingChannel : undefined}
                        onPublisherConnected={onPublisherConnected}
                        onConnectCustomHttpPublisher={onConnectCustomHttpPublisher}
                        onDisconnectPublisher={onDisconnectPublisher}
                        isInstanceAdmin={isInstanceAdmin}
                        readOnly={!canEditProject}
                    />
                ) : (
                    <EmptyState
                        className="mt-4"
                        description={m.channels_empty_description()}
                        icon={<LinkIcon aria-hidden="true" />}
                        layout="compact"
                        title={m.channels_empty_title()}
                    />
                )}
            </section>

            {cadenceChannel ? (
                <ChannelCadenceDialog
                    channel={cadenceChannel}
                    projectId={project.id}
                    timeZone={project.timeZone}
                    onClose={() => setCadenceChannel(null)}
                    onChanged={onRefreshProject}
                />
            ) : null}
            {canEditProject ? (
                <ChannelProfileEditorDialog
                    channel={profileChannel}
                    open={profileChannel !== null}
                    pending={pending}
                    onOpenChange={open => {
                        if (!open) setProfileChannel(null)
                    }}
                    onRefreshProject={onRefreshProject}
                />
            ) : null}
            {canEditProject ? (
                <ChannelSharingDialog
                    candidates={projects.filter(
                        candidate =>
                            candidate.workspaceId === project.workspaceId &&
                            candidate.id !== project.id
                    )}
                    channel={sharingChannel}
                    open={sharingChannel !== null}
                    projectId={project.id}
                    onChanged={onRefreshProject}
                    onOpenChange={open => {
                        if (!open) setSharingChannel(null)
                    }}
                />
            ) : null}
            {canEditProject ? (
                <ChannelLifecycleDialog
                    action={lifecycle?.action ?? null}
                    channel={lifecycle?.channel ?? null}
                    open={lifecycle !== null}
                    pending={pending}
                    error={error}
                    onAction={handleLifecycleAction}
                    onOpenChange={open => {
                        if (!open) setLifecycle(null)
                    }}
                />
            ) : null}
        </main>
    )
}

function PublisherCallbackFeedback({
    canResumeComposition,
    channelId,
    onDismiss,
    onRefreshProject,
    projectId,
    result,
}: {
    readonly canResumeComposition: boolean
    readonly channelId?: string
    readonly onDismiss?: () => Promise<void>
    readonly onRefreshProject: () => Promise<void>
    readonly projectId: string
    readonly result: PublisherCallbackResult
}) {
    const copy = publisherCallbackCopy(result)
    const targetId =
        channelId === undefined ? 'publisher-connections' : `publisher-connection-${channelId}`
    const hasTarget = channelId !== undefined
    const isSuccess = result === 'connected'

    async function handleRefresh() {
        try {
            await onRefreshProject()
            await onDismiss?.()
        } catch {
            // The dashboard context keeps the query error visible when refresh fails.
        }
    }

    return (
        <Alert
            className={
                isSuccess
                    ? 'mb-6 rounded-md border-state-published/35 bg-state-published/10'
                    : 'mb-6 rounded-md border-state-attention/35 bg-state-attention/10'
            }>
            <InfoCircleIcon aria-hidden="true" />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{copy.description}</span>
                {isSuccess && !canResumeComposition ? (
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                params={{ projectId }}
                                to="/dashboard/projects/$projectId/publications/new"
                            />
                        }
                        size="sm"
                        variant="ghost">
                        {m.publisher_callback_create_publication()}
                    </Button>
                ) : result === 'publisher_exists' ? (
                    <Button
                        className="h-auto p-0 font-medium text-foreground underline-offset-4 hover:bg-transparent hover:text-foreground hover:underline"
                        disabled={onDismiss === undefined}
                        onClick={() => void handleRefresh()}
                        size="sm"
                        variant="ghost">
                        {m.publisher_callback_refresh()}
                    </Button>
                ) : hasTarget ? (
                    <a
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                        href={`#${targetId}`}>
                        {m.publisher_callback_view_connection()}
                    </a>
                ) : null}
            </AlertDescription>
            {onDismiss ? (
                <div className="absolute top-2 right-2">
                    <Button
                        aria-label={m.common_close()}
                        onClick={() => void onDismiss()}
                        size="icon-xs"
                        variant="ghost">
                        <CloseIcon aria-hidden="true" />
                    </Button>
                </div>
            ) : null}
        </Alert>
    )
}

function publisherCallbackCopy(result: PublisherCallbackResult): {
    readonly description: string
    readonly title: string
} {
    switch (result) {
        case 'connected':
            return {
                description: m.publisher_callback_connected_description(),
                title: m.publisher_callback_connected_title(),
            }
        case 'already_used':
            return {
                description: m.publisher_callback_already_used_description(),
                title: m.publisher_callback_already_used_title(),
            }
        case 'authorization_denied':
            return {
                description: m.publisher_callback_authorization_denied_description(),
                title: m.publisher_callback_authorization_denied_title(),
            }
        case 'invalid_callback':
            return {
                description: m.publisher_callback_invalid_description(),
                title: m.publisher_callback_invalid_title(),
            }
        case 'invalid_destination':
            return {
                description: m.publisher_callback_invalid_destination_description(),
                title: m.publisher_callback_invalid_destination_title(),
            }
        case 'provider_unavailable':
            return {
                description: m.publisher_callback_provider_unavailable_description(),
                title: m.publisher_callback_provider_unavailable_title(),
            }
        case 'publisher_exists':
            return {
                description: m.publisher_callback_publisher_exists_description(),
                title: m.publisher_callback_publisher_exists_title(),
            }
        case 'incompatible_profile':
            return {
                description: m.publisher_callback_incompatible_profile_description(),
                title: m.publisher_callback_incompatible_profile_title(),
            }
    }
}
