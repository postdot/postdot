import { Link } from '@tanstack/react-router'

import { formatSchedule } from '@/components/dashboard-publication-parts'
import type { PublicationSummary } from '@/lib/api'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import * as m from '@/paraglide/messages.js'

export function PublicationSummaryBar({
    ariaLabel,
    dueCount,
    locale,
    nextPublication,
    projectId,
    timeZone,
}: {
    readonly ariaLabel: string
    readonly dueCount: number
    readonly locale: string
    readonly nextPublication: PublicationSummary | null
    readonly projectId: string
    readonly timeZone: string
}) {
    const hasManualDue = dueCount > 0
    const hasNextPublication = nextPublication !== null

    if (!hasManualDue && !hasNextPublication) return null

    return (
        <section
            aria-label={ariaLabel}
            className={`flex max-w-full items-stretch overflow-hidden rounded-md bg-surface-raised ${
                hasManualDue && hasNextPublication ? 'w-full' : 'w-fit'
            }`}>
            {hasManualDue ? (
                <div
                    className={`flex min-w-0 items-center gap-3 p-3 sm:p-4 ${
                        hasNextPublication ? 'border-r border-border/30' : ''
                    }`}>
                    <strong className="font-heading text-3xl leading-none font-semibold tabular-nums text-state-attention">
                        {formatCount(dueCount, locale)}
                    </strong>
                    <div className="min-w-0">
                        <p className="text-sm leading-tight font-medium text-foreground">
                            {m.overview_widget_manual_due()}
                        </p>
                        <Link
                            className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                            params={{ projectId }}
                            search={{ filter: 'attention', sort: undefined, tagIds: undefined }}
                            to="/dashboard/projects/$projectId/queue">
                            {m.overview_widget_review()}
                        </Link>
                    </div>
                </div>
            ) : null}

            {nextPublication !== null ? (
                <Link
                    aria-label={m.overview_widget_open_publication({
                        title: publicationIdentityLabel(nextPublication),
                    })}
                    className="block min-w-0 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
                    params={{
                        projectId,
                        publicationId: nextPublication.id,
                    }}
                    to="/dashboard/projects/$projectId/publications/$publicationId">
                    <span className="block text-xs text-muted-foreground">
                        {m.overview_widget_next()}
                    </span>
                    <span className="mt-1 block break-words text-sm leading-snug font-medium text-foreground">
                        {publicationIdentityLabel(nextPublication)}
                    </span>
                    <span className="mt-1 block break-words text-xs leading-4 text-muted-foreground">
                        {nextPublication.channelName} ·{' '}
                        {formatSchedule(nextPublication.scheduledAt, timeZone, locale)}
                    </span>
                </Link>
            ) : null}
        </section>
    )
}

function formatCount(count: number, locale: string) {
    return new Intl.NumberFormat(locale).format(count)
}
