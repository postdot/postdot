import { apiKey } from '@better-auth/api-key'
import { admin } from 'better-auth/plugins/admin'
import { organization, type OrganizationOptions } from 'better-auth/plugins/organization'

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

type BetterAuthInvitationEmailData = Parameters<
    NonNullable<OrganizationOptions['sendInvitationEmail']>
>[0]

export interface HeraldOrganizationInvitationEmail {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly organizationId: string
    readonly organizationName: string
    readonly inviterId: string
    readonly inviterEmail: string
    readonly inviterName: string
    readonly expiresAt: Date
    readonly invitationURL?: string
}

export interface HeraldAuthInvitationOptions {
    /** Optional deployment-provided mail transport. */
    readonly sendOrganizationInvitationEmail?: (
        input: HeraldOrganizationInvitationEmail
    ) => Promise<void> | void
    /** Builds the public invitation URL for the deployment's web application. */
    readonly organizationInvitationURL?: (input: {
        readonly id: string
        readonly organizationId: string
    }) => string
    /** Enables Better Auth's verified-email gate for invitation acceptance. */
    readonly requireEmailVerificationOnInvitation?: boolean
}

function createInvitationEmailOption(
    options: HeraldAuthInvitationOptions
): Pick<OrganizationOptions, 'sendInvitationEmail'> {
    if (options.sendOrganizationInvitationEmail === undefined) return {}

    return {
        sendInvitationEmail: async (data: BetterAuthInvitationEmailData) => {
            const invitationURL = options.organizationInvitationURL?.({
                id: data.id,
                organizationId: data.organization.id,
            })
            await options.sendOrganizationInvitationEmail?.({
                id: data.id,
                email: data.email,
                role: data.role,
                organizationId: data.organization.id,
                organizationName: data.organization.name,
                inviterId: data.inviter.userId,
                inviterEmail: data.inviter.user.email,
                inviterName: data.inviter.user.name,
                expiresAt: data.invitation.expiresAt,
                ...(invitationURL === undefined ? {} : { invitationURL }),
            })
        },
    }
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

export function createHeraldAuthPlugins(
    hooks: HeraldAuthPluginHooks = {},
    invitationOptions: HeraldAuthInvitationOptions = {}
): HeraldAuthPlugins {
    const requireEmailVerification = invitationOptions.requireEmailVerificationOnInvitation

    return [
        admin(),
        organization({
            ac: heraldOrganizationAccess,
            allowUserToCreateOrganization: false,
            cancelPendingInvitationsOnReInvite: true,
            creatorRole: 'owner',
            invitationExpiresIn: 7 * 24 * 60 * 60,
            ...(requireEmailVerification === undefined
                ? {}
                : { requireEmailVerificationOnInvitation: requireEmailVerification }),
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
            ...createInvitationEmailOption(invitationOptions),
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
