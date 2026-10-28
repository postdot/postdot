import { AccessPageHeader } from '@/components/access-page-header'
import { PageColumn } from '@/components/page-column'
import { ProjectMembersSection } from '@/components/project-members-section'
import { ResourceLifecycleSection } from '@/components/resource-lifecycle-section'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ProjectAccessPage() {
    useLanguage()
    const { project } = useProjectDashboard()
    const global = useDashboardGlobal()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="w-full">
                <AccessPageHeader projectId={project.id} title={m.access_title()} />

                <PageColumn variant="management">
                    <ProjectMembersSection
                        currentUserId={global.session.user.id}
                        projectId={project.id}
                        projectName={project.name}
                        view="access"
                        workspaceId={project.workspaceId}
                    />
                    <ResourceLifecycleSection kind="project" id={project.id} />
                </PageColumn>
            </div>
        </main>
    )
}
