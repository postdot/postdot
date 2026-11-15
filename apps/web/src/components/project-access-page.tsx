import { ProjectMembersSection } from '@/components/project-members-section'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'

export function ProjectAccessPage() {
    useLanguage()
    const { project } = useProjectDashboard()
    const global = useDashboardGlobal()

    return (
        <ProjectMembersSection
            currentUserId={global.session.user.id}
            projectId={project.id}
            projectName={project.name}
            workspaceId={project.workspaceId}
        />
    )
}
