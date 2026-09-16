import { Button } from '@herald/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@herald/ui/components/tabs'
import { cn } from '@herald/ui/lib/utils'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublicationAttentionPanel } from '@/components/publication-attention-panel'
import { PublicationBulkCancellationDialog } from '@/components/publication-bulk-cancellation-dialog'
import { PublicationBulkScheduleDialog } from '@/components/publication-bulk-schedule-dialog'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import {
    filterQueueByTags,
    filterQueuePublications,
    isQueueFilter,
    type QueueFilter,
} from '@/lib/publication-queue'
import * as m from '@/paraglide/messages.js'

export function PublicationQueuePage({
    initialFilter = 'all',
    initialTagIds = [],
}: {
    readonly initialFilter?: QueueFilter
    readonly initialTagIds?: readonly string[]
}) {
    const { locale } = useLanguage()
    const {
        due,
        loadingMorePublications,
        onLoadMorePublications,
        onCancelPublications,
        onPublish,
        onReschedulePublications,
        pending,
        project,
        projectTags,
        publications,
        publicationsNextCursor,
        publicationSummary,
    } = useProjectDashboard()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/queue' })
    const [filter, setFilter] = useState<QueueFilter>(initialFilter)
    const [tagIds, setTagIds] = useState<string[]>(() => [...initialTagIds])
    const [selectedPublicationIds, setSelectedPublicationIds] = useState<Set<string>>(
        () => new Set()
    )
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
    useEffect(() => {
        setFilter(initialFilter)
        setSelectedPublicationIds(new Set())
    }, [initialFilter])
    const initialTagIdsKey = initialTagIds.join('\u0000')
    useEffect(() => {
        setTagIds(initialTagIdsKey === '' ? [] : initialTagIdsKey.split('\u0000'))
        setSelectedPublicationIds(new Set())
    }, [initialTagIdsKey])
    const duePublicationIds = new Set(due.map(publication => publication.id))
    const taggedPublications = filterQueueByTags(publications, tagIds)
    const { automatic: automaticCount, manual: manualCount } = publicationSummary
    const totalCount = publicationSummary.total
    const filterCounts: Record<QueueFilter, number> = {
        all: tagIds.length === 0 ? totalCount : taggedPublications.length,
        attention: filterQueuePublications(taggedPublications, duePublicationIds, 'attention')
            .length,
        draft: filterQueuePublications(taggedPublications, duePublicationIds, 'draft').length,
        scheduled: filterQueuePublications(taggedPublications, duePublicationIds, 'scheduled')
            .length,
        manual: filterQueuePublications(taggedPublications, duePublicationIds, 'manual').length,
    }
    const visiblePublications = filterQueuePublications(
        taggedPublications,
        duePublicationIds,
        filter
    )
    const filteredCount = filterCounts[filter]
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

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
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
                }
                title={m.queue_title()}>
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            <PublicationSummaryBar
                ariaLabel={m.queue_summary()}
                items={[
                    { id: 'total', label: m.queue_publications(), value: totalCount },
                    { id: 'manual', label: m.queue_manual(), value: manualCount },
                    { id: 'automatic', label: m.overview_automatic(), value: automaticCount },
                    {
                        attention: filterCounts.attention > 0,
                        id: 'attention',
                        label: m.queue_attention(),
                        value: filterCounts.attention,
                    },
                ]}
            />

            <Tabs
                aria-label={m.queue_filters()}
                className="mt-6"
                value={filter}
                onValueChange={value => {
                    if (!isQueueFilter(value)) return
                    setFilter(value)
                    clearPublicationSelection()
                    void navigate({
                        search: current => ({
                            ...current,
                            filter: value === 'all' ? undefined : value,
                        }),
                    })
                }}>
                <TabsList
                    className="!h-auto min-h-8 w-full max-w-full justify-start overflow-x-auto [&>[data-slot=tabs-trigger]]:shrink-0"
                    variant="line">
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_all(),
                            count: totalCount,
                        })}
                        value="all">
                        {m.queue_all()} ({formatNumber(totalCount, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_attention(),
                            count: filterCounts.attention,
                        })}
                        value="attention">
                        <span className="sm:hidden">{m.queue_attention()}</span>
                        <span className="hidden sm:inline">{m.queue_attention()}</span> (
                        {formatNumber(filterCounts.attention, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_drafts(),
                            count: filterCounts.draft,
                        })}
                        value="draft">
                        {m.queue_drafts()} ({formatNumber(filterCounts.draft, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_scheduled(),
                            count: filterCounts.scheduled,
                        })}
                        value="scheduled">
                        {m.queue_scheduled()} ({formatNumber(filterCounts.scheduled, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_manual(),
                            count: filterCounts.manual,
                        })}
                        value="manual">
                        {m.queue_manual()} ({formatNumber(filterCounts.manual, locale)})
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {projectTags.length > 0 ? (
                <div className="mt-3 flex items-center">
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
                </div>
            ) : null}

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
                        ariaLabel={m.queue_bulk_actions()}
                        clearLabel={m.queue_clear_selection()}
                        onClear={clearPublicationSelection}
                        onToggleAll={toggleAllVisiblePublications}
                        selectedCount={selectedCount}
                        selectionSummary={m.queue_selected_publications({ count: selectedCount })}
                        toggleAllLabel={m.queue_select_all_visible()}
                    />
                </div>
            ) : null}

            <div
                className={cn(
                    'mt-7 grid min-w-0 gap-7',
                    due.length > 0 && 'xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start'
                )}>
                <section
                    className={due.length > 0 ? 'order-last min-w-0 xl:order-first' : 'min-w-0'}>
                    <DashboardSectionHeading
                        meta={
                            tagIds.length === 0
                                ? m.common_publication_count({ count: filteredCount })
                                : undefined
                        }
                        title={m.queue_publications()}
                    />
                    <PublicationList
                        emptyAction={
                            filter === 'all' ? (
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
                                    variant="outline">
                                    <PenIcon aria-hidden="true" />
                                    {m.overview_new_publication()}
                                </Button>
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
                        emptyTitle={queueEmptyTitle(filter)}
                        onToggleSelection={publication =>
                            togglePublicationSelection(publication.id)
                        }
                        publications={visiblePublications}
                        selectedPublicationIds={selectedPublicationIds}
                        timeZone={project.timeZone}
                    />
                    {publicationsNextCursor !== null ? (
                        <div className="mt-5 flex justify-center">
                            <Button
                                disabled={loadingMorePublications}
                                onClick={() => void onLoadMorePublications()}
                                variant="outline">
                                {loadingMorePublications ? m.common_loading() : m.queue_load_more()}
                            </Button>
                        </div>
                    ) : null}
                </section>
                {due.length > 0 ? (
                    <div className="order-first min-w-0 xl:order-last">
                        <PublicationAttentionPanel
                            duePublications={due}
                            onPublish={onPublish}
                            pending={pending}
                            timeZone={project.timeZone}
                        />
                    </div>
                ) : null}
            </div>

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

function queueEmptyDescription(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_description()
    if (filter === 'draft') return m.queue_no_drafts_description()
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
