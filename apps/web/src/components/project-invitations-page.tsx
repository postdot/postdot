import { AccessPageHeader } from '@/components/access-page-header'
import { ProjectMembersSection } from '@/components/project-members-section'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ProjectInvitationsPage() {
    useLanguage()
    const { project } = useProjectDashboard()
    const global = useDashboardGlobal()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="w-full">
                <AccessPageHeader
                    projectId={project.id}
                    title={m.access_project_invitations_title()}
                />

                <div>
                    <ProjectMembersSection
                        currentUserId={global.session.user.id}
                        projectId={project.id}
                        projectName={project.name}
                        view="invitations"
                        workspaceId={project.workspaceId}
                    />
                </div>
            </div>
        </main>
    )
}
