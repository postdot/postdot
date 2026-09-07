import { Button } from '@herald/ui/components/button'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationList } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublicationAttentionPanel } from '@/components/publication-attention-panel'
import { PublicationSummaryBar } from '@/components/publication-summary-bar'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function DashboardOverview() {
    useLanguage()
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
                                params={{ projectId: project.id }}
                                search={{ date: undefined }}
                                to="/dashboard/projects/$projectId/compose"
                            />
                        }>
                        <PenIcon aria-hidden="true" />
                        {m.overview_new_publication()}
                    </Button>
                }
                title={m.overview_title()}>
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            <PublicationSummaryBar
                ariaLabel={m.overview_summary_aria()}
                items={[
                    {
                        id: 'publications',
                        label: m.overview_publications(),
                        value: publications.length,
                    },
                    { id: 'scheduled', label: m.overview_scheduled(), value: scheduledCount },
                    { id: 'automatic', label: m.overview_automatic(), value: automaticCount },
                    {
                        attention: due.length > 0,
                        id: 'attention',
                        label: m.overview_needs_attention(),
                        value: due.length,
                    },
                ]}
            />

            <div
                className={
                    due.length > 0
                        ? 'mt-7 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start'
                        : 'mt-7 min-w-0'
                }>
                <section className="min-w-0">
                    <DashboardSectionHeading
                        meta={
                            publications.length > recentPublications.length ? (
                                <Link
                                    to="/dashboard/projects/$projectId/queue"
                                    params={{ projectId: project.id }}
                                    className="text-primary hover:text-foreground">
                                    {m.overview_view_all()}
                                </Link>
                            ) : (
                                m.common_publication_count({ count: publications.length })
                            )
                        }
                        title={m.overview_recent_publications()}
                    />
                    <PublicationList
                        emptyDescription={m.overview_recent_empty_description()}
                        publications={recentPublications}
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
