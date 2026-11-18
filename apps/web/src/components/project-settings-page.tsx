import { IdentityImageSection } from '@/components/identity-image-section'
import { ProjectTimeZoneSection } from '@/components/project-time-zone-section'
import { ResourceLifecycleSection } from '@/components/resource-lifecycle-section'
import { SettingsPage } from '@/components/settings-layout'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

/** Settings that act on the project itself; archive and deletion close the page (ADR-103 §4). */
export function ProjectSettingsPage() {
    useLanguage()
    const { project, projectRole, access } = useProjectDashboard()

    return (
        <SettingsPage title={m.nav_project_configuration()}>
            <IdentityImageSection
                key={project.id}
                target={{ kind: 'project', id: project.id }}
                resource={project}
                disabled={!['owner', 'editor'].includes(projectRole) || !access.canWrite()}
                onRefusal={access.reportRefusal}
            />
            <ProjectTimeZoneSection />
            <ResourceLifecycleSection kind="project" id={project.id} />
        </SettingsPage>
    )
}
