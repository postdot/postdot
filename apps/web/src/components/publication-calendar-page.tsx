import { Button } from '@postdot/ui/components/button'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmptyState } from '@/components/empty-state'
import { PublicationBulkCancellationDialog } from '@/components/publication-bulk-cancellation-dialog'
import { PublicationBulkMoveDialog } from '@/components/publication-bulk-move-dialog'
import { PublicationBulkScheduleDialog } from '@/components/publication-bulk-schedule-dialog'
import { PublicationCalendar } from '@/components/publication-calendar'
import {
    PublicationCalendarFilter,
    calendarFilterState,
} from '@/components/publication-calendar-filter'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { QueryErrorState } from '@/components/query-error-state'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { useProjectPublicationActions } from '@/lib/project-publication-actions'
import { projectQueryKeys } from '@/lib/project-realtime'
import { useProjectPublicationData } from '@/lib/project-resources'
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
import { Route } from '@/routes/dashboard/projects/$projectId/overview'

export function PublicationCalendarPage({
    initialCalendarDateKey,
    initialCalendarView,
}: {
    readonly initialCalendarDateKey?: string
    readonly initialCalendarView?: PublicationCalendarView
} = {}) {
    const { locale } = useLanguage()
    const search = Route.useSearch()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/overview' })
    const filterChannels = search.channelIds?.split(',').filter(Boolean) ?? []
    const filterStates = search.states?.split(',').filter(Boolean) ?? []
    function changeFilters(channelIds: string[], states: string[]) {
        setSelectedPublicationIds(new Set())
        void navigate({
            search: previous => ({
                ...previous,
                channelIds: channelIds.join(',') || undefined,
                states: states.join(',') || undefined,
            }),
            replace: true,
        })
    }
    const { channels, project, projectRole } = useProjectDashboard()
    const { due, publications, publicationSummary } = useProjectPublicationData(project.id)
    const { onCancelPublications, onReschedulePublications, pending } =
        useProjectPublicationActions()
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
        enabled: channels.length > 0,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const calendarPublications = calendarPublicationsQuery.data ?? []
    // Another project's time on a shared channel is read beside this project's own work.
    const hasSharedChannel = channels.some(channel => channel.shared)
    const occupancyQuery = useQuery({
        queryKey: [
            ...projectQueryKeys.calendarPublications(project.id),
            'occupancy',
            calendarRange.from,
            calendarRange.to,
        ],
        queryFn: async () => (await api.listChannelOccupancy(project.id, calendarRange)).occupancy,
        enabled: hasSharedChannel,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const occupancy = hasSharedChannel ? (occupancyQuery.data ?? []) : []
    const dueIds = useMemo(() => new Set(due.map(publication => publication.id)), [due])
    const filteredPublications = calendarPublications.filter(
        p =>
            (filterChannels.length === 0 || filterChannels.includes(p.channelId)) &&
            (filterStates.length === 0 || filterStates.includes(calendarFilterState(p, dueIds)))
    )
    const hiddenCount =
        calendarPublications.filter(p => p.scheduledAt !== null).length -
        filteredPublications.filter(p => p.scheduledAt !== null).length
    // The next publication is read from the project's work, not the visible month.
    const nextScheduledPublication = useMemo(() => {
        const upcoming = [...publications, ...calendarPublications].filter(
            publication =>
                publication.state === 'scheduled' &&
                publication.scheduledAt !== null &&
                // C9: "next" is strictly in the future.
                publication.scheduledAt > Date.now()
        )
        upcoming.sort((left, right) => left.scheduledAt! - right.scheduledAt!)
        return upcoming[0] ?? null
    }, [publications, calendarPublications])
    const failedCount = publications.filter(
        publication => publication.state === 'failed' || publication.state === 'ambiguous'
    ).length
    const calendarPublicationIds = useMemo(
        () => toPublicationCalendarEvents(filteredPublications, dueIds).map(event => event.id),
        [filteredPublications, dueIds]
    )
    const [selectedPublicationIds, setSelectedPublicationIds] = useState<Set<string>>(
        () => new Set()
    )
    const [moveDialogOpen, setMoveDialogOpen] = useState(false)
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
    useEffect(() => {
        setSelectedPublicationIds(new Set())
    }, [calendarDateKey, search.channelIds, search.states])

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

    async function rescheduleSelection(
        scheduledAt: number,
        scheduledTimes?: Record<string, number>
    ): Promise<boolean> {
        const succeeded = await onReschedulePublications(
            selectedCalendarPublications.map(publication => publication.id),
            scheduledAt,
            scheduledTimes
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
    const unscheduledPublications = getUnscheduledPublications(publications)
    const canEditProject = projectRole === 'owner' || projectRole === 'editor'
    const noChannels = channels.length === 0
    // Viewers keep every consultation path. The create entry points and the
    // bulk mutation surface are withheld because the API refuses them for this
    // role, mirroring the Queue gating.
    const readOnly = !canEditProject

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    noChannels || !canEditProject ? undefined : (
                        <Button
                            className="md:hidden"
                            nativeButton={false}
                            render={
                                <Link
                                    params={{ projectId: project.id }}
                                    search={{ date: todayDate }}
                                    to="/dashboard/projects/$projectId/publications/new"
                                />
                            }>
                            <AddIcon aria-hidden="true" />
                            {m.overview_new_publication()}
                        </Button>
                    )
                }
                title={m.overview_title()}
            />

            {noChannels ? (
                <EmptyState
                    action={
                        canEditProject ? (
                            <Button
                                nativeButton={false}
                                render={
                                    <Link
                                        params={{ projectId: project.id }}
                                        search={{ add: true }}
                                        to="/dashboard/projects/$projectId/channels"
                                    />
                                }>
                                <AddIcon aria-hidden="true" />
                                {m.channel_add()}
                            </Button>
                        ) : undefined
                    }
                    className="w-full"
                    description={m.overview_setup_channels_description()}
                    illustration="network"
                    layout="default"
                    title={m.overview_setup_channels_title()}
                />
            ) : (
                <>
                    <PublicationSummaryBar
                        ariaLabel={m.overview_summary_aria()}
                        dueCount={due.length}
                        failedCount={failedCount}
                        locale={locale}
                        nextChannel={
                            channels.find(
                                channel => channel.id === nextScheduledPublication?.channelId
                            ) ?? null
                        }
                        nextPublication={nextScheduledPublication}
                        scheduledCount={publicationSummary.scheduled}
                        projectId={project.id}
                        timeZone={project.timeZone}
                    />

                    {/* C10: the selection bar floats above the calendar instead of pushing it down. */}
                    {!readOnly && selectedCount > 0 ? (
                        <div
                            className="fixed bottom-5 left-1/2 z-40 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2"
                            data-calendar-selection-bar="true">
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
                                        disabled: !canRescheduleSelection,
                                        disabledReason: m.queue_reschedule_only_scheduled(),
                                        id: 'move',
                                        label: m.calendar_move_by(),
                                        onSelect: () => setMoveDialogOpen(true),
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
                                className="static bg-popover shadow-overlay backdrop-blur-none"
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

                    {calendarPublicationsQuery.isError ? (
                        <QueryErrorState
                            className="mt-7"
                            onRetry={() => void calendarPublicationsQuery.refetch()}
                        />
                    ) : (
                        <>
                            <section aria-labelledby="calendar-title" className="mt-7 min-w-0">
                                <PublicationCalendar
                                    filterControl={
                                        <div className="flex flex-wrap items-center gap-2">
                                            <PublicationCalendarFilter
                                                channels={channels}
                                                states={[
                                                    ...new Set(
                                                        calendarPublications.map(p =>
                                                            calendarFilterState(p, dueIds)
                                                        )
                                                    ),
                                                ]}
                                                channelIds={filterChannels}
                                                selectedStates={filterStates}
                                                onChange={changeFilters}
                                            />
                                            {hiddenCount > 0 ||
                                            filterChannels.length > 0 ||
                                            filterStates.length > 0 ? (
                                                <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                                    {hiddenCount > 0
                                                        ? m.calendar_filter_hidden({
                                                              count: hiddenCount,
                                                          })
                                                        : null}{' '}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => changeFilters([], [])}>
                                                        {m.calendar_filter_clear()}
                                                    </Button>
                                                </p>
                                            ) : null}
                                        </div>
                                    }
                                    channels={channels}
                                    occupancy={occupancy.filter(
                                        item =>
                                            filterChannels.length === 0 ||
                                            filterChannels.includes(item.channelId)
                                    )}
                                    duePublicationIds={dueIds}
                                    loading={calendarPublicationsQuery.isFetching}
                                    locale={locale}
                                    calendarDate={calendarDate}
                                    initialView={initialCalendarView}
                                    onSelectedPublicationIdsChange={publicationIds => {
                                        if (readOnly) return
                                        setSelectedPublicationIds(new Set(publicationIds))
                                    }}
                                    projectId={project.id}
                                    publications={filteredPublications}
                                    readOnly={readOnly}
                                    selectedPublicationIds={selectedPublicationIds}
                                    timeZone={project.timeZone}
                                />
                                {occupancy.length > 0 ? (
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        {m.calendar_occupied_note()}
                                    </p>
                                ) : null}
                            </section>

                            {unscheduledPublications.length > 0 ? (
                                <p className="mt-5 text-sm text-muted-foreground">
                                    {m.calendar_unscheduled_description({
                                        count: unscheduledPublications.length,
                                    })}{' '}
                                    <Link
                                        className="text-primary underline underline-offset-4 hover:text-foreground"
                                        params={{ projectId: project.id }}
                                        search={{
                                            filter: undefined,
                                            sort: undefined,
                                            tagIds: undefined,
                                        }}
                                        to="/dashboard/projects/$projectId/queue">
                                        {m.calendar_review_queue()}
                                    </Link>
                                    .
                                </p>
                            ) : null}
                        </>
                    )}
                </>
            )}

            <PublicationBulkMoveDialog
                open={moveDialogOpen}
                onOpenChange={setMoveDialogOpen}
                publications={selectedCalendarPublications}
                pending={pending}
                timeZone={project.timeZone}
                onMove={times => rescheduleSelection(Math.min(...Object.values(times)), times)}
            />
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
