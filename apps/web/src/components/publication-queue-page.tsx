import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { Tabs, TabsList, TabsTrigger } from '@herald/ui/components/tabs'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationList } from '@/components/dashboard-publication-parts'
import { PublicationBulkCancellationDialog } from '@/components/publication-bulk-cancellation-dialog'
import { PublicationBulkScheduleDialog } from '@/components/publication-bulk-schedule-dialog'
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
                                count: totalCount,
                            })}
                            value="all">
                            {m.queue_all()}
                            <Badge
                                className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                variant="secondary">
                                {formatNumber(totalCount, locale)}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger
                            aria-label={m.queue_filter_aria({
                                label: m.queue_attention(),
                                count: filterCounts.attention,
                            })}
                            value="attention">
                            {m.queue_attention()}
                            <Badge
                                className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                variant="secondary">
                                {formatNumber(filterCounts.attention, locale)}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger
                            aria-label={m.queue_filter_aria({
                                label: m.queue_scheduled(),
                                count: filterCounts.scheduled,
                            })}
                            value="scheduled">
                            {m.queue_scheduled()}
                            <Badge
                                className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                variant="secondary">
                                {formatNumber(filterCounts.scheduled, locale)}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger
                            aria-label={m.queue_filter_aria({
                                label: m.queue_drafts(),
                                count: filterCounts.draft,
                            })}
                            value="draft">
                            {m.queue_drafts()}
                            <Badge
                                className="min-w-5 rounded-md px-1.5 py-0 text-[0.7rem]"
                                variant="secondary">
                                {formatNumber(filterCounts.draft, locale)}
                            </Badge>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                        <SelectItem value="manual">{m.queue_manual_delivery_mode()}</SelectItem>
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

            <section className="mt-6 min-w-0" data-queue-publication-list="true">
                {selectedCount > 0 ? (
                    <div className="mt-3">
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
                                variant="default">
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
                    onToggleSelection={publication => togglePublicationSelection(publication.id)}
                    duePublicationIds={duePublicationIds}
                    onPublish={onPublish}
                    pending={pending}
                    publications={visiblePublications}
                    allSelected={allVisibleSelected}
                    onToggleAll={toggleAllVisiblePublications}
                    selectedPublicationIds={selectedPublicationIds}
                    timeZone={project.timeZone}
                />
                {publicationsNextCursor !== null ? (
                    <div className="mt-5 flex justify-center">
                        <Button
                            disabled={loadingMorePublications}
                            onClick={() => void onLoadMorePublications()}
                            variant="secondary">
                            {loadingMorePublications ? m.common_loading() : m.queue_load_more()}
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
