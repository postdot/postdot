import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { cn } from '@herald/ui/lib/utils'
import { AddIcon } from '@solar-icons/react/bold/add'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
import { Link } from '@tanstack/react-router'

import { PublicationStatus, publicationStateLabel } from '@/components/dashboard-publication-parts'
import type { DuePublication, PublicationSummary } from '@/lib/api'
import { formatDayLabel, formatTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { calendarWeekdays, type CalendarDay, type CalendarMonth } from '@/lib/publication-calendar'
import * as m from '@/paraglide/messages.js'

export function PublicationCalendarMonth({
    duePublicationIds,
    month,
    projectId,
}: {
    readonly duePublicationIds: ReadonlySet<string>
    readonly month: CalendarMonth
    readonly projectId: string
}) {
    const { locale } = useLanguage()
    const weeks = Array.from({ length: 6 }, (_, index) =>
        month.days.slice(index * 7, index * 7 + 7)
    )

    return (
        <div
            aria-label={m.calendar_month_aria({ month: month.label })}
            className="hidden overflow-hidden rounded-lg bg-surface-inset p-1 shadow-surface md:block"
            data-calendar-view="month"
            role="grid">
            <div className="grid grid-cols-7 gap-1">
                {calendarWeekdays(locale).map(weekday => (
                    <div
                        className="bg-muted/70 px-3 py-2 text-[0.68rem] font-medium tracking-[0.02em] text-muted-foreground"
                        key={weekday}
                        role="columnheader">
                        {weekday}
                    </div>
                ))}
                {weeks.flatMap(week =>
                    week.map(day => (
                        <CalendarDayCell
                            day={day}
                            duePublicationIds={duePublicationIds}
                            projectId={projectId}
                            key={day.dateKey}
                            timeZone={month.timeZone}
                        />
                    ))
                )}
            </div>
        </div>
    )
}

export function PublicationCalendarAgenda({
    duePublicationIds,
    emptyDescription,
    emptyTitle,
    month,
}: {
    readonly duePublicationIds: ReadonlySet<string>
    readonly emptyDescription?: string
    readonly emptyTitle?: string
    readonly month: CalendarMonth
}) {
    const { locale } = useLanguage()
    const resolvedDescription = emptyDescription ?? m.calendar_no_scheduled_description()
    const resolvedTitle = emptyTitle ?? m.calendar_no_scheduled()
    const days = month.days.filter(day => day.isCurrentMonth && day.publications.length > 0)

    return (
        <div className="md:hidden" data-calendar-view="agenda">
            {days.length > 0 ? (
                <div className="overflow-hidden rounded-lg bg-muted shadow-surface">
                    {days.map(day => (
                        <section
                            className="border-b border-border/70 p-4 last:border-b-0"
                            key={day.dateKey}>
                            <div className="flex items-baseline justify-between gap-3">
                                <h2 className="font-heading text-base font-[580] tracking-[-0.025em]">
                                    {formatDayLabel(day.date, locale)}
                                </h2>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {m.common_publication_count({ count: day.publications.length })}
                                </span>
                            </div>
                            <div className="mt-3 divide-y divide-border/70">
                                {day.publications.map(publication => (
                                    <CalendarPublicationLink
                                        due={duePublicationIds.has(publication.id)}
                                        key={publication.id}
                                        publication={publication}
                                        timeZone={month.timeZone}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            ) : (
                <CalendarEmptyState description={resolvedDescription} title={resolvedTitle} />
            )}
        </div>
    )
}

export function CalendarEmptyState({
    className,
    description,
    title,
}: {
    readonly className?: string
    readonly description?: string
    readonly title?: string
}) {
    useLanguage()
    return (
        <Empty className={cn('min-h-44 bg-muted shadow-surface', className)}>
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <CalendarMinimalisticIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{title ?? m.calendar_no_scheduled()}</EmptyTitle>
                <EmptyDescription>
                    {description ?? m.calendar_no_scheduled_description()}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}

function CalendarDayCell({
    day,
    duePublicationIds,
    projectId,
    timeZone,
}: {
    readonly day: CalendarDay
    readonly duePublicationIds: ReadonlySet<string>
    readonly projectId: string
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const content = (
        <>
            <div className="flex items-center justify-between gap-2">
                <span
                    className={cn(
                        'flex size-6 items-center justify-center rounded-md text-xs font-medium tabular-nums',
                        day.isToday && 'bg-primary font-semibold text-primary-foreground'
                    )}>
                    {day.dayOfMonth}
                </span>
                {day.publications.length === 0 ? (
                    <AddIcon
                        aria-hidden="true"
                        className="size-3 text-primary opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-100"
                    />
                ) : null}
                {day.publications.length > 3 ? (
                    <span className="text-[0.65rem] tabular-nums text-muted-foreground">
                        +{day.publications.length - 3}
                    </span>
                ) : null}
            </div>
            <div className="mt-1.5 space-y-1">
                {day.publications.slice(0, 3).map(publication => (
                    <CalendarPublicationLink
                        compact
                        due={duePublicationIds.has(publication.id)}
                        key={publication.id}
                        publication={publication}
                        timeZone={timeZone}
                    />
                ))}
            </div>
        </>
    )
    const cellClassName = cn(
        'min-h-24 min-w-0 bg-background p-2.5 align-top',
        !day.isCurrentMonth && 'bg-muted/55 text-muted-foreground',
        day.isToday && 'bg-primary/[0.06]'
    )

    if (day.publications.length === 0) {
        return (
            <div
                aria-label={m.calendar_create_on({ date: formatDayLabel(day.date, locale) })}
                role="gridcell"
                className="min-w-0">
                <Link
                    aria-label={m.calendar_create_on({
                        date: formatDayLabel(day.date, locale),
                    })}
                    className={cn(
                        cellClassName,
                        'group block cursor-pointer transition-[background-color] hover:bg-primary/[0.06] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring'
                    )}
                    params={{ projectId }}
                    search={{ date: day.dateKey }}
                    to="/dashboard/projects/$projectId/compose">
                    {content}
                </Link>
            </div>
        )
    }

    return (
        <div
            aria-label={m.calendar_day_aria({
                date: formatDayLabel(day.date, locale),
                count: m.common_publication_count({ count: day.publications.length }),
            })}
            className={cellClassName}
            role="gridcell">
            {content}
        </div>
    )
}

function CalendarPublicationLink({
    compact = false,
    due,
    publication,
    timeZone,
}: {
    readonly compact?: boolean
    readonly due: boolean
    readonly publication: PublicationSummary
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const title = publication.postTitle ?? m.publication_untitled_post()
    const state = due ? m.publication_due_manual() : publicationStateLabel(publication.state)
    const time =
        publication.scheduledAt === null
            ? m.calendar_no_time()
            : formatTime(publication.scheduledAt, timeZone, locale)

    return (
        <Link
            aria-label={m.calendar_publication_aria({
                title,
                channel: publication.channelName,
                state,
                time,
            })}
            className={cn(
                'group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-[background-color,color] hover:bg-background/75 hover:text-foreground focus-visible:bg-background/75 focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                compact ? 'items-start' : 'gap-3 px-2.5 py-2.5'
            )}
            params={{ projectId: publication.projectId, publicationId: publication.id }}
            title={m.calendar_publication_title({
                title,
                channel: publication.channelName,
                state,
            })}
            to="/dashboard/projects/$projectId/publications/$publicationId">
            <span
                aria-hidden="true"
                className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full bg-primary',
                    publication.state === 'failed' || publication.state === 'ambiguous'
                        ? 'bg-state-failed'
                        : publication.state === 'published'
                          ? 'bg-state-published'
                          : due
                            ? 'bg-state-attention'
                            : undefined
                )}
            />
            <span className="min-w-0 flex-1">
                <span
                    className={cn(
                        'block truncate font-medium',
                        compact ? 'text-[0.7rem]' : 'text-sm'
                    )}>
                    {title}
                </span>
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.68rem] text-muted-foreground">
                    <span className="truncate">{publication.channelName}</span>
                    <span className="shrink-0">{time}</span>
                    {!compact ? <PublicationStatus due={due} state={publication.state} /> : null}
                </span>
            </span>
            {!compact ? (
                <AltArrowRightIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary"
                />
            ) : null}
        </Link>
    )
}

export function duePublicationIds(publications: readonly DuePublication[]) {
    return new Set(publications.map(publication => publication.id))
}
