import { Button } from '@herald/ui/components/button'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationBulkCancellationDialog } from '@/components/publication-bulk-cancellation-dialog'
import { PublicationBulkScheduleDialog } from '@/components/publication-bulk-schedule-dialog'
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
import {
    toPublicationCalendarEvents,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-events'
import * as m from '@/paraglide/messages.js'

export function PublicationCalendarPage({
    initialCalendarDateKey,
    initialCalendarView,
}: {
    readonly initialCalendarDateKey?: string
    readonly initialCalendarView?: PublicationCalendarView
} = {}) {
    const { locale } = useLanguage()
    const { due, onCancelPublications, onReschedulePublications, pending, project, publications } =
        useProjectDashboard()
    const queryClient = useQueryClient()
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
    const calendarPublicationIds = useMemo(
        () => toPublicationCalendarEvents(calendarPublications, dueIds).map(event => event.id),
        [calendarPublications, dueIds]
    )
    const [selectedPublicationIds, setSelectedPublicationIds] = useState<Set<string>>(
        () => new Set()
    )
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
    useEffect(() => {
        setSelectedPublicationIds(new Set())
    }, [calendarDateKey])

    const selectedCalendarPublications = calendarPublications.filter(publication =>
        selectedPublicationIds.has(publication.id)
    )
    const selectedCount = selectedCalendarPublications.length
    const allVisibleSelected =
        calendarPublicationIds.length > 0 &&
        calendarPublicationIds.every(publicationId => selectedPublicationIds.has(publicationId))
    const canRescheduleSelection =
        selectedCount > 0 &&
        selectedCalendarPublications.every(publication => publication.state === 'scheduled')
    const canCancelSelection = canRescheduleSelection

    function clearPublicationSelection() {
        setSelectedPublicationIds(new Set())
    }

    function toggleAllVisiblePublications() {
        setSelectedPublicationIds(current => {
            const next = new Set(current)
            if (allVisibleSelected) {
                for (const publicationId of calendarPublicationIds) next.delete(publicationId)
            } else {
                for (const publicationId of calendarPublicationIds) next.add(publicationId)
            }
            return next
        })
    }

    async function refreshCalendarPublications() {
        await queryClient.invalidateQueries({
            queryKey: projectQueryKeys.calendarPublications(project.id),
        })
    }

    async function rescheduleSelection(scheduledAt: number): Promise<boolean> {
        const succeeded = await onReschedulePublications(
            selectedCalendarPublications.map(publication => publication.id),
            scheduledAt
        )
        if (succeeded) {
            clearPublicationSelection()
            await refreshCalendarPublications()
        }
        return succeeded
    }

    async function cancelSelection(): Promise<boolean> {
        const succeeded = await onCancelPublications(
            selectedCalendarPublications.map(publication => publication.id)
        )
        if (succeeded) {
            clearPublicationSelection()
            await refreshCalendarPublications()
        }
        return succeeded
    }
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

            {selectedCount > 0 ? (
                <div className="mt-4">
                    <BulkActionBar
                        actions={[
                            {
                                disabled: !canRescheduleSelection,
                                disabledReason: m.queue_reschedule_only_scheduled(),
                                icon: <CalendarAddIcon aria-hidden="true" />,
                                id: 'reschedule',
                                label: m.queue_reschedule(),
                                onSelect: () => setScheduleDialogOpen(true),
                            },
                            {
                                disabled: !canCancelSelection,
                                disabledReason: m.queue_cancel_only_scheduled(),
                                icon: <TrashBinMinimalisticIcon aria-hidden="true" />,
                                id: 'cancel',
                                label: m.queue_cancel(),
                                onSelect: () => setCancelDialogOpen(true),
                                variant: 'destructive',
                            },
                        ]}
                        allSelected={allVisibleSelected}
                        ariaLabel={m.calendar_selection_actions()}
                        clearLabel={m.calendar_clear_selection()}
                        onClear={clearPublicationSelection}
                        onToggleAll={toggleAllVisiblePublications}
                        selectedCount={selectedCount}
                        selectionSummary={m.calendar_selected_publications({
                            count: selectedCount,
                        })}
                        toggleAllLabel={m.calendar_select_all_visible()}
                    />
                </div>
            ) : null}

            <section aria-labelledby="calendar-title" className="mt-7 min-w-0">
                <PublicationCalendar
                    duePublicationIds={dueIds}
                    loading={calendarPublicationsQuery.isFetching}
                    locale={locale}
                    calendarDate={calendarDate}
                    initialView={initialCalendarView}
                    onSelectedPublicationIdsChange={publicationIds =>
                        setSelectedPublicationIds(new Set(publicationIds))
                    }
                    projectId={project.id}
                    publications={calendarPublications}
                    selectedPublicationIds={selectedPublicationIds}
                    timeZone={project.timeZone}
                />
            </section>

            {unscheduledPublications.length > 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                    {m.calendar_unscheduled_description({ count: unscheduledPublications.length })}{' '}
                    <Link
                        className="text-primary underline-offset-4 hover:text-foreground hover:underline"
                        params={{ projectId: project.id }}
                        search={{ filter: undefined, tagIds: undefined }}
                        to="/dashboard/projects/$projectId/queue">
                        {m.calendar_review_queue()}
                    </Link>
                    .
                </p>
            ) : null}

            <PublicationBulkScheduleDialog
                open={scheduleDialogOpen}
                onOpenChange={setScheduleDialogOpen}
                onSchedule={rescheduleSelection}
                pending={pending}
                selectedCount={selectedCount}
                timeZone={project.timeZone}
            />
            <PublicationBulkCancellationDialog
                open={cancelDialogOpen}
                onCancel={cancelSelection}
                onOpenChange={setCancelDialogOpen}
                pending={pending}
                selectedCount={selectedCount}
            />
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
