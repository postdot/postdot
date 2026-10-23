import { Badge } from '@postdot/ui/components/badge'
import { Button, buttonVariants } from '@postdot/ui/components/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { Tabs, TabsList, TabsTrigger } from '@postdot/ui/components/tabs'
import { cn } from '@postdot/ui/lib/utils'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { PenIcon } from '@solar-icons/react/linear/pen'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationList } from '@/components/dashboard-publication-parts'
import type { EmptyStateIllustration } from '@/components/empty-state'
import { PublicationApprovalRequests } from '@/components/publication-approval-requests'
import { PublicationBulkCancellationDialog } from '@/components/publication-bulk-cancellation-dialog'
import { PublicationBulkScheduleDialog } from '@/components/publication-bulk-schedule-dialog'
import { PublicationDraftDeletionDialog } from '@/components/publication-draft-deletion-dialog'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
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
    initialView = 'queue',
}: {
    readonly initialView?: 'queue' | 'posts'
    readonly initialFilter?: QueueFilter
    readonly initialSort?: PublicationQueueSort
    readonly initialTagIds?: readonly string[]
}) {
    const { locale } = useLanguage()
    const { project, projectRole } = useProjectDashboard()
    const { due, publications, publicationsNextCursor, publicationSummary } =
        useProjectPublicationData(project.id)
    const { loadingMorePublications, onLoadMorePublications } = useProjectPublicationPagination(
        project.id
    )
    const catalogQuery = useProjectTagCatalog(project.id)
    const projectTags = catalogQuery.data?.tags.filter(tag => tag.state === 'active') ?? []
    const {
        onCancelPublications,
        onDeleteDraftPublication,
        onDuplicateDraftPublication,
        onPublish,
        onRetryPublication,
        onReschedulePublications,
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
    const serverState = filter === 'draft' || filter === 'scheduled' ? filter : undefined
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
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    canEditProject ? (
                        <Button
                            nativeButton={false}
                            render={
                                <Link
                                    params={{ projectId: project.id }}
                                    search={{ date: undefined }}
                                    to="/dashboard/projects/$projectId/publications/new"
                                />
                            }>
                            <PenIcon aria-hidden="true" />
                            {m.overview_new_publication()}
                        </Button>
                    ) : undefined
                }
                back={
                    <Link
                        aria-label={m.nav_back_to_overview()}
                        className={buttonVariants({
                            variant: 'ghost',
                            size: 'icon',
                            className:
                                'justify-self-start text-muted-foreground hover:text-foreground lg:w-auto lg:gap-1.5 lg:px-2.5',
                        })}
                        params={{ projectId: project.id }}
                        to="/dashboard/projects/$projectId/overview">
                        <AltArrowLeftIcon aria-hidden="true" />
                        <span className="hidden lg:inline">{m.nav_back_to_overview()}</span>
                    </Link>
                }
                title={m.queue_title()}
            />

            {canEditProject ? (
                <PublicationApprovalRequests projectId={project.id} timeZone={project.timeZone} />
            ) : null}

            <div className="mt-5 min-w-0" data-queue-controls="true">
                <Tabs
                    aria-label={m.queue_filters()}
                    className="min-w-0 w-fit max-w-full"
                    value={filter === 'manual' ? null : filter}
                    onValueChange={value => {
                        if (!isQueueFilter(value)) return
                        if (value === 'manual') return
                        changeFilter(value)
                    }}>
                    <TabsList
                        className="!h-auto min-h-8 w-fit max-w-full flex-wrap justify-start gap-0.5 !overflow-visible bg-surface-inset/70 p-1 shadow-surface [&>[data-slot=tabs-trigger]]:flex-none [&>[data-slot=tabs-trigger]]:shrink-0"
                        variant="default">
                        <TabsTrigger
                            aria-label={m.queue_filter_aria({
                                label: m.queue_all(),
                                count: filterCounts.all,
                            })}
                            value="all">
                            {m.queue_all()}
                            {filterCounts.all > 0 ? (
                                <Badge
                                    className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                    variant="secondary">
                                    {formatNumber(filterCounts.all, locale)}
                                </Badge>
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
                                <Badge
                                    className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                    variant="secondary">
                                    {formatNumber(filterCounts.attention, locale)}
                                </Badge>
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
                                <Badge
                                    className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                    variant="secondary">
                                    {formatNumber(filterCounts.scheduled, locale)}
                                </Badge>
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
                                <Badge
                                    className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                    variant="secondary">
                                    {formatNumber(filterCounts.draft, locale)}
                                </Badge>
                            ) : null}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

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
                ariaLabel={selectedCount > 0 ? m.queue_bulk_actions() : m.queue_delivery_filter()}
                className={cn('mt-3 min-h-11', selectedCount > 0 && 'px-2 py-1.5 sm:px-3')}
                clearLabel={m.queue_clear_selection()}
                leadingContent={
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Select
                            value={view}
                            onValueChange={value => {
                                if (value !== 'queue' && value !== 'posts') return
                                setView(value)
                                void navigate({
                                    search: current => ({
                                        ...current,
                                        view: value === 'posts' ? 'posts' : undefined,
                                    }),
                                })
                            }}>
                            <SelectTrigger
                                aria-label={m.queue_view_label()}
                                className="w-fit"
                                size="sm">
                                <SelectValue>
                                    {view === 'posts' ? m.queue_view_posts() : m.queue_view_queue()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="start">
                                <SelectItem value="queue">{m.queue_view_queue()}</SelectItem>
                                <SelectItem value="posts">{m.queue_view_posts()}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={filter === 'manual' ? 'manual' : 'all'}
                            onValueChange={value => {
                                if (value === 'manual') changeFilter('manual')
                                else if (value === 'all') changeFilter('all')
                            }}>
                            <SelectTrigger
                                aria-label={m.queue_delivery_filter()}
                                className="w-fit min-w-32"
                                data-queue-delivery-filter="true"
                                size="sm">
                                <SelectValue>
                                    {filter === 'manual'
                                        ? m.queue_manual_delivery_mode()
                                        : m.queue_all_delivery_modes()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="start">
                                <SelectItem value="all">{m.queue_all_delivery_modes()}</SelectItem>
                                <SelectItem value="manual">
                                    {m.queue_manual_delivery_mode()}
                                </SelectItem>
                            </SelectContent>
                        </Select>

                        <Select
                            value={sort}
                            onValueChange={value => {
                                if (value === null || !isPublicationQueueSort(value)) return
                                setSort(value)
                                clearPublicationSelection()
                                void navigate({
                                    search: current => ({
                                        ...current,
                                        sort: value === 'queue' ? undefined : value,
                                    }),
                                })
                            }}>
                            <SelectTrigger
                                aria-label={m.queue_sort_label()}
                                className="w-fit min-w-36"
                                data-queue-sort="true"
                                size="sm">
                                <SelectValue>
                                    {queueSortOptions(filter).find(option => option.value === sort)
                                        ?.label ?? m.queue_sort_queue()}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="start">
                                {queueSortOptions(filter).map(option => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {projectTags.length > 0 ? (
                            <PublicationTagPicker
                                ariaLabel={m.taxonomy_filter_tags()}
                                emptyLabel={m.taxonomy_no_tags()}
                                label={m.taxonomy_filter_tags()}
                                onChange={nextTagIds => {
                                    setTagIds(nextTagIds)
                                    clearPublicationSelection()
                                    void navigate({
                                        search: current => ({
                                            ...current,
                                            tagIds: nextTagIds.length > 0 ? nextTagIds : undefined,
                                        }),
                                    })
                                }}
                                selectedTagIds={tagIds}
                                selectedLabel={count => m.taxonomy_selected_tags({ count })}
                                tags={projectTags}
                            />
                        ) : null}
                    </div>
                }
                onClear={clearPublicationSelection}
                selectedCount={selectedCount}
                selectionSummary={
                    selectedCount > 0
                        ? m.queue_selected_publications({ count: selectedCount })
                        : null
                }
                quietWhenEmpty
                showActions={selectedCount > 0}
                showClearSelection={!allVisibleSelected}
            />

            <section className="min-w-0" data-queue-publication-list="true">
                {queueQuery.isError && useServerQueue ? (
                    <QueryErrorState onRetry={() => void queueQuery.refetch()} />
                ) : (
                    <PublicationList
                        emptyAction={
                            filter === 'all' ? (
                                canEditProject ? (
                                    <Button
                                        nativeButton={false}
                                        render={
                                            <Link
                                                params={{ projectId: project.id }}
                                                search={{ date: undefined }}
                                                to="/dashboard/projects/$projectId/publications/new"
                                            />
                                        }
                                        size="sm"
                                        variant="default">
                                        <PenIcon aria-hidden="true" />
                                        {m.overview_new_publication()}
                                    </Button>
                                ) : null
                            ) : (
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
                        emptyDescription={queueEmptyDescription(filter)}
                        emptyIllustration={queueEmptyIllustration(filter)}
                        emptyLayout="compact"
                        emptyTitle={queueEmptyTitle(filter)}
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
        </main>
    )
}

function queueEmptyDescription(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_description()
    if (filter === 'draft') return null
    if (filter === 'scheduled') return m.queue_no_scheduled_description()
    if (filter === 'manual') return m.queue_no_manual_description()
    return m.queue_no_publications_description()
}

function queueEmptyTitle(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_title()
    if (filter === 'draft') return m.queue_no_drafts_title()
    if (filter === 'scheduled') return m.queue_no_scheduled_title()
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
    if (filter === 'draft') return [...updated, ...created]
    return [{ value: 'queue' as const, label: m.queue_sort_queue() }, ...updated, ...created]
}
