import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
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
import { UserCheckIcon } from '@solar-icons/react/bold/user-check'
import { Link } from '@tanstack/react-router'

import type { DuePublication, PublicationSummary } from '@/lib/api'

export type PublicationState = PublicationSummary['state']

export function PublicationList({
    emptyDescription = 'Compose a source post to start the queue.',
    emptyTitle = 'No publications yet',
    publications,
}: {
    readonly emptyDescription?: string
    readonly emptyTitle?: string
    readonly publications: readonly PublicationSummary[]
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
                <PublicationRow key={publication.id} publication={publication} />
            ))}
        </div>
    )
}

export function PublicationRow({ publication }: { readonly publication: PublicationSummary }) {
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

export function AttentionPanel({
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
    if (profileId === 'manual-message') return 'Manual message'
    return profileId
}

export function formatSchedule(timestamp: number | null) {
    if (timestamp === null) return 'Unscheduled'
    return new Date(timestamp).toLocaleString()
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

function targetPreview(targetContent: Record<string, unknown>) {
    const candidates = [targetContent.body, targetContent.commentary, targetContent.text]
    const text = candidates.find(value => typeof value === 'string')
    return typeof text === 'string' ? text : 'Structured target content'
}
