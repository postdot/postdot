import { apiKey } from '@better-auth/api-key'
import { admin } from 'better-auth/plugins/admin'
import { organization, type OrganizationOptions } from 'better-auth/plugins/organization'

import { postbotOrganizationAccess, postbotOrganizationRoles } from './access-control'

export interface PostbotAuthPluginHooks {
    readonly afterOrganizationInvitationAccepted?: (input: {
        readonly invitationId: string
        readonly organizationId: string
        readonly userId: string
        readonly role: string
        readonly displayName: string
        readonly teamId?: string
        readonly projectId?: string
        readonly projectRole?: string
    }) => Promise<void> | void
    readonly afterOrganizationTeamMemberAdded?: (input: {
        readonly organizationId: string
        readonly teamId: string
        readonly userId: string
        readonly displayName: string
    }) => Promise<void> | void
}

type BetterAuthInvitationEmailData = Parameters<
    NonNullable<OrganizationOptions['sendInvitationEmail']>
>[0]

type PostbotInvitationFields = {
    readonly teamId?: string | null
    readonly projectId?: string | null
    readonly projectRole?: string | null
}

export interface PostbotOrganizationInvitationEmail {
    readonly id: string
    readonly email: string
    readonly role: string
    readonly organizationId: string
    readonly projectId?: string
    readonly projectRole?: string
    readonly organizationName: string
    readonly inviterId: string
    readonly inviterEmail: string
    readonly inviterName: string
    readonly expiresAt: Date
    readonly invitationURL?: string
}

export interface PostbotAuthInvitationOptions {
    /** Optional deployment-provided mail transport. */
    readonly sendOrganizationInvitationEmail?: (
        input: PostbotOrganizationInvitationEmail
    ) => Promise<void> | void
    /** Builds the public invitation URL for the deployment's web application. */
    readonly organizationInvitationURL?: (input: {
        readonly id: string
        readonly organizationId: string
        readonly projectId?: string
    }) => string
    /** Enables Better Auth's verified-email gate for invitation acceptance. */
    readonly requireEmailVerificationOnInvitation?: boolean
}

function createInvitationEmailOption(
    options: PostbotAuthInvitationOptions
): Pick<OrganizationOptions, 'sendInvitationEmail'> {
    if (options.sendOrganizationInvitationEmail === undefined) return {}

    return {
        sendInvitationEmail: async (data: BetterAuthInvitationEmailData) => {
            const invitation = data.invitation as typeof data.invitation & PostbotInvitationFields
            const invitationURL = options.organizationInvitationURL?.({
                id: data.id,
                organizationId: data.organization.id,
                ...(typeof invitation.projectId !== 'string'
                    ? {}
                    : { projectId: invitation.projectId }),
            })
            await options.sendOrganizationInvitationEmail?.({
                id: data.id,
                email: data.email,
                role: data.role,
                organizationId: data.organization.id,
                ...(typeof invitation.projectId !== 'string'
                    ? {}
                    : { projectId: invitation.projectId }),
                ...(typeof invitation.projectRole !== 'string'
                    ? {}
                    : { projectRole: invitation.projectRole }),
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

function readPostbotApiKey(request: Request | undefined): string | null {
    if (request === undefined) return null

    const authorization = request.headers.get('authorization')
    if (authorization !== null) {
        const match = /^Bearer\s+(\S+)$/i.exec(authorization)
        return match?.[1] ?? null
    }

    return request.headers.get('x-api-key')
}

/** Default configuration used by Postdot's user-owned API keys. */
export const postbotUserApiKeyConfigId = 'default'

/** Shared plugin configuration for the runtime auth instance and CLI schema generation. */
export type PostbotAuthPlugins = [
    ReturnType<typeof admin>,
    ReturnType<typeof organization>,
    ReturnType<typeof apiKey>,
]

export function createPostbotAuthPlugins(
    hooks: PostbotAuthPluginHooks = {},
    invitationOptions: PostbotAuthInvitationOptions = {}
): PostbotAuthPlugins {
    const requireEmailVerification = invitationOptions.requireEmailVerificationOnInvitation

    return [
        admin(),
        organization({
            ac: postbotOrganizationAccess,
            allowUserToCreateOrganization: false,
            cancelPendingInvitationsOnReInvite: true,
            creatorRole: 'owner',
            invitationExpiresIn: 7 * 24 * 60 * 60,
            schema: {
                invitation: {
                    additionalFields: {
                        projectId: {
                            type: 'string',
                            input: true,
                            required: false,
                        },
                        projectRole: {
                            type: 'string',
                            input: true,
                            required: false,
                        },
                    },
                },
            },
            // Workspace groups are provisioned by Postdot. Organizations that
            // exist only in legacy development data must not silently get a
            // new default group.
            teams: { enabled: true, defaultTeam: { enabled: false } },
            ...(requireEmailVerification === undefined
                ? {}
                : { requireEmailVerificationOnInvitation: requireEmailVerification }),
            organizationHooks: {
                afterAcceptInvitation: async ({ invitation, user, organization }) => {
                    const projectInvitation = invitation as typeof invitation &
                        PostbotInvitationFields
                    await hooks.afterOrganizationInvitationAccepted?.({
                        invitationId: invitation.id,
                        organizationId: organization.id,
                        userId: user.id,
                        role: invitation.role,
                        displayName: user.name,
                        ...(typeof projectInvitation.teamId !== 'string'
                            ? {}
                            : { teamId: projectInvitation.teamId }),
                        ...(typeof projectInvitation.projectId !== 'string'
                            ? {}
                            : { projectId: projectInvitation.projectId }),
                        ...(typeof projectInvitation.projectRole !== 'string'
                            ? {}
                            : { projectRole: projectInvitation.projectRole }),
                    })
                },
                afterAddTeamMember: async ({ teamMember, team, user, organization }) => {
                    await hooks.afterOrganizationTeamMemberAdded?.({
                        organizationId: organization.id,
                        teamId: team.id,
                        userId: teamMember.userId,
                        displayName: user.name,
                    })
                },
            },
            ...createInvitationEmailOption(invitationOptions),
            roles: postbotOrganizationRoles,
        }),
        apiKey([
            {
                apiKeyHeaders: ['x-api-key', 'authorization'],
                configId: postbotUserApiKeyConfigId,
                customAPIKeyGetter: ({ request }) => readPostbotApiKey(request),
                defaultPrefix: 'postbot_pat_',
                enableMetadata: true,
                keyExpiration: {
                    defaultExpiresIn: 180 * 24 * 60 * 60,
                    maxExpiresIn: 10 * 365,
                    minExpiresIn: 1,
                },
                rateLimit: { enabled: false },
                references: 'user',
                requireName: true,
            },
        ]),
    ] as unknown as PostbotAuthPlugins
}
