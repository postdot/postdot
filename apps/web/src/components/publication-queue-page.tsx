import { Button } from '@herald/ui/components/button'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { AttentionPanel, PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { useProjectDashboard } from '@/lib/dashboard-context'

export function PublicationQueuePage() {
    const { due, onPublish, pending, project, publications } = useProjectDashboard()
    const automaticCount = publications.filter(
        publication => publication.deliveryMode === 'automatic'
    ).length
    const manualCount = publications.length - automaticCount

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

            <div className="mt-7 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
                <section className="min-w-0">
                    <DashboardSectionHeading title="All publications" />
                    <PublicationList publications={publications} timeZone={project.timeZone} />
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
