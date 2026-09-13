import { Button } from '@herald/ui/components/button'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationCalendar } from '@/components/publication-calendar'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import {
    calendarDateFromKey,
    getCalendarViewportTimestampRange,
    getUnscheduledPublications,
    parseCalendarDateKey,
    toDateKey,
} from '@/lib/publication-calendar'
import type { PublicationCalendarView } from '@/lib/publication-calendar-events'
import * as m from '@/paraglide/messages.js'

export function PublicationCalendarPage({
    initialCalendarDateKey,
    initialCalendarView,
}: {
    readonly initialCalendarDateKey?: string
    readonly initialCalendarView?: PublicationCalendarView
} = {}) {
    const { locale } = useLanguage()
    const { due, project, publications } = useProjectDashboard()
    const todayDate = toDateKey(new Date(), project.timeZone)
    const calendarDateKey = initialCalendarDateKey ?? todayDate
    const calendarCursor = useMemo(
        () => parseCalendarDateKey(calendarDateKey) ?? new Date(),
        [calendarDateKey]
    )
    const calendarDate = useMemo(
        () => calendarDateFromKey(calendarDateKey, project.timeZone) ?? new Date(),
        [calendarDateKey, project.timeZone]
    )
    const calendarRange = useMemo(
        () => getCalendarViewportTimestampRange(calendarCursor, project.timeZone),
        [calendarCursor, project.timeZone]
    )
    const calendarPublicationsQuery = useQuery({
        queryKey: [
            ...projectQueryKeys.calendarPublications(project.id),
            calendarRange.from,
            calendarRange.to,
        ],
        queryFn: () => loadCalendarPublications(project.id, calendarRange),
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const calendarPublications = calendarPublicationsQuery.data ?? publications
    const dueIds = useMemo(() => new Set(due.map(publication => publication.id)), [due])
    const scheduledPublications = publications.filter(
        publication => publication.scheduledAt !== null
    )
    const unscheduledPublications = getUnscheduledPublications(publications)

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
                                to="/dashboard/projects/$projectId/publications/new"
                            />
                        }>
                        <CalendarMinimalisticIcon aria-hidden="true" />
                        {m.overview_new_publication()}
                    </Button>
                }
                title={m.overview_title()}>
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            <PublicationSummaryBar
                ariaLabel={m.overview_summary_aria()}
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

            <section aria-labelledby="calendar-title" className="mt-7 min-w-0">
                <PublicationCalendar
                    duePublicationIds={dueIds}
                    loading={calendarPublicationsQuery.isFetching}
                    locale={locale}
                    calendarDate={calendarDate}
                    initialView={initialCalendarView}
                    projectId={project.id}
                    publications={calendarPublications}
                    timeZone={project.timeZone}
                />
            </section>

            {unscheduledPublications.length > 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                    {m.calendar_unscheduled_description({ count: unscheduledPublications.length })}{' '}
                    <Link
                        className="text-primary underline-offset-4 hover:text-foreground hover:underline"
                        params={{ projectId: project.id }}
                        search={{ tagIds: undefined }}
                        to="/dashboard/projects/$projectId/queue">
                        {m.calendar_review_queue()}
                    </Link>
                    .
                </p>
            ) : null}
        </main>
    )
}

async function loadCalendarPublications(
    projectId: string,
    range: { readonly from: number; readonly to: number }
) {
    const publications = [] as Awaited<ReturnType<typeof api.listPublications>>['publications']
    let cursor: string | undefined

    do {
        const page = await api.listPublications(projectId, {
            cursor,
            from: range.from,
            limit: 100,
            to: range.to,
        })
        publications.push(...page.publications)
        cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined)

    return publications
}
