import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@herald/ui/components/card'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { Field as UiField, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Textarea } from '@herald/ui/components/textarea'
import { cn } from '@herald/ui/lib/utils'
import { AddIcon } from '@solar-icons/react/bold/add'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { ListIcon } from '@solar-icons/react/bold/list'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { UserCheckIcon } from '@solar-icons/react/bold/user-check'
import { Link } from '@tanstack/react-router'
import type { FormEvent, ReactNode } from 'react'

import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { MediaAttachmentPicker, type MediaSelection } from '@/components/media-attachment-picker'
import { PublisherConnectionPanel } from '@/components/publisher-connection-panel'
import type {
    Channel,
    DuePublication,
    Project,
    PublisherConnection,
    PublicationSummary,
} from '@/lib/api'

type ChannelProfile = 'manual-message' | 'linkedin'
type DeliveryMode = 'manual' | 'automatic'
type PublicationState = PublicationSummary['state']

interface DashboardWorkspaceProps {
    readonly channelName: string
    readonly channelProfile: ChannelProfile
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly deliveryMode: DeliveryMode
    readonly duePublications: readonly DuePublication[]
    readonly error: string | null
    readonly onChannelNameChange: (value: string) => void
    readonly onChannelProfileChange: (value: ChannelProfile) => void
    readonly onCreateChannel: (event: FormEvent<HTMLFormElement>) => void
    readonly onCreatePost: (event: FormEvent<HTMLFormElement>) => void
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
    readonly onPostContentChange: (value: string) => void
    readonly onPostTitleChange: (value: string) => void
    readonly onPublicationChannelChange: (value: string) => void
    readonly onPublicationContentChange: (value: string) => void
    readonly onDeliveryModeChange: (value: DeliveryMode) => void
    readonly onScheduledAtChange: (value: string) => void
    readonly onSourceMediaChange: (value: MediaSelection[]) => void
    readonly onStartLinkedInConnection: (channelId: string) => Promise<void>
    readonly onPublish: (publicationId: string) => Promise<void>
    readonly pending: boolean
    readonly postContent: string
    readonly postTitle: string
    readonly project: Project | null
    readonly publicationChannelId: string
    readonly publicationContent: string
    readonly publications: readonly PublicationSummary[]
    readonly scheduledAt: string
    readonly sourceMedia: readonly MediaSelection[]
}

