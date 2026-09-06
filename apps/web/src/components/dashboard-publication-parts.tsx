import { Badge } from '@herald/ui/components/badge'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { cn } from '@herald/ui/lib/utils'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { ListIcon } from '@solar-icons/react/bold/list'
import { Link } from '@tanstack/react-router'

import type { PublicationSummary } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'

export type PublicationState = PublicationSummary['state']

export function PublicationList({
    emptyDescription = 'Compose a source post to start the queue.',
    emptyTitle = 'No publications yet',
    publications,
    timeZone,
}: {
    readonly emptyDescription?: string
    readonly emptyTitle?: string
    readonly publications: readonly PublicationSummary[]
    readonly timeZone: string
}) {
    if (publications.length === 0) {
        return (
            <Empty className="mt-4 min-h-36 bg-muted">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ListIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>{emptyTitle}</EmptyTitle>
                    <EmptyDescription>{emptyDescription}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }

    return (
        <div className="mt-4 divide-y divide-border/70">
            {publications.map(publication => (
                <PublicationRow
                    key={publication.id}
                    publication={publication}
                    timeZone={timeZone}
                />
            ))}
        </div>
    )
}

export function PublicationRow({
    publication,
    timeZone,
}: {
    readonly publication: PublicationSummary
    readonly timeZone: string
}) {
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
                    {formatSchedule(publication.scheduledAt, timeZone)}
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

export function PublicationStatus({
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

export function channelMarkerClass(profileId: string) {
    if (profileId === 'linkedin') return 'text-primary'
    if (profileId === 'manual-message') return 'text-state-queued'
    return 'text-primary'
}

export function channelProfileLabel(profileId: string) {
    if (profileId === 'linkedin') return 'LinkedIn text'
    if (profileId === 'bluesky') return 'Bluesky post'
    if (profileId === 'mastodon') return 'Mastodon status'
    if (profileId === 'discord') return 'Discord message'
    if (profileId === 'manual-message') return 'Manual message'
    return profileId
}

export function formatSchedule(timestamp: number | null, timeZone = 'UTC') {
    return formatProjectDateTime(timestamp, timeZone)
}

export function publicationStateLabel(state: PublicationState) {
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
