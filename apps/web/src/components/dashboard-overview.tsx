import { Button } from '@herald/ui/components/button'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { AttentionPanel, PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { useProjectDashboard } from '@/lib/dashboard-context'

export function DashboardOverview() {
    const { due, onPublish, pending, project, publications } = useProjectDashboard()
    const scheduledCount = publications.filter(
        publication => publication.scheduledAt !== null
    ).length
    const automaticCount = publications.filter(
        publication => publication.deliveryMode === 'automatic'
    ).length
    const recentPublications = publications.slice(0, 6)

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                to="/dashboard/projects/$projectId/compose"
                                params={{ projectId: project.id }}
                            />
                        }>
                        <PenIcon aria-hidden="true" />
                        New publication
                    </Button>
                }
                title="Overview">
                <p className="mt-2 text-sm text-muted-foreground">{project.name}</p>
            </DashboardPageHeader>

            <div
                aria-label="Workspace summary"
                className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-muted px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
                <span>
                    <strong className="font-medium text-foreground">{publications.length}</strong>{' '}
                    publication{publications.length === 1 ? '' : 's'}
                </span>
                <span>
                    <strong className="font-medium text-foreground">{scheduledCount}</strong>{' '}
                    scheduled
                </span>
                <span>
                    <strong className="font-medium text-foreground">{automaticCount}</strong>{' '}
                    automatic
                </span>
                <span className={due.length > 0 ? 'text-state-attention' : undefined}>
                    <strong className="font-medium text-current">{due.length}</strong> needs
                    attention
                </span>
            </div>

            <div className="mt-7 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
                <section className="min-w-0">
                    <DashboardSectionHeading
                        meta={
                            publications.length > recentPublications.length ? (
                                <Link
                                    to="/dashboard/projects/$projectId/queue"
                                    params={{ projectId: project.id }}
                                    className="text-primary hover:text-foreground">
                                    View all
                                </Link>
                            ) : (
                                `${publications.length} publication${publications.length === 1 ? '' : 's'}`
                            )
                        }
                        title="Recent publications"
                    />
                    <PublicationList
                        emptyDescription="Start with one source post, then route it to the channels that need it."
                        publications={recentPublications}
                    />
                </section>

                <AttentionPanel duePublications={due} onPublish={onPublish} pending={pending} />
            </div>
        </main>
    )
}
