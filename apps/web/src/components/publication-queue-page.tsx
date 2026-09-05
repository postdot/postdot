import { Button } from '@herald/ui/components/button'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { AttentionPanel, PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
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

            <div
                aria-label="Queue summary"
                className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-muted px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
                <span>
                    <strong className="font-medium text-foreground">{publications.length}</strong>{' '}
                    total
                </span>
                <span>
                    <strong className="font-medium text-foreground">{manualCount}</strong> manual
                </span>
                <span>
                    <strong className="font-medium text-foreground">{automaticCount}</strong>{' '}
                    automatic
                </span>
                <span className={due.length > 0 ? 'text-state-attention' : undefined}>
                    <strong className="font-medium text-current">{due.length}</strong> due
                </span>
            </div>

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