export function DashboardWorkspace({
    channelName,
    channelProfile,
    channels,
    connections,
    deliveryMode,
    duePublications,
    error,
    onChannelNameChange,
    onChannelProfileChange,
    onCreateChannel,
    onCreatePost,
    onDisconnectPublisher,
    onPostContentChange,
    onPostTitleChange,
    onPublicationChannelChange,
    onPublicationContentChange,
    onDeliveryModeChange,
    onScheduledAtChange,
    onSourceMediaChange,
    onStartLinkedInConnection,
    onPublish,
    pending,
    postContent,
    postTitle,
    project,
    publicationChannelId,
    publicationContent,
    publications,
    scheduledAt,
    sourceMedia,
}: DashboardWorkspaceProps) {
    const scheduledCount = publications.filter(
        publication => publication.scheduledAt !== null
    ).length
    const automaticCount = publications.filter(
        publication => publication.deliveryMode === 'automatic'
    ).length

    return (
        <div id="overview" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            <header className="flex flex-col justify-between gap-4 pb-5 lg:flex-row lg:items-center">
                <div className="min-w-0">
                    <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                        Publication workspace
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {project?.name ?? 'Select a workspace to begin'}
                    </p>
                </div>
                <Button size="lg" className="self-start lg:self-auto" onClick={scrollToCompose}>
                    <PenIcon aria-hidden="true" />
                    New publication
                </Button>
            </header>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-muted px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
                <span>
                    <strong className="font-medium text-foreground">{publications.length}</strong>{' '}
                    publication{publications.length === 1 ? '' : 's'}
                </span>
                <span>
                    <strong className="font-medium text-foreground">{scheduledCount}</strong>{' '}
                    scheduled
                </span>
                <span>
                    <strong className="font-medium text-foreground">{automaticCount}</strong>{' '}
                    automatic
                </span>
                <span className={cn(duePublications.length > 0 && 'text-state-attention')}>
                    <strong className="font-medium text-current">{duePublications.length}</strong>{' '}
                    needs attention
                </span>
            </div>

            {error ? (
                <Alert
                    variant="destructive"
                    className="mt-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>Workspace action failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <div className="mt-6 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
                <div className="min-w-0 space-y-7">
                    <ComposeSection
                        channelProfile={channelProfile}
                        channels={channels}
                        deliveryMode={deliveryMode}
                        onCreatePost={onCreatePost}
                        onDeliveryModeChange={onDeliveryModeChange}
                        onPostContentChange={onPostContentChange}
                        onPostTitleChange={onPostTitleChange}
                        onPublicationChannelChange={onPublicationChannelChange}
                        onPublicationContentChange={onPublicationContentChange}
                        onScheduledAtChange={onScheduledAtChange}
                        onSourceMediaChange={onSourceMediaChange}
                        pending={pending}
                        postContent={postContent}
                        postTitle={postTitle}
                        project={project}
                        publicationChannelId={publicationChannelId}
                        publicationContent={publicationContent}
                        scheduledAt={scheduledAt}
                        sourceMedia={sourceMedia}
                    />

                    <PublicationQueue publications={publications} />

                    <ChannelManagement
                        channelName={channelName}
                        channelProfile={channelProfile}
                        channels={channels}
                        onChannelNameChange={onChannelNameChange}
                        onChannelProfileChange={onChannelProfileChange}
                        onCreateChannel={onCreateChannel}
                        pending={pending}
                    />

                    <PublisherConnectionPanel
                        channels={channels}
                        connections={connections}
                        pending={pending}
                        onStartLinkedInConnection={onStartLinkedInConnection}
                        onDisconnectPublisher={onDisconnectPublisher}
                    />
                </div>

                <AttentionPanel
                    duePublications={duePublications}
                    onPublish={onPublish}
                    pending={pending}
                />
            </div>
        </div>
    )
}

function ComposeSection({
    channelProfile,
    channels,
    deliveryMode,
    onCreatePost,
    onDeliveryModeChange,
    onPostContentChange,
    onPostTitleChange,
    onPublicationChannelChange,
    onPublicationContentChange,
    onScheduledAtChange,
    onSourceMediaChange,
    pending,
    postContent,
    postTitle,
    project,
    publicationChannelId,
    publicationContent,
    scheduledAt,
    sourceMedia,
}: {
    readonly channelProfile: ChannelProfile
    readonly channels: readonly Channel[]
    readonly deliveryMode: DeliveryMode
    readonly onCreatePost: (event: FormEvent<HTMLFormElement>) => void
    readonly onDeliveryModeChange: (value: DeliveryMode) => void
    readonly onPostContentChange: (value: string) => void
    readonly onPostTitleChange: (value: string) => void
    readonly onPublicationChannelChange: (value: string) => void
    readonly onPublicationContentChange: (value: string) => void
    readonly onScheduledAtChange: (value: string) => void
    readonly onSourceMediaChange: (value: MediaSelection[]) => void
    readonly pending: boolean
    readonly postContent: string
    readonly postTitle: string
    readonly project: Project | null
    readonly publicationChannelId: string
    readonly publicationContent: string
    readonly scheduledAt: string
    readonly sourceMedia: readonly MediaSelection[]
}) {
    return (
        <section id="compose" className="scroll-mt-6">
            <Card className="gap-0 py-0">
                <CardHeader className="px-6 pt-6 pb-0 sm:px-7 sm:pt-7">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <CardTitle className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                New publication
                            </CardTitle>
                            <CardDescription className="mt-2 max-w-2xl leading-6">
                                Route one source to a destination and choose how it will be
                                delivered.
                            </CardDescription>
                        </div>
                        <span className="text-xs text-muted-foreground">Autosave in editor</span>
                    </div>
                </CardHeader>

                <CardContent className="p-6 pt-6 sm:p-7">
                    {project === null ? (
                        <Empty className="min-h-36 bg-muted">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <PenIcon aria-hidden="true" />
                                </EmptyMedia>
                                <EmptyTitle>Select a project to compose</EmptyTitle>
                                <EmptyDescription>
                                    Select or create a project from the workspace context first.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : (
                        <form onSubmit={onCreatePost}>
                            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.7fr)]">
                                <div className="min-w-0 space-y-5">
                                    <FormField
                                        htmlFor="new-post-title"
                                        label="Post title"
                                        hint="Optional context for the source post.">
                                        <Input
                                            id="new-post-title"
                                            value={postTitle}
                                            onChange={event =>
                                                onPostTitleChange(event.target.value)
                                            }
                                            placeholder="Optional source title"
                                        />
                                    </FormField>
                                    <FormField
                                        htmlFor="new-post-content"
                                        label="Source content"
                                        hint="This shared source can produce several channel-specific targets.">
                                        <Textarea
                                            id="new-post-content"
                                            value={postContent}
                                            onChange={event =>
                                                onPostContentChange(event.target.value)
                                            }
                                            placeholder="Write the source content…"
                                            rows={8}
                                            className="min-h-44 leading-6"
                                        />
                                    </FormField>
                                    <div id="media" className="scroll-mt-6">
                                        <MediaAttachmentPicker
                                            projectId={project.id}
                                            value={sourceMedia}
                                            onChange={onSourceMediaChange}
                                            disabled={pending}
                                        />
                                    </div>
                                </div>

                                <div className="min-w-0 space-y-5 rounded-lg bg-muted p-5 shadow-surface sm:p-6">
                                    <div>
                                        <h3 className="font-heading text-base font-[580] leading-[1.03] tracking-[-0.04em]">
                                            Destination
                                        </h3>
                                    </div>
                                    <FormField htmlFor="publication-channel" label="Channel">
                                        <Select
                                            required
                                            items={Object.fromEntries(
                                                channels.map(channel => [channel.id, channel.name])
                                            )}
                                            value={publicationChannelId || null}
                                            onValueChange={value =>
                                                onPublicationChannelChange(value ?? '')
                                            }>
                                            <SelectTrigger id="publication-channel">
                                                <SelectValue placeholder="Select a channel" />
                                            </SelectTrigger>
                                            <SelectContent align="start">
                                                {channels.map(channel => (
                                                    <SelectItem key={channel.id} value={channel.id}>
                                                        {channel.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormField>
                                    <FormField
                                        htmlFor="publication-content"
                                        label="Channel copy"
                                        hint={
                                            channelProfile === 'linkedin'
                                                ? 'Optional LinkedIn commentary override.'
                                                : 'Optional target-specific override.'
                                        }>
                                        <Textarea
                                            id="publication-content"
                                            value={publicationContent}
                                            onChange={event =>
                                                onPublicationContentChange(event.target.value)
                                            }
                                            placeholder="Optional override"
                                            rows={5}
                                            className="min-h-32 leading-6"
                                        />
                                    </FormField>
                                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
                                        <FormField htmlFor="delivery-mode" label="Delivery mode">
                                            <Select
                                                items={{
                                                    manual: 'Manual publication',
                                                    automatic: 'Automatic publication',
                                                }}
                                                value={deliveryMode}
                                                onValueChange={value =>
                                                    onDeliveryModeChange(value as DeliveryMode)
                                                }>
                                                <SelectTrigger id="delivery-mode">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent align="start">
                                                    <SelectItem value="manual">
                                                        Manual publication
                                                    </SelectItem>
                                                    <SelectItem value="automatic">
                                                        Automatic publication
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormField>
                                        <FormField
                                            htmlFor="scheduled-for"
                                            label="Scheduled for"
                                            hint="Use the local time configured by your browser.">
                                            <Input
                                                id="scheduled-for"
                                                required
                                                type="datetime-local"
                                                value={scheduledAt}
                                                onChange={event =>
                                                    onScheduledAtChange(event.target.value)
                                                }
                                            />
                                        </FormField>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-7 flex flex-col justify-between gap-4 rounded-lg bg-muted p-4 sm:flex-row sm:items-center">
                                <p className="max-w-xl text-sm text-muted-foreground">
                                    {deliveryMode === 'automatic'
                                        ? 'The worker will deliver this target when its channel connection is ready.'
                                        : 'A human will complete this target from the due-work queue.'}
                                </p>
                                <Button type="submit" disabled={pending || channels.length === 0}>
                                    <CalendarAddIcon aria-hidden="true" />
                                    Schedule {deliveryMode === 'automatic'
                                        ? 'automatic'
                                        : 'manual'}{' '}
                                    publication
                                </Button>
                            </div>
                        </form>
                    )}
                </CardContent>
            </Card>
        </section>
    )
}

function PublicationQueue({
    publications,
}: {
    readonly publications: readonly PublicationSummary[]
}) {
    return (
        <section id="publications" className="scroll-mt-6">
            <DashboardSectionHeading
                meta={`${publications.length} publication${publications.length === 1 ? '' : 's'}`}
                title="Queue"
            />

            {publications.length === 0 ? (
                <Empty className="mt-4 min-h-32 bg-muted">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <ListIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>No publications yet</EmptyTitle>
                        <EmptyDescription>
                            Compose the first destination above to start the queue.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="mt-4 divide-y divide-border/70">
                    {publications.map(publication => (
                        <PublicationRow key={publication.id} publication={publication} />
                    ))}
                </div>
            )}
        </section>
    )
}

function PublicationRow({ publication }: { readonly publication: PublicationSummary }) {
    return (
        <Link
            to="/dashboard/projects/$projectId/publications/$publicationId"
            params={{ projectId: publication.projectId, publicationId: publication.id }}
            className="group grid min-w-0 gap-4 rounded-md px-1 py-4 transition-[background-color] hover:bg-muted/35 sm:px-3 lg:grid-cols-[minmax(11rem,0.8fr)_minmax(0,1.3fr)_auto] lg:items-center lg:gap-7">
            <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Source post</p>
                <h3 className="mt-1 truncate text-sm font-medium">
                    {publication.postTitle ?? 'Untitled post'}
                </h3>
            </div>
            <div className="min-w-0 pl-0 lg:pl-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                        className={cn(
                            'size-2 shrink-0 rounded-full bg-current',
                            channelMarkerClass(
                                publication.deliveryMode === 'automatic'
                                    ? 'automatic'
                                    : 'manual-message'
                            )
                        )}
                        aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium">{publication.channelName}</span>
                    <span className="text-xs text-muted-foreground">
                        {publication.deliveryMode === 'automatic' ? 'Automatic' : 'Manual'}
                    </span>
                    <PublicationStatus state={publication.state} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    {formatSchedule(publication.scheduledAt)}
                    {publication.draftDiffersFromTarget ? ' · draft changes pending' : ''}
                </p>
            </div>
            <AltArrowRightIcon
                aria-hidden="true"
                className="hidden size-4 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary lg:block"
            />
        </Link>
    )
}

function AttentionPanel({
    duePublications,
    onPublish,
    pending,
}: {
    readonly duePublications: readonly DuePublication[]
    readonly onPublish: (publicationId: string) => Promise<void>
    readonly pending: boolean
}) {
    return (
        <aside className="min-w-0 rounded-lg bg-muted p-5 shadow-surface xl:sticky xl:top-6 xl:p-6">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                    Needs attention
                </h2>
                <span className="text-sm font-medium tabular-nums text-muted-foreground">
                    {duePublications.length}
                </span>
            </div>
            {duePublications.length > 0 ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Manual destinations stay visible until a person records the external result.
                </p>
            ) : null}

            {duePublications.length === 0 ? (
                <Empty className="mt-4 min-h-28 bg-background/80 px-4 py-5">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <UserCheckIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>Nothing is due</EmptyTitle>
                        <EmptyDescription>
                            Manual destinations will appear here when they need a person.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="mt-4 divide-y divide-border/70">
                    {duePublications.map(publication => (
                        <article key={publication.id} className="py-5 first:pt-1 last:pb-1">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                        {publication.channelName}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {formatSchedule(publication.scheduledAt)}
                                    </p>
                                </div>
                                <PublicationStatus state={publication.state} due />
                            </div>
                            <h3 className="mt-4 text-sm font-medium leading-5">
                                {publication.postTitle ?? 'Untitled post'}
                            </h3>
                            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                {targetPreview(publication.targetContent)}
                            </p>
                            <Button
                                className="mt-4 w-full"
                                size="sm"
                                variant="secondary"
                                disabled={pending}
                                onClick={() => void onPublish(publication.id)}>
                                Record as published
                                <AltArrowRightIcon aria-hidden="true" />
                            </Button>
                        </article>
                    ))}
                </div>
            )}
        </aside>
    )
}

function ChannelManagement({
    channelName,
    channelProfile,
    channels,
    onChannelNameChange,
    onChannelProfileChange,
    onCreateChannel,
    pending,
}: {
    readonly channelName: string
    readonly channelProfile: ChannelProfile
    readonly channels: readonly Channel[]
    readonly onChannelNameChange: (value: string) => void
    readonly onChannelProfileChange: (value: ChannelProfile) => void
    readonly onCreateChannel: (event: FormEvent<HTMLFormElement>) => void
    readonly pending: boolean
}) {
    return (
        <section id="channels" className="scroll-mt-6 pt-1">
            <DashboardSectionHeading
                meta={`${channels.length} channel${channels.length === 1 ? '' : 's'}`}
                title="Channels"
            />

            {channels.length > 0 ? (
                <div className="mt-4 divide-y divide-border/70">
                    {channels.map(channel => (
                        <div
                            key={channel.id}
                            className="flex flex-col gap-3 px-1 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-3">
                            <div className="flex min-w-0 items-center gap-3">
                                <span
                                    className={cn(
                                        'size-2.5 shrink-0 rounded-full bg-current',
                                        channelMarkerClass(channel.profileId)
                                    )}
                                    aria-hidden="true"
                                />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{channel.name}</p>
                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                        {channelProfileLabel(channel.profileId)} · profile v
                                        {channel.profileVersionId.slice(0, 8)}
                                    </p>
                                </div>
                            </div>
                            <a
                                href="#channels"
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-[color] hover:text-foreground">
                                Configure channel
                                <AltArrowRightIcon aria-hidden="true" className="size-3.5" />
                            </a>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty className="mt-4 min-h-28 bg-muted">
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

            <form
                className="mt-5 grid gap-4 rounded-lg bg-muted p-4 shadow-surface sm:p-5 md:grid-cols-[minmax(0,1fr)_13rem_auto] md:items-end"
                onSubmit={onCreateChannel}>
                <FormField htmlFor="new-channel-name" label="New channel">
                    <Input
                        id="new-channel-name"
                        required
                        value={channelName}
                        onChange={event => onChannelNameChange(event.target.value)}
                        placeholder="Community forum"
                    />
                </FormField>
                <FormField htmlFor="new-channel-profile" label="Profile">
                    <Select
                        items={{
                            'manual-message': 'Manual message',
                            linkedin: 'LinkedIn text',
                        }}
                        value={channelProfile}
                        onValueChange={value => onChannelProfileChange(value as ChannelProfile)}>
                        <SelectTrigger id="new-channel-profile">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="manual-message">Manual message</SelectItem>
                            <SelectItem value="linkedin">LinkedIn text</SelectItem>
                        </SelectContent>
                    </Select>
                </FormField>
                <Button size="lg" type="submit" className="w-full md:w-auto" disabled={pending}>
                    <AddIcon aria-hidden="true" />
                    Add channel
                </Button>
            </form>
            <p className="mt-2 px-1 text-xs text-muted-foreground sm:px-3">
                Manual message is the default profile. Connect an automatic publisher later if the
                channel supports it.
            </p>
        </section>
    )
}

function FormField({
    children,
    htmlFor,
    hint,
    label,
}: {
    readonly children: ReactNode
    readonly htmlFor?: string
    readonly hint?: string
    readonly label: string
}) {
    return (
        <UiField className="min-w-0 gap-1.5">
            <FieldLabel htmlFor={htmlFor} className="text-muted-foreground">
                {label}
            </FieldLabel>
            {children}
            {hint ? (
                <FieldDescription className="text-xs leading-5">{hint}</FieldDescription>
            ) : null}
        </UiField>
    )
}

function PublicationStatus({
    due = false,
    state,
}: {
    readonly due?: boolean
    readonly state: PublicationState
}) {
    const label = due ? 'Due manual' : publicationStateLabel(state)
    return (
        <Badge
            variant="outline"
            className={cn(
                'border-0 bg-transparent px-0',
                due ? 'text-state-attention' : statusClass(state)
            )}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {label}
        </Badge>
    )
}

function publicationStateLabel(state: PublicationState) {
    if (state === 'scheduled') return 'Queued'
    if (state === 'ready') return 'Ready'
    if (state === 'publishing') return 'Publishing'
    if (state === 'published') return 'Published'
    if (state === 'failed') return 'Failed'
    if (state === 'ambiguous') return 'Needs review'
    if (state === 'cancelled') return 'Cancelled'
    return 'Draft'
}

function statusClass(state: PublicationState) {
    if (state === 'failed' || state === 'ambiguous') return 'text-state-failed'
    if (state === 'published') return 'text-state-published'
    if (state === 'scheduled' || state === 'ready' || state === 'publishing') {
        return 'text-state-queued'
    }
    return 'text-state-draft'
}

function channelMarkerClass(profileId: string) {
    if (profileId === 'linkedin') return 'text-primary'
    if (profileId === 'manual-message') return 'text-state-queued'
    return 'text-primary'
}

function channelProfileLabel(profileId: string) {
    if (profileId === 'linkedin') return 'LinkedIn text'
    if (profileId === 'manual-message') return 'Manual message'
    return profileId
}

function formatSchedule(timestamp: number | null) {
    if (timestamp === null) return 'Unscheduled'
    return new Date(timestamp).toLocaleString()
}

function targetPreview(targetContent: Record<string, unknown>) {
    const candidates = [targetContent.body, targetContent.commentary, targetContent.text]
    const text = candidates.find(value => typeof value === 'string')
    return typeof text === 'string' ? text : 'Structured target content'
}

function scrollToCompose() {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
    document.getElementById('compose')?.scrollIntoView({ behavior, block: 'start' })
}
