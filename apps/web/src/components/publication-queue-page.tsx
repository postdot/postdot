import { Button } from '@herald/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@herald/ui/components/tabs'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { AttentionPanel, PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { filterQueuePublications, isQueueFilter, type QueueFilter } from '@/lib/publication-queue'

export function PublicationQueuePage() {
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
                        New publication
                    </Button>
                }
                title="Queue">
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            <PublicationSummaryBar
                ariaLabel="Queue summary"
                items={[
                    { id: 'total', label: 'total', value: publications.length },
                    { id: 'manual', label: 'manual', value: manualCount },
                    { id: 'automatic', label: 'automatic', value: automaticCount },
                    { attention: due.length > 0, id: 'due', label: 'due', value: due.length },
                ]}
            />

            <Tabs
                aria-label="Queue filters"
                className="mt-6"
                value={filter}
                onValueChange={value => {
                    if (isQueueFilter(value)) setFilter(value)
                }}>
                <TabsList className="max-w-full overflow-x-auto" variant="line">
                    <TabsTrigger aria-label={`All (${publications.length})`} value="all">
                        All ({publications.length})
                    </TabsTrigger>
                    <TabsTrigger aria-label={`Needs attention (${due.length})`} value="attention">
                        <span className="sm:hidden">Attention</span>
                        <span className="hidden sm:inline">Needs attention</span> ({due.length})
                    </TabsTrigger>
                    <TabsTrigger aria-label={`Scheduled (${scheduledCount})`} value="scheduled">
                        Scheduled ({scheduledCount})
                    </TabsTrigger>
                    <TabsTrigger aria-label={`Manual (${manualCount})`} value="manual">
                        Manual ({manualCount})
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="mt-7 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
                <section className="min-w-0">
                    <DashboardSectionHeading
                        meta={`${visiblePublications.length} publication${visiblePublications.length === 1 ? '' : 's'}`}
                        title="Publications"
                    />
                    <PublicationList
                        emptyDescription={queueEmptyDescription(filter)}
                        publications={visiblePublications}
                        timeZone={project.timeZone}
                    />
                </section>
                <AttentionPanel
                    duePublications={due}
                    onPublish={onPublish}
                    pending={pending}
                    timeZone={project.timeZone}
                />
            </div>
        </main>
    )
}

function queueEmptyDescription(filter: QueueFilter) {
    if (filter === 'attention') return 'No manual publication needs a decision right now.'
    if (filter === 'scheduled') return 'No publications have a scheduled delivery time yet.'
    if (filter === 'manual') return 'No publications are waiting for manual delivery.'
    return 'Compose a source post to start the queue.'
}
