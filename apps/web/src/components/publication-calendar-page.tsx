import { Button } from '@herald/ui/components/button'
import { Input } from '@herald/ui/components/input'
import { AltArrowLeftIcon } from '@solar-icons/react/bold/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import {
    CalendarEmptyState,
    duePublicationIds,
    PublicationCalendarAgenda,
    PublicationCalendarMonth,
} from '@/components/publication-calendar-view'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import {
    createCalendarMonth,
    getUnscheduledPublications,
    shiftCalendarMonth,
    startOfCalendarMonth,
    toDateKey,
} from '@/lib/publication-calendar'
import * as m from '@/paraglide/messages.js'

export function PublicationCalendarPage() {
    const { locale } = useLanguage()
    const { due, project, publications } = useProjectDashboard()
    const [monthCursor, setMonthCursor] = useState(() =>
        startOfCalendarMonth(new Date(), project.timeZone)
    )
    const todayDate = toDateKey(new Date(), project.timeZone)
    const [mobileCreateDate, setMobileCreateDate] = useState(todayDate)
    const month = useMemo(
        () => createCalendarMonth(monthCursor, publications, new Date(), project.timeZone, locale),
        [locale, monthCursor, project.timeZone, publications]
    )
    const scheduledPublications = publications.filter(
        publication => publication.scheduledAt !== null
    )
    const unscheduledPublications = getUnscheduledPublications(publications)
    const visibleScheduled = month.days.some(
        day => day.isCurrentMonth && day.publications.length > 0
    )

    function goToMonth(offset: number) {
        setMonthCursor(current => shiftCalendarMonth(current, offset))
    }

    function goToToday() {
        setMonthCursor(startOfCalendarMonth(new Date(), project.timeZone))
    }

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                params={{ projectId: project.id }}
                                search={{ date: todayDate }}
                                to="/dashboard/projects/$projectId/compose"
                            />
                        }>
                        <CalendarMinimalisticIcon aria-hidden="true" />
                        {m.calendar_new_publication()}
                    </Button>
                }
                title={m.calendar_title()}>
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            <PublicationSummaryBar
                ariaLabel={m.calendar_summary()}
                items={[
                    {
                        id: 'scheduled',
                        label: m.calendar_scheduled(),
                        value: scheduledPublications.length,
                    },
                    {
                        id: 'unscheduled',
                        label: m.calendar_unscheduled(),
                        value: unscheduledPublications.length,
                    },
                    {
                        attention: due.length > 0,
                        id: 'attention',
                        label: m.calendar_attention(),
                        value: due.length,
                    },
                ]}
            />

            <section aria-labelledby="calendar-month" className="mt-7 min-w-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-1.5">
                        <Button
                            aria-label={m.calendar_previous_month()}
                            onClick={() => goToMonth(-1)}
                            size="icon-sm"
                            variant="ghost">
                            <AltArrowLeftIcon aria-hidden="true" />
                        </Button>
                        <Button onClick={goToToday} size="sm" variant="ghost">
                            {m.calendar_today()}
                        </Button>
                        <Button
                            aria-label={m.calendar_next_month()}
                            onClick={() => goToMonth(1)}
                            size="icon-sm"
                            variant="ghost">
                            <AltArrowRightIcon aria-hidden="true" />
                        </Button>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 sm:justify-end">
                        <h2
                            className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.04em]"
                            id="calendar-month">
                            {month.label}
                        </h2>
                        <span className="text-sm text-muted-foreground">
                            {m.common_publication_count({ count: scheduledPublications.length })}
                        </span>
                    </div>
                </div>

                <div className="mt-4">
                    <div className="mb-4 flex items-end gap-3 md:hidden">
                        <label className="min-w-0 flex-1 text-sm text-muted-foreground">
                            <span className="mb-1.5 block text-xs font-medium text-foreground">
                                {m.calendar_plan_date()}
                            </span>
                            <Input
                                aria-label={m.calendar_plan_date()}
                                type="date"
                                value={mobileCreateDate}
                                onChange={event => setMobileCreateDate(event.target.value)}
                            />
                        </label>
                        <Button
                            nativeButton={false}
                            render={
                                <Link
                                    params={{ projectId: project.id }}
                                    search={{ date: mobileCreateDate }}
                                    to="/dashboard/projects/$projectId/compose"
                                />
                            }>
                            {m.calendar_new_short()}
                        </Button>
                    </div>
                    {scheduledPublications.length > 0 ? (
                        <>
                            <PublicationCalendarMonth
                                duePublicationIds={duePublicationIds(due)}
                                month={month}
                                projectId={project.id}
                            />
                            <PublicationCalendarAgenda
                                duePublicationIds={duePublicationIds(due)}
                                emptyDescription={m.calendar_empty_month_description({
                                    month: month.label,
                                })}
                                emptyTitle={m.calendar_empty_month_title({ month: month.label })}
                                month={month}
                            />
                            {!visibleScheduled ? (
                                <p className="mt-3 hidden text-sm text-muted-foreground md:block">
                                    {m.calendar_nothing_month({ month: month.label })}
                                </p>
                            ) : null}
                        </>
                    ) : (
                        <CalendarEmptyState />
                    )}
                </div>
            </section>

            {unscheduledPublications.length > 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                    {m.calendar_unscheduled_description({ count: unscheduledPublications.length })}{' '}
                    <Link
                        className="text-primary underline-offset-4 hover:text-foreground hover:underline"
                        params={{ projectId: project.id }}
                        to="/dashboard/projects/$projectId/queue">
                        {m.calendar_review_queue()}
                    </Link>
                    .
                </p>
            ) : null}
        </main>
    )
}
