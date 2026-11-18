import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { formatSchedule } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublicationSummary } from '@/lib/api'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import * as m from '@/paraglide/messages.js'

/**
 * The overview's status line: what goes out next, then the few numbers that
 * ask for a decision. Each number opens the queue on the matching work.
 */
export function PublicationSummaryBar({
    ariaLabel,
    dueCount,
    failedCount,
    locale,
    nextChannel,
    nextPublication,
    projectId,
    scheduledCount,
    timeZone,
    unscheduledCount,
}: {
    readonly ariaLabel: string
    readonly dueCount: number
    readonly failedCount: number
    readonly locale: string
    readonly nextChannel: Pick<Channel, 'id' | 'name' | 'profileId'> | null
    readonly nextPublication: PublicationSummary | null
    readonly projectId: string
    readonly scheduledCount: number
    readonly timeZone: string
    readonly unscheduledCount: number
}) {
    return (
        <section
            aria-label={ariaLabel}
            data-overview-status="true"
            className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md bg-surface-raised px-4 py-3">
            {nextPublication !== null ? (
                <Link
                    aria-label={m.overview_widget_open_publication({
                        title: publicationIdentityLabel(nextPublication),
                    })}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    params={{ projectId, publicationId: nextPublication.id }}
                    to="/dashboard/projects/$projectId/publications/$publicationId">
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {m.overview_widget_next()}
                    </span>
                    {nextChannel ? (
                        <ChannelAvatar channel={nextChannel} size="xs" className="shrink-0" />
                    ) : null}
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {publicationIdentityLabel(nextPublication)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {formatSchedule(nextPublication.scheduledAt, timeZone, locale)}
                    </span>
                </Link>
            ) : (
                <p className="flex-1 text-sm text-muted-foreground">
                    {m.overview_status_nothing_next()}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                {scheduledCount > 0 ? (
                    <StatusFigure
                        count={scheduledCount}
                        filter="scheduled"
                        label={m.overview_status_scheduled()}
                        locale={locale}
                        projectId={projectId}
                    />
                ) : null}
                {unscheduledCount > 0 ? (
                    <StatusFigure
                        count={unscheduledCount}
                        filter="draft"
                        label={m.overview_status_unscheduled()}
                        locale={locale}
                        projectId={projectId}
                    />
                ) : null}
                {dueCount > 0 ? (
                    <StatusFigure
                        count={dueCount}
                        filter="attention"
                        label={m.overview_widget_manual_due()}
                        locale={locale}
                        projectId={projectId}
                        tone="text-state-attention"
                    />
                ) : null}
                {failedCount > 0 ? (
                    <StatusFigure
                        count={failedCount}
                        filter="attention"
                        label={m.overview_status_failed()}
                        locale={locale}
                        projectId={projectId}
                        tone="text-state-failed"
                    />
                ) : null}
            </div>
        </section>
    )
}

function StatusFigure({
    count,
    filter,
    label,
    locale,
    projectId,
    tone,
}: {
    readonly count: number
    readonly filter: 'attention' | 'draft' | 'scheduled'
    readonly label: ReactNode
    readonly locale: string
    readonly projectId: string
    readonly tone?: string
}) {
    return (
        <Link
            className="flex items-baseline gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            params={{ projectId }}
            search={{ filter, sort: undefined, tagIds: undefined }}
            to="/dashboard/projects/$projectId/queue">
            {label}
            <strong
                className={`font-heading text-sm font-semibold tabular-nums ${tone ?? 'text-foreground'}`}>
                {new Intl.NumberFormat(locale).format(count)}
            </strong>
        </Link>
    )
}
