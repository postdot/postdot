import { Button } from '@postdot/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@postdot/ui/components/tabs'
import { AddIcon } from '@solar-icons/react/linear/add'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { PublicationList } from '@/components/dashboard-publication-parts'
import type { EmptyStateIllustration } from '@/components/empty-state'
import { ActiveFilters, type FilterGroup, FilterMenu, SortMenu } from '@/components/filter-controls'
import { ProjectPage } from '@/components/project-page'
import { PublicationApprovalRequests } from '@/components/publication-approval-requests'
import { PublicationBulkCancellationDialog } from '@/components/publication-bulk-cancellation-dialog'
import { PublicationBulkScheduleDialog } from '@/components/publication-bulk-schedule-dialog'
import { PublicationDraftDeletionDialog } from '@/components/publication-draft-deletion-dialog'
import { QueryErrorState } from '@/components/query-error-state'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { useProjectPublicationActions } from '@/lib/project-publication-actions'
import { projectQueryKeys } from '@/lib/project-realtime'
import { useProjectPublicationData, useProjectPublicationPagination } from '@/lib/project-resources'
import { useProjectTagCatalog } from '@/lib/project-tags'
import {
    defaultPublicationQueueSort,
    filterQueueByTags,
    filterQueuePublications,
    isQueueFilter,
    isPublicationQueueSort,
    prioritizeQueuePublications,
    type PublicationQueueSort,
    type QueueFilter,
} from '@/lib/publication-queue'
import * as m from '@/paraglide/messages.js'

