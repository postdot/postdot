import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'

import { InstanceAccessSettingsPage } from '@/components/instance-access-settings-page'

export const Route = createFileRoute('/dashboard/settings/access')({
    validateSearch: (search: Record<string, unknown>) => ({
        invitation:
            typeof search.invitation === 'string' && search.invitation.length > 0
                ? search.invitation
                : undefined,
        projectId:
            typeof search.projectId === 'string' && search.projectId.length > 0
                ? search.projectId
                : undefined,
        workspaceId:
            typeof search.workspaceId === 'string' && search.workspaceId.length > 0
                ? search.workspaceId
                : undefined,
        organizationInvitation:
            typeof search.organizationInvitation === 'string' &&
            search.organizationInvitation.length > 0
                ? search.organizationInvitation
                : undefined,
    }),
    component: InstanceAccessRoute,
})

function InstanceAccessRoute() {
    const navigate = useNavigate()
    const router = useRouter()
    const search = Route.useSearch()

    return (
        <InstanceAccessSettingsPage
            organizationInvitationId={search.organizationInvitation}
            organizationInvitationProjectId={search.projectId}
            invitationToken={search.invitation}
            onInvitationHandled={async () => {
                if (search.organizationInvitation !== undefined && search.projectId !== undefined) {
                    // The dashboard loader may have been resolved before the
                    // invitation was accepted. Refresh it before entering the
                    // newly accessible project so the SPA does not retain an
                    // empty project list.
                    await router.invalidate()
                    await navigate({
                        to: '/dashboard/projects/$projectId/overview',
                        params: { projectId: search.projectId },
                        replace: true,
                    })
                    return
                }

                if (search.organizationInvitation !== undefined) {
                    // A workspace invitation can unlock several projects at
                    // once through its group. Refresh the dashboard loader
                    // before returning to settings so the project switcher
                    // does not retain the pre-acceptance snapshot.
                    await router.invalidate()
                }

                await navigate({
                    to: '/dashboard/settings/access',
                    search: previous => ({
                        invitation: undefined,
                        organizationInvitation: undefined,
                        projectId: previous.projectId,
                        workspaceId: previous.workspaceId,
                    }),
                    replace: true,
                })
            }}
        />
    )
}
