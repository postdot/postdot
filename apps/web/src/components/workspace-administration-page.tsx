import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'

import { EmptyState } from '@/components/empty-state'
import { IdentityImageSection } from '@/components/identity-image-section'
import { ResourceLifecycleSection } from '@/components/resource-lifecycle-section'
import { SettingsPage } from '@/components/settings-layout'
import { WorkspaceGroupsSection } from '@/components/workspace-groups-section'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function WorkspaceAdministrationPage({ view }: { readonly view: 'people' | 'settings' }) {
    useLanguage()
    // The dashboard loader owns scope and permission checks. A second workspace
    // selection here can race navigation after archiving or deleting that scope.
    const { selectedWorkspaceId, workspaces } = useDashboardGlobal()
    const workspace = workspaces.find(
        candidate =>
            candidate.id === selectedWorkspaceId && ['owner', 'admin'].includes(candidate.role)
    )
    return (
        <>
            {workspace && view === 'people' ? (
                <WorkspaceGroupsSection key={workspace.id} workspaceId={workspace.id} />
            ) : (
                <>
                    <SettingsPage
                        title={
                            view === 'people'
                                ? m.access_workspace_title()
                                : m.nav_workspace_settings()
                        }>
                        {workspace ? (
                            <>
                                <IdentityImageSection
                                    key={`image-${workspace.id}`}
                                    target={{ kind: 'workspace', id: workspace.id }}
                                    resource={workspace}
                                />
                                <ResourceLifecycleSection
                                    key={workspace.id}
                                    kind="workspace"
                                    id={workspace.id}
                                />
                            </>
                        ) : (
                            <EmptyState
                                description={null}
                                icon={<UsersGroupTwoRoundedIcon aria-hidden="true" />}
                                layout="compact"
                                title={m.access_workspace_unavailable()}
                            />
                        )}
                    </SettingsPage>
                </>
            )}
        </>
    )
}