export function PublicationQueuePage({
    initialFilter = 'all',
    initialSort,
    initialTagIds = [],
    initialView = 'posts',
}: {
    readonly initialView?: 'queue' | 'posts'
    readonly initialFilter?: QueueFilter
    readonly initialSort?: PublicationQueueSort
    readonly initialTagIds?: readonly string[]
}) {
    const { locale } = useLanguage()
    const { project, projectRole, channels } = useProjectDashboard()
    const { due, publications, publicationsNextCursor, publicationSummary } =
        useProjectPublicationData(project.id)
    const { loadingMorePublications, onLoadMorePublications } = useProjectPublicationPagination(
        project.id
    )
    const needsFirstChannel = channels.length === 0 && publications.length === 0
    const catalogQuery = useProjectTagCatalog(project.id)
    const projectTags = catalogQuery.data?.tags.filter(tag => tag.state === 'active') ?? []
    const {
        onCancelPublications,
        onDeleteDraftPublication,
        onDuplicateDraftPublication,
        onPublish,
        onRetryPublication,
        onReschedulePublications,
        onUndoPublish,
        pending,
    } = useProjectPublicationActions()
    const canEditProject = projectRole === 'owner' || projectRole === 'editor'
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/queue' })
    const [view, setView] = useState(initialView)
    useEffect(() => setView(initialView), [initialView])
    const [filter, setFilter] = useState<QueueFilter>(initialFilter)
    const [sort, setSort] = useState<PublicationQueueSort>(
        initialSort ?? defaultPublicationQueueSort(initialFilter)
    )
    const [tagIds, setTagIds] = useState<string[]>(() => [...initialTagIds])
    const [selectedPublicationIds, setSelectedPublicationIds] = useState<Set<string>>(
        () => new Set()
    )
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
    const [draftToDelete, setDraftToDelete] = useState<string | null>(null)
    useEffect(() => {
        setFilter(initialFilter)
        setSort(initialSort ?? defaultPublicationQueueSort(initialFilter))
        setSelectedPublicationIds(new Set())
    }, [initialFilter, initialSort])
    const initialTagIdsKey = initialTagIds.join('\u0000')
    useEffect(() => {
        setTagIds(initialTagIdsKey === '' ? [] : initialTagIdsKey.split('\u0000'))
        setSelectedPublicationIds(new Set())
    }, [initialTagIdsKey])
    const duePublicationIds = useMemo(() => new Set(due.map(publication => publication.id)), [due])
    const hasActiveFilters = tagIds.length > 0 || filter === 'manual'
    const queueHasWork = publicationSummary.total > 0 || hasActiveFilters || filter !== 'all'
    const serverState =
        filter === 'draft' || filter === 'scheduled' || filter === 'published' ? filter : undefined
    const useServerQueue = serverState !== undefined || tagIds.length > 0 || sort !== 'queue'
    const queueQuery = useInfiniteQuery({
        queryKey: [
            ...projectQueryKeys.publicationQueues(project.id),
            serverState ?? 'all',
            sort,
            tagIds.join('\u0000'),
        ],
        queryFn: ({ pageParam }) =>
            api.listPublications(project.id, {
                cursor: pageParam,
                limit: 100,
                sort,
                state: serverState,
                tagIds: tagIds.length > 0 ? tagIds : undefined,
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: page => page.nextCursor ?? undefined,
        enabled: useServerQueue,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const queuePublications = useServerQueue
        ? (queueQuery.data?.pages.flatMap(page => page.publications) ?? [])
        : publications
    const queueSummary = useServerQueue
        ? (queueQuery.data?.pages[0]?.summary ?? publicationSummary)
        : publicationSummary
    const draftCount =
        typeof queueSummary.draft === 'number' && Number.isFinite(queueSummary.draft)
            ? queueSummary.draft
            : queuePublications.filter(publication => publication.state === 'draft').length
    const taggedPublications = filterQueueByTags(queuePublications, tagIds)
    const filterCounts: Record<QueueFilter, number> = {
        all: queueSummary.total,
        attention: filterQueuePublications(taggedPublications, duePublicationIds, 'attention')
            .length,
        draft: draftCount,
        scheduled: queueSummary.scheduled,
        published: queueSummary.published ?? 0,
        manual: queueSummary.manual,
    }
    const filteredPublications = filterQueuePublications(
        taggedPublications,
        duePublicationIds,
        filter
    )
    const visiblePublications =
        sort === 'queue'
            ? prioritizeQueuePublications(filteredPublications, duePublicationIds)
            : filteredPublications
    const selectedPublications = visiblePublications.filter(publication =>
        selectedPublicationIds.has(publication.id)
    )
    const selectedCount = selectedPublications.length
    const allVisibleSelected =
        visiblePublications.length > 0 && selectedCount === visiblePublications.length
    const canRescheduleSelection =
        selectedCount > 0 &&
        selectedPublications.every(publication => publication.state === 'scheduled')
    const canCancelSelection = canRescheduleSelection

    function togglePublicationSelection(publicationId: string) {
        setSelectedPublicationIds(current => {
            const next = new Set(current)
            if (next.has(publicationId)) next.delete(publicationId)
            else next.add(publicationId)
            return next
        })
    }

    function toggleAllVisiblePublications() {
        setSelectedPublicationIds(current => {
            const next = new Set(current)
            if (allVisibleSelected) {
                for (const publication of visiblePublications) next.delete(publication.id)
            } else {
                for (const publication of visiblePublications) next.add(publication.id)
            }
            return next
        })
    }

    function clearPublicationSelection() {
        setSelectedPublicationIds(new Set())
    }

    async function rescheduleSelection(scheduledAt: number): Promise<boolean> {
        const succeeded = await onReschedulePublications(
            selectedPublications.map(publication => publication.id),
            scheduledAt
        )
        if (succeeded) clearPublicationSelection()
        return succeeded
    }

    async function cancelSelection(): Promise<boolean> {
        const succeeded = await onCancelPublications(
            selectedPublications.map(publication => publication.id)
        )
        if (succeeded) clearPublicationSelection()
        return succeeded
    }

    async function deleteDraft(): Promise<boolean> {
        if (draftToDelete === null) return false
        const succeeded = await onDeleteDraftPublication(draftToDelete)
        if (succeeded) {
            setDraftToDelete(null)
            clearPublicationSelection()
        }
        return succeeded
    }

    function duplicateDraft(publicationId: string) {
        void onDuplicateDraftPublication(publicationId).then(publication => {
            if (publication === null) return
            void navigate({
                to: '/dashboard/projects/$projectId/publications/$publicationId',
                params: {
                    projectId: project.id,
                    publicationId: publication.id,
                },
            })
        })
    }

    function changeTags(nextTagIds: string[]) {
        setTagIds(nextTagIds)
        clearPublicationSelection()
        void navigate({
            search: current => ({
                ...current,
                tagIds: nextTagIds.length > 0 ? nextTagIds : undefined,
            }),
        })
    }
    const queueFilterGroups: FilterGroup[] = [
        {
            anyValue: 'all',
            id: 'delivery',
            label: m.queue_delivery_filter(),
            onChange: values => changeFilter(values[0] === 'manual' ? 'manual' : 'all'),
            options: [
                { label: m.queue_all_delivery_modes(), value: 'all' },
                { label: m.queue_manual_delivery_mode(), value: 'manual' },
            ],
            selected: [filter === 'manual' ? 'manual' : 'all'],
        },
        {
            id: 'tags',
            label: m.taxonomy_tags(),
            multiple: true,
            onChange: changeTags,
            options: projectTags.map(tag => ({ label: tag.name, value: tag.id })),
            selected: tagIds,
        },
    ]

    function changeFilter(nextFilter: QueueFilter) {
        setFilter(nextFilter)
        clearPublicationSelection()
        void navigate({
            search: current => ({
                ...current,
                filter: nextFilter === 'all' ? undefined : nextFilter,
            }),
        })
    }

    return (
        <ProjectPage
            width="full"
            action={
                canEditProject ? (
                    needsFirstChannel ? (
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
                    ) : (
                        <Button
                            className={channels.length > 0 ? 'md:hidden' : undefined}
                            nativeButton={false}
                            render={
                                <Link
                                    params={{ projectId: project.id }}
                                    search={{ date: undefined }}
                                    to="/dashboard/projects/$projectId/publications/new"
                                />
                            }>
                            <AddIcon aria-hidden="true" />
                            {m.overview_new_publication()}
                        </Button>
                    )
                ) : undefined
            }
            title={m.queue_title()}>
            {canEditProject ? (
                <PublicationApprovalRequests projectId={project.id} timeZone={project.timeZone} />
            ) : null}

            {/* Q5: no tabs or filters while there is nothing to filter. */}
            {queueHasWork ? (
                <>
                    <div className="mt-5 min-w-0" data-queue-controls="true">
                        <Tabs
                            aria-label={m.queue_filters()}
                            className="min-w-0 max-w-full"
                            value={filter === 'manual' ? null : filter}
                            onValueChange={value => {
                                if (!isQueueFilter(value)) return
                                if (value === 'manual') return
                                changeFilter(value)
                            }}>
                            <TabsList variant="line">
                                <TabsTrigger
                                    aria-label={m.queue_filter_aria({
                                        label: m.queue_all(),
                                        count: filterCounts.all,
                                    })}
                                    value="all">
                                    {m.queue_all()}
                                    {filterCounts.all > 0 ? (
                                        <span className="text-xs font-normal tabular-nums text-muted-foreground">
                                            {formatNumber(filterCounts.all, locale)}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                                <TabsTrigger
                                    aria-label={m.queue_filter_aria({
                                        label: m.queue_attention(),
                                        count: filterCounts.attention,
                                    })}
                                    value="attention">
                                    {m.queue_attention()}
                                    {filterCounts.attention > 0 ? (
                                        <span className="text-xs font-normal tabular-nums text-muted-foreground">
                                            {formatNumber(filterCounts.attention, locale)}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                                <TabsTrigger
                                    aria-label={m.queue_filter_aria({
                                        label: m.queue_scheduled(),
                                        count: filterCounts.scheduled,
                                    })}
                                    value="scheduled">
                                    {m.queue_scheduled()}
                                    {filterCounts.scheduled > 0 ? (
                                        <span className="text-xs font-normal tabular-nums text-muted-foreground">
                                            {formatNumber(filterCounts.scheduled, locale)}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                                <TabsTrigger
                                    aria-label={m.queue_filter_aria({
                                        label: m.queue_drafts(),
                                        count: filterCounts.draft,
                                    })}
                                    value="draft">
                                    {m.queue_drafts()}
                                    {filterCounts.draft > 0 ? (
                                        <span className="text-xs font-normal tabular-nums text-muted-foreground">
                                            {formatNumber(filterCounts.draft, locale)}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                                <TabsTrigger
                                    aria-label={m.queue_filter_aria({
                                        label: m.queue_published(),
                                        count: filterCounts.published,
                                    })}
                                    value="published">
                                    {m.queue_published()}
                                    {filterCounts.published > 0 ? (
                                        <span className="text-xs font-normal tabular-nums text-muted-foreground">
                                            {formatNumber(filterCounts.published, locale)}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    {visiblePublications.length > 0 || hasActiveFilters ? (
                        <div
                            aria-label={m.queue_delivery_filter()}
                            className="mt-4 flex min-w-0 flex-wrap items-center gap-2"
                            role="toolbar">
                            {/* Q1: a visible two-state switch instead of an unlabelled menu. */}
                            <div
                                aria-label={m.queue_view_label()}
                                className="flex items-center rounded-md bg-muted p-0.5"
                                role="group">
                                {(['posts', 'queue'] as const).map(option => (
                                    <Button
                                        aria-pressed={view === option}
                                        className={
                                            view === option
                                                ? 'bg-surface-raised font-semibold text-foreground shadow-none hover:bg-surface-raised'
                                                : 'text-muted-foreground'
                                        }
                                        key={option}
                                        onClick={() => {
                                            setView(option)
                                            void navigate({
                                                search: current => ({
                                                    ...current,
                                                    view:
                                                        option === 'queue' ? 'channels' : undefined,
                                                }),
                                            })
                                        }}
                                        size="sm"
                                        type="button"
                                        variant="ghost">
                                        {option === 'posts'
                                            ? m.queue_view_posts()
                                            : m.queue_view_queue()}
                                    </Button>
                                ))}
                            </div>
                            <div className="ml-auto flex items-center gap-1">
                                <FilterMenu groups={queueFilterGroups} />
                                <SortMenu
                                    onChange={value => {
                                        if (!isPublicationQueueSort(value)) return
                                        setSort(value)
                                        clearPublicationSelection()
                                        void navigate({
                                            search: current => ({
                                                ...current,
                                                sort: value === 'queue' ? undefined : value,
                                            }),
                                        })
                                    }}
                                    options={queueSortOptions(filter)}
                                    value={sort}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div className="mt-3 empty:hidden">
                        <ActiveFilters groups={queueFilterGroups} />
                    </div>

                    {/* The selection floats like the calendar's; the toolbar never changes shape. */}
                    {selectedCount > 0 ? (
                        <div
                            className="fixed bottom-5 left-1/2 z-40 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2"
                            data-queue-selection-bar="true">
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
                                ariaLabel={m.queue_bulk_actions()}
                                clearLabel={m.queue_clear_selection()}
                                onClear={clearPublicationSelection}
                                selectedCount={selectedCount}
                                selectionSummary={m.queue_selected_publications({
                                    count: selectedCount,
                                })}
                                showClearSelection={!allVisibleSelected}
                            />
                        </div>
                    ) : null}
                </>
            ) : null}

            <section className="min-w-0" data-queue-publication-list="true">
                {queueQuery.isError && useServerQueue ? (
                    <QueryErrorState onRetry={() => void queueQuery.refetch()} />
                ) : (
                    <PublicationList
                        emptyAction={
                            hasActiveFilters ? (
                                <Button
                                    onClick={() => {
                                        const nextFilter = filter === 'manual' ? 'all' : filter
                                        setTagIds([])
                                        setFilter(nextFilter)
                                        setSort(defaultPublicationQueueSort(nextFilter))
                                        clearPublicationSelection()
                                        void navigate({
                                            search: current => ({
                                                ...current,
                                                filter:
                                                    nextFilter === 'all' ? undefined : nextFilter,
                                                sort: undefined,
                                                tagIds: undefined,
                                            }),
                                        })
                                    }}
                                    size="sm"
                                    variant="ghost">
                                    {m.filter_clear_all()}
                                </Button>
                            ) : filter === 'all' ? null : (
                                <Button
                                    onClick={() => {
                                        setFilter('all')
                                        void navigate({
                                            search: current => ({
                                                ...current,
                                                filter: undefined,
                                            }),
                                        })
                                    }}
                                    size="sm"
                                    variant="ghost">
                                    {m.queue_show_all()}
                                </Button>
                            )
                        }
                        emptyDescription={
                            needsFirstChannel && filter === 'all'
                                ? m.channels_empty_description()
                                : queueEmptyDescription(filter)
                        }
                        emptyIllustration={queueEmptyIllustration(filter)}
                        emptyLayout="default"
                        emptyTitle={
                            needsFirstChannel && filter === 'all'
                                ? m.overview_setup_channels_title()
                                : queueEmptyTitle(filter)
                        }
                        onToggleSelection={
                            canEditProject
                                ? publication => togglePublicationSelection(publication.id)
                                : undefined
                        }
                        duePublicationIds={duePublicationIds}
                        onDeleteDraft={
                            canEditProject
                                ? publication => setDraftToDelete(publication.id)
                                : undefined
                        }
                        onDuplicateDraft={canEditProject ? duplicateDraft : undefined}
                        onPublish={canEditProject ? onPublish : undefined}
                        onUndoPublish={canEditProject ? onUndoPublish : undefined}
                        onRetry={canEditProject ? onRetryPublication : undefined}
                        pending={pending}
                        publications={visiblePublications}
                        showPostLink
                        groupByPost={view === 'posts'}
                        allSelected={allVisibleSelected}
                        onToggleAll={canEditProject ? toggleAllVisiblePublications : undefined}
                        readOnly={!canEditProject}
                        selectedPublicationIds={selectedPublicationIds}
                        showCreationDate={filter === 'draft'}
                        timeZone={project.timeZone}
                    />
                )}
                {!queueQuery.isError &&
                (useServerQueue ? queueQuery.hasNextPage : publicationsNextCursor !== null) ? (
                    <div className="mt-5 flex justify-center">
                        <Button
                            disabled={
                                useServerQueue
                                    ? queueQuery.isFetchingNextPage
                                    : loadingMorePublications
                            }
                            onClick={() => {
                                if (useServerQueue) void queueQuery.fetchNextPage()
                                else void onLoadMorePublications()
                            }}
                            variant="secondary">
                            {useServerQueue
                                ? queueQuery.isFetchingNextPage
                                    ? m.common_loading()
                                    : m.queue_load_more()
                                : loadingMorePublications
                                  ? m.common_loading()
                                  : m.queue_load_more()}
                        </Button>
                    </div>
                ) : null}
            </section>

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
            <PublicationDraftDeletionDialog
                open={draftToDelete !== null}
                onDelete={deleteDraft}
                onOpenChange={open => {
                    if (!open) setDraftToDelete(null)
                }}
                pending={pending}
            />
        </ProjectPage>
    )
}

function queueEmptyDescription(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_description()
    if (filter === 'draft') return null
    if (filter === 'scheduled') return m.queue_no_scheduled_description()
    if (filter === 'published') return m.queue_no_published_description()
    if (filter === 'manual') return m.queue_no_manual_description()
    return m.queue_no_publications_description()
}

function queueEmptyTitle(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_title()
    if (filter === 'draft') return m.queue_no_drafts_title()
    if (filter === 'scheduled') return m.queue_no_scheduled_title()
    if (filter === 'published') return m.queue_no_published_title()
    if (filter === 'manual') return m.queue_no_manual_title()
    return m.queue_no_publications()
}

function queueEmptyIllustration(filter: QueueFilter): EmptyStateIllustration {
    if (filter === 'scheduled') return 'event'
    if (filter === 'draft' || filter === 'manual' || filter === 'attention') return 'task'
    return 'data'
}

function queueSortOptions(filter: QueueFilter) {
    const updated = [
        { value: 'updated_desc' as const, label: m.queue_sort_updated_desc() },
        { value: 'updated_asc' as const, label: m.queue_sort_updated_asc() },
    ]
    const created = [
        { value: 'created_desc' as const, label: m.queue_sort_created_desc() },
        { value: 'created_asc' as const, label: m.queue_sort_created_asc() },
    ]

    if (filter === 'scheduled') {
        return [
            { value: 'queue' as const, label: m.queue_sort_queue() },
            { value: 'scheduled_asc' as const, label: m.queue_sort_scheduled_asc() },
            { value: 'scheduled_desc' as const, label: m.queue_sort_scheduled_desc() },
            ...updated,
        ]
    }
    if (filter === 'published') {
        return [
            { value: 'scheduled_desc' as const, label: m.queue_sort_scheduled_desc() },
            { value: 'scheduled_asc' as const, label: m.queue_sort_scheduled_asc() },
        ]
    }
    if (filter === 'draft') return [...updated, ...created]
    return [{ value: 'queue' as const, label: m.queue_sort_queue() }, ...updated, ...created]
}
