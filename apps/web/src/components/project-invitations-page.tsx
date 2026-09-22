import { UserPlusRoundedIcon } from '@solar-icons/react/linear/user-plus-rounded'

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
                <div className="flex items-start gap-3">
                    <UserPlusRoundedIcon
                        className="mt-1 size-5 shrink-0 text-primary"
                        aria-hidden="true"
                    />
                    <div className="min-w-0">
                        <h1 className="font-heading text-3xl font-semibold leading-[1.02] sm:text-4xl">
                            {m.access_project_invitations_title()}
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                            {m.access_project_invitations_description()}
                        </p>
                    </div>
                </div>

                <div className="mt-8">
                    <ProjectMembersSection
                        currentUserId={global.session.user.id}
                        projectId={project.id}
                        view="invitations"
                        workspaceId={project.workspaceId}
                    />
                </div>
            </div>
        </main>
    )
}
