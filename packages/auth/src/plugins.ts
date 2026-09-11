import { apiKey } from '@better-auth/api-key'
import { admin } from 'better-auth/plugins/admin'
import { organization } from 'better-auth/plugins/organization'

import { heraldOrganizationAccess, heraldOrganizationRoles } from './access-control'

export interface HeraldAuthPluginHooks {
    readonly afterOrganizationMemberAdded?: (input: {
        readonly organizationId: string
        readonly userId: string
        readonly role: string
        readonly displayName: string
    }) => Promise<void> | void
    readonly afterOrganizationMemberRemoved?: (input: {
        readonly organizationId: string
        readonly userId: string
    }) => Promise<void> | void
    readonly afterOrganizationMemberRoleUpdated?: (input: {
        readonly organizationId: string
        readonly userId: string
        readonly role: string
        readonly displayName: string
    }) => Promise<void> | void
    readonly afterOrganizationInvitationAccepted?: (input: {
        readonly organizationId: string
        readonly userId: string
        readonly role: string
        readonly displayName: string
    }) => Promise<void> | void
}

function readHeraldApiKey(request: Request | undefined): string | null {
    if (request === undefined) return null

    const authorization = request.headers.get('authorization')
    if (authorization !== null) {
        const match = /^Bearer\s+(\S+)$/i.exec(authorization)
        return match?.[1] ?? null
    }

    return request.headers.get('x-api-key')
}

/** Shared plugin configuration for the runtime auth instance and CLI schema generation. */
export type HeraldAuthPlugins = [
    ReturnType<typeof admin>,
    ReturnType<typeof organization>,
    ReturnType<typeof apiKey>,
]

export function createHeraldAuthPlugins(hooks: HeraldAuthPluginHooks = {}): HeraldAuthPlugins {
    return [
        admin(),
        organization({
            ac: heraldOrganizationAccess,
            allowUserToCreateOrganization: false,
            creatorRole: 'owner',
            invitationExpiresIn: 7 * 24 * 60 * 60,
            organizationHooks: {
                afterAddMember: async ({ member, user, organization }) => {
                    await hooks.afterOrganizationMemberAdded?.({
                        organizationId: organization.id,
                        userId: member.userId,
                        role: member.role,
                        displayName: user.name,
                    })
                },
                afterRemoveMember: async ({ member, organization }) => {
                    await hooks.afterOrganizationMemberRemoved?.({
                        organizationId: organization.id,
                        userId: member.userId,
                    })
                },
                afterUpdateMemberRole: async ({ member, user, organization }) => {
                    await hooks.afterOrganizationMemberRoleUpdated?.({
                        organizationId: organization.id,
                        userId: member.userId,
                        role: member.role,
                        displayName: user.name,
                    })
                },
                afterAcceptInvitation: async ({ invitation, user, organization }) => {
                    await hooks.afterOrganizationInvitationAccepted?.({
                        organizationId: organization.id,
                        userId: user.id,
                        role: invitation.role,
                        displayName: user.name,
                    })
                },
            },
            roles: heraldOrganizationRoles,
        }),
        apiKey({
            apiKeyHeaders: ['x-api-key', 'authorization'],
            customAPIKeyGetter: ({ request }) => readHeraldApiKey(request),
            defaultPrefix: 'herald_pat_',
            enableMetadata: true,
            keyExpiration: {
                // The API endpoint accepts seconds; the plugin's min/max
                // bounds are expressed in days.
                defaultExpiresIn: 180 * 24 * 60 * 60,
                maxExpiresIn: 10 * 365,
                minExpiresIn: 1,
            },
            rateLimit: { enabled: false },
            references: 'organization',
            requireName: true,
        }),
    ]
}
