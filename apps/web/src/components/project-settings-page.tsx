import { AccessPageHeader } from '@/components/access-page-header'
import { IdentityImageSection } from '@/components/identity-image-section'
import { PageColumn } from '@/components/page-column'
import { ProjectTimeZoneSection } from '@/components/project-time-zone-section'
import { ResourceLifecycleSection } from '@/components/resource-lifecycle-section'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

/** Settings that act on the project itself; archive and deletion close the page (ADR-103 §4). */
export function ProjectSettingsPage() {
    useLanguage()
    const { project, projectRole, access } = useProjectDashboard()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <AccessPageHeader column="reading" title={m.nav_project_configuration()} />
            <PageColumn variant="reading">
                <IdentityImageSection
                    key={project.id}
                    target={{ kind: 'project', id: project.id }}
                    resource={project}
                    disabled={!['owner', 'editor'].includes(projectRole) || !access.canWrite()}
                    onRefusal={access.reportRefusal}
                />
                <ProjectTimeZoneSection />
                <ResourceLifecycleSection kind="project" id={project.id} />
            </PageColumn>
        </main>
    )
}
