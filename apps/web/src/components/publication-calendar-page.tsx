import { Button } from '@herald/ui/components/button'
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
import { useProjectDashboard } from '@/lib/dashboard-context'
import {
    createCalendarMonth,
    getUnscheduledPublications,
    shiftCalendarMonth,
    startOfCalendarMonth,
} from '@/lib/publication-calendar'

export function PublicationCalendarPage() {
    const { due, project, publications } = useProjectDashboard()
    const [monthCursor, setMonthCursor] = useState(() =>
        startOfCalendarMonth(new Date(), project.timeZone)
    )
    const month = useMemo(
        () => createCalendarMonth(monthCursor, publications, new Date(), project.timeZone),
        [monthCursor, project.timeZone, publications]
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
                                to="/dashboard/projects/$projectId/compose"
                                params={{ projectId: project.id }}
                            />
                        }>
                        <CalendarMinimalisticIcon aria-hidden="true" />
                        New publication
                    </Button>
                }
                title="Calendar">
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            <div
                aria-label="Calendar summary"
                className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-muted px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
                <span>
                    <strong className="font-medium text-foreground">
                        {scheduledPublications.length}
                    </strong>{' '}
                    scheduled
                </span>
                <span>
                    <strong className="font-medium text-foreground">
                        {unscheduledPublications.length}
                    </strong>{' '}
                    unscheduled
                </span>
                <span className={due.length > 0 ? 'text-state-attention' : undefined}>
                    <strong className="font-medium text-current">{due.length}</strong> needs
                    attention
                </span>
            </div>

            <section aria-labelledby="calendar-month" className="mt-7 min-w-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-1.5">
                        <Button
                            aria-label="Previous month"
                            onClick={() => goToMonth(-1)}
                            size="icon-sm"
                            variant="ghost">
                            <AltArrowLeftIcon aria-hidden="true" />
                        </Button>
                        <Button onClick={goToToday} size="sm" variant="ghost">
                            Today
                        </Button>
                        <Button
                            aria-label="Next month"
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
                            {scheduledPublications.length}{' '}
                            {scheduledPublications.length === 1 ? 'publication' : 'publications'}
                        </span>
                    </div>
                </div>

                <div className="mt-4">
                    {scheduledPublications.length > 0 ? (
                        <>
                            <PublicationCalendarMonth
                                duePublicationIds={duePublicationIds(due)}
                                month={month}
                            />
                            <PublicationCalendarAgenda
                                duePublicationIds={duePublicationIds(due)}
                                emptyDescription={`There are no scheduled publications in ${month.label}.`}
                                emptyTitle={`Nothing scheduled in ${month.label}`}
                                month={month}
                            />
                            {!visibleScheduled ? (
                                <p className="mt-3 hidden text-sm text-muted-foreground md:block">
                                    Nothing is scheduled in {month.label}. Use the month controls to
                                    review another period.
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
                    {unscheduledPublications.length} publication
                    {unscheduledPublications.length === 1 ? '' : 's'} remain outside the calendar
                    until a time is chosen. Review them from the Queue.
                </p>
            ) : null}
        </main>
    )
}
