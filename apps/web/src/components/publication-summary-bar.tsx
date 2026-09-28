import { Link } from '@tanstack/react-router'

import { formatSchedule } from '@/components/dashboard-publication-parts'
import type { PublicationSummary } from '@/lib/api'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import * as m from '@/paraglide/messages.js'

export interface OverviewWeekActivityDay {
    readonly dateKey: string
    readonly dayLabel: string
    readonly dateLabel: string
    readonly scheduled: number
    readonly published: number
}

export function PublicationSummaryBar({
    ariaLabel,
    days,
    dueCount,
    locale,
    nextPublication,
    recentPublication,
    projectId,
    timeZone,
}: {
    readonly ariaLabel: string
    readonly days: readonly OverviewWeekActivityDay[]
    readonly dueCount: number
    readonly locale: string
    readonly nextPublication: PublicationSummary | null
    readonly recentPublication: PublicationSummary | null
    readonly projectId: string
    readonly timeZone: string
}) {
    const featuredPublication = nextPublication ?? recentPublication
    const featuredDate = nextPublication?.scheduledAt ?? recentPublication?.publishedAt ?? null
    const weekLabel = formatWeekRange(days, locale)
    const scheduledCount = days.reduce((total, day) => total + day.scheduled, 0)
    const publishedCount = days.reduce((total, day) => total + day.published, 0)
    const maximum = Math.max(1, ...days.map(day => day.scheduled + day.published))

    return (
        <section
            aria-label={ariaLabel}
            className="grid grid-cols-2 overflow-hidden rounded-lg bg-surface-raised shadow-surface lg:grid-cols-[0.85fr_1.2fr_1.25fr]">
            <div className="min-w-0 p-4 sm:p-5">
                <p className="text-xs font-medium text-muted-foreground">
                    {m.overview_widget_manual_due()}
                </p>
                <div className="mt-2 flex items-center gap-2.5">
                    <strong className="font-heading text-3xl leading-none font-semibold tabular-nums text-foreground">
                        {formatCount(dueCount, locale)}
                    </strong>
                    <span className="flex items-center gap-1.5">
                        {dueCount > 0 ? (
                            <i
                                aria-hidden="true"
                                className="size-2 rounded-full bg-state-attention"
                            />
                        ) : (
                            <i
                                aria-hidden="true"
                                className="size-2 rounded-full bg-muted-foreground/50"
                            />
                        )}
                    </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                        {dueCount === 0 ? m.overview_widget_all_clear() : null}
                    </span>
                    {dueCount > 0 ? (
                        <Link
                            className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
                            params={{ projectId }}
                            search={{ filter: 'attention', sort: undefined, tagIds: undefined }}
                            to="/dashboard/projects/$projectId/queue">
                            {m.overview_widget_review()}
                        </Link>
                    ) : null}
                </div>
            </div>

            <div className="min-w-0 border-l border-border/30 p-4 sm:p-5">
                <p className="text-xs font-medium text-muted-foreground">
                    {nextPublication !== null
                        ? m.overview_widget_next()
                        : recentPublication !== null
                          ? m.overview_widget_recent()
                          : m.overview_widget_next()}
                </p>
                {featuredPublication === null ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                        {m.overview_widget_no_upcoming()}
                    </p>
                ) : (
                    <Link
                        aria-label={m.overview_widget_open_publication({
                            title: publicationIdentityLabel(featuredPublication),
                        })}
                        className="mt-2 block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        params={{
                            projectId,
                            publicationId: featuredPublication.id,
                        }}
                        to="/dashboard/projects/$projectId/publications/$publicationId">
                        <span className="block break-words text-base leading-snug font-medium text-foreground">
                            {publicationIdentityLabel(featuredPublication)}
                        </span>
                        <span className="mt-1 block break-words text-xs leading-4 text-muted-foreground">
                            {featuredPublication.channelName} ·{' '}
                            {formatSchedule(featuredDate, timeZone, locale)}
                        </span>
                    </Link>
                )}
            </div>

            <div className="col-span-2 min-w-0 border-t border-border/30 p-4 sm:p-5 lg:col-span-1 lg:border-t-0 lg:border-l">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">
                            {m.overview_widget_week()}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{weekLabel}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-0.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <i className="size-1.5 rounded-full bg-state-queued" />
                            {m.overview_widget_scheduled_count({ count: scheduledCount })}
                        </span>
                        <span className="flex items-center gap-1">
                            <i className="size-1.5 rounded-full bg-state-published" />
                            {m.overview_widget_published_count({ count: publishedCount })}
                        </span>
                    </div>
                </div>
                <div
                    aria-label={days
                        .map(day =>
                            m.overview_widget_day_summary({
                                date: day.dateLabel,
                                published: day.published,
                                scheduled: day.scheduled,
                            })
                        )
                        .join('. ')}
                    className="mt-2 flex h-9 items-end justify-between gap-2"
                    role="img">
                    {days.map(day => {
                        const total = day.scheduled + day.published
                        const height = total === 0 ? 0 : Math.max(14, (total / maximum) * 100)
                        const scheduledHeight = total === 0 ? 0 : (day.scheduled / total) * height
                        const publishedHeight = total === 0 ? 0 : (day.published / total) * height

                        return (
                            <div
                                aria-hidden="true"
                                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                                key={day.dateKey}>
                                <span className="flex h-6 w-3.5 flex-col-reverse overflow-hidden rounded-sm bg-foreground/5">
                                    {day.scheduled > 0 ? (
                                        <i
                                            className="bg-state-queued"
                                            style={{ height: `${scheduledHeight}%` }}
                                        />
                                    ) : null}
                                    {day.published > 0 ? (
                                        <i
                                            className="bg-state-published"
                                            style={{ height: `${publishedHeight}%` }}
                                        />
                                    ) : null}
                                </span>
                                <span className="text-[9px] leading-none text-muted-foreground">
                                    {day.dayLabel}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </section>
    )
}

function formatWeekRange(days: readonly OverviewWeekActivityDay[], locale: string) {
    const firstDay = days.at(0)
    const lastDay = days.at(-1)
    if (firstDay === undefined || lastDay === undefined) return ''
    const formatter = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    })
    return `${formatter.format(new Date(`${firstDay.dateKey}T12:00:00Z`))} – ${formatter.format(
        new Date(`${lastDay.dateKey}T12:00:00Z`)
    )}`
}

function formatCount(count: number, locale: string) {
    return new Intl.NumberFormat(locale).format(count)
}
