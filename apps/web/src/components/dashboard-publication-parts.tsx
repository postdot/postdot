import { Badge } from '@herald/ui/components/badge'
import { cn } from '@herald/ui/lib/utils'
import { ListIcon } from '@solar-icons/react/bold/list'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import type { PublicationSummary } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export type PublicationState = PublicationSummary['state']

export function PublicationList({
    emptyDescription,
    emptyAction,
    emptyTitle,
    publications,
    timeZone,
}: {
    readonly emptyDescription?: string
    readonly emptyAction?: ReactNode
    readonly emptyTitle?: string
    readonly publications: readonly PublicationSummary[]
    readonly timeZone: string
}) {
    useLanguage()
    if (publications.length === 0) {
        return (
            <div
                aria-live="polite"
                className="mt-4 flex min-w-0 flex-wrap items-center gap-3 border border-dashed border-border/70 bg-muted/35 px-4 py-4 text-left"
                role="status">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    <ListIcon aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-heading text-sm font-medium tracking-tight">
                        {emptyTitle ?? m.publication_empty_title()}
                    </p>
                    <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                        {emptyDescription ?? m.publication_empty_description()}
                    </p>
                </div>
                {emptyAction ? <div className="ml-auto shrink-0">{emptyAction}</div> : null}
            </div>
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
    const { locale } = useLanguage()
    return (
        <Link
            to="/dashboard/projects/$projectId/publications/$publicationId"
            params={{ projectId: publication.projectId, publicationId: publication.id }}
            data-publication-edit-link="true"
            className="group grid min-w-0 gap-4 rounded-md px-1 py-4 transition-[background-color] hover:bg-muted/35 sm:px-3 lg:grid-cols-[minmax(11rem,0.8fr)_minmax(0,1.3fr)_auto] lg:items-center lg:gap-7">
            <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{m.publication_source_post()}</p>
                <h3 className="mt-1 truncate text-sm font-medium">
                    {publication.postTitle ?? m.publication_untitled_post()}
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
                        {publication.deliveryMode === 'automatic'
                            ? m.publication_automatic()
                            : m.publication_manual()}
                    </span>
                    <PublicationStatus state={publication.state} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    {formatSchedule(publication.scheduledAt, timeZone, locale)}
                    {publication.draftDiffersFromTarget
                        ? ` · ${m.publication_draft_changes_pending()}`
                        : ''}
                </p>
            </div>
            <span className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary lg:flex">
                <PenIcon aria-hidden="true" className="size-4" />
                <span>{m.common_edit()}</span>
            </span>
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
    useLanguage()
    const label = due ? m.publication_due_manual() : publicationStateLabel(state)
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
    if (profileId === 'linkedin') return m.channel_linkedin_profile()
    if (profileId === 'bluesky') return m.channel_bluesky_profile()
    if (profileId === 'mastodon') return m.channel_mastodon_profile()
    if (profileId === 'discord') return m.channel_discord_profile()
    if (profileId === 'devto') return m.channel_devto_profile()
    if (profileId === 'manual-message') return m.channel_manual_profile()
    if (profileId === 'custom') return m.channel_custom_profile()
    return m.channel_profile()
}

export function formatSchedule(timestamp: number | null, timeZone = 'UTC', locale = 'en') {
    return formatProjectDateTime(timestamp, timeZone, locale, m.publication_unscheduled())
}

export function publicationStateLabel(state: PublicationState) {
    if (state === 'scheduled') return m.publication_state_queued()
    if (state === 'ready') return m.publication_state_ready()
    if (state === 'publishing') return m.publication_state_publishing()
    if (state === 'published') return m.publication_state_published()
    if (state === 'failed') return m.publication_state_failed()
    if (state === 'ambiguous') return m.publication_state_needs_review()
    if (state === 'cancelled') return m.publication_state_cancelled()
    return m.publication_state_draft()
}

function statusClass(state: PublicationState) {
    if (state === 'failed' || state === 'ambiguous') return 'text-state-failed'
    if (state === 'published') return 'text-state-published'
    if (state === 'scheduled' || state === 'ready' || state === 'publishing') {
        return 'text-state-queued'
    }
    return 'text-state-draft'
}
