import { Button } from '@herald/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@herald/ui/components/tabs'
import { cn } from '@herald/ui/lib/utils'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublicationAttentionPanel } from '@/components/publication-attention-panel'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { filterQueuePublications, isQueueFilter, type QueueFilter } from '@/lib/publication-queue'
import * as m from '@/paraglide/messages.js'

export function PublicationQueuePage() {
    const { locale } = useLanguage()
    const { due, onPublish, pending, project, publications } = useProjectDashboard()
    const [filter, setFilter] = useState<QueueFilter>('all')
    const duePublicationIds = new Set(due.map(publication => publication.id))
    const visiblePublications = filterQueuePublications(publications, duePublicationIds, filter)
    const automaticCount = publications.filter(
        publication => publication.deliveryMode === 'automatic'
    ).length
    const manualCount = publications.length - automaticCount
    const scheduledCount = publications.filter(
        publication => publication.scheduledAt !== null
    ).length

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
                                to="/dashboard/projects/$projectId/compose"
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
                    { id: 'total', label: m.queue_publications(), value: publications.length },
                    { id: 'manual', label: m.queue_manual(), value: manualCount },
                    { id: 'automatic', label: m.overview_automatic(), value: automaticCount },
                    {
                        attention: due.length > 0,
                        id: 'due',
                        label: m.queue_attention(),
                        value: due.length,
                    },
                ]}
            />

            <Tabs
                aria-label={m.queue_filters()}
                className="mt-6"
                value={filter}
                onValueChange={value => {
                    if (isQueueFilter(value)) setFilter(value)
                }}>
                <TabsList
                    className="w-full max-w-full justify-start overflow-x-auto [&>[data-slot=tabs-trigger]]:shrink-0"
                    variant="line">
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_all(),
                            count: publications.length,
                        })}
                        value="all">
                        {m.queue_all()} ({formatNumber(publications.length, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_attention(),
                            count: due.length,
                        })}
                        value="attention">
                        <span className="sm:hidden">{m.queue_attention()}</span>
                        <span className="hidden sm:inline">{m.queue_attention()}</span> (
                        {formatNumber(due.length, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_scheduled(),
                            count: scheduledCount,
                        })}
                        value="scheduled">
                        {m.queue_scheduled()} ({formatNumber(scheduledCount, locale)})
                    </TabsTrigger>
                    <TabsTrigger
                        aria-label={m.queue_filter_aria({
                            label: m.queue_manual(),
                            count: manualCount,
                        })}
                        value="manual">
                        {m.queue_manual()} ({formatNumber(manualCount, locale)})
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <div
                className={cn(
                    'mt-7 grid min-w-0 gap-7',
                    due.length > 0 && 'xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start'
                )}>
                <section className="min-w-0">
                    <DashboardSectionHeading
                        meta={m.common_publication_count({ count: visiblePublications.length })}
                        title={m.queue_publications()}
                    />
                    <PublicationList
                        emptyDescription={queueEmptyDescription(filter)}
                        emptyTitle={queueEmptyTitle(filter)}
                        publications={visiblePublications}
                        timeZone={project.timeZone}
                    />
                </section>
                {due.length > 0 ? (
                    <PublicationAttentionPanel
                        duePublications={due}
                        onPublish={onPublish}
                        pending={pending}
                        timeZone={project.timeZone}
                    />
                ) : null}
            </div>
        </main>
    )
}

function queueEmptyDescription(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_description()
    if (filter === 'scheduled') return m.queue_no_scheduled_description()
    if (filter === 'manual') return m.queue_no_manual_description()
    return m.queue_no_publications_description()
}

function queueEmptyTitle(filter: QueueFilter) {
    if (filter === 'attention') return m.queue_no_attention_title()
    if (filter === 'scheduled') return m.queue_no_scheduled_title()
    if (filter === 'manual') return m.queue_no_manual_title()
    return m.queue_no_publications()
}
