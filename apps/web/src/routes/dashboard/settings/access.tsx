import { createFileRoute, useNavigate } from '@tanstack/react-router'

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
    }),
    component: InstanceAccessRoute,
})

function InstanceAccessRoute() {
    const navigate = useNavigate()
    const search = Route.useSearch()

    return (
        <InstanceAccessSettingsPage
            invitationToken={search.invitation}
            onInvitationHandled={() =>
                navigate({
                    to: '/dashboard/settings/access',
                    search: previous => ({
                        invitation: undefined,
                        projectId: previous.projectId,
                    }),
                    replace: true,
                })
            }
        />
    )
}
