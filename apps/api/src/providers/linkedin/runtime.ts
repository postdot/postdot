import {
    LINKEDIN_OAUTH_AUTHORIZATION_ENDPOINT,
    LINKEDIN_OAUTH_ISSUER,
    LINKEDIN_OAUTH_TOKEN_ENDPOINT,
    createLinkedInOrganizationClient,
    createLinkedInMemberProfileClient,
    type LinkedInMemberProfileClient,
    type LinkedInOrganizationClient,
} from '@postdot/linkedin'
import { clientSecretPost, type OAuthAuthorizationServer } from '@postdot/oauth'

import type { ProviderRuntimeContext } from '../runtime-context'
export interface LinkedInRuntimeOptions {
    readonly linkedin?: {
        readonly clientId: string
        readonly clientSecret: string
        readonly authorizationServer?: OAuthAuthorizationServer
        readonly profileClient?: LinkedInMemberProfileClient
        readonly organizationClient?: LinkedInOrganizationClient
    }
}
const defaultLinkedInAuthorizationServer: OAuthAuthorizationServer = {
    issuer: LINKEDIN_OAUTH_ISSUER,
    authorizationEndpoint: LINKEDIN_OAUTH_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: LINKEDIN_OAUTH_TOKEN_ENDPOINT,
    // LinkedIn's standard web flow uses client-secret-post without PKCE. Its
    // PKCE flow is a separate native-client integration with different provider
    // requirements; state validation remains enabled for this server flow.
    pkce: 'disabled',
}
export function createLinkedInRuntime({
    options,
    providerApplicationStore,
}: ProviderRuntimeContext) {
    const callbackUri = new URL('/api/oauth/linkedin/callback', options.apiOrigin).toString()
    const linkedin =
        options.linkedin === undefined
            ? undefined
            : {
                  ...options.linkedin,
                  authorizationServer:
                      options.linkedin.authorizationServer ?? defaultLinkedInAuthorizationServer,
                  clientAuthentication: clientSecretPost(options.linkedin.clientSecret),
                  profileClient:
                      options.linkedin.profileClient ?? createLinkedInMemberProfileClient(),
                  organizationClient:
                      options.linkedin.organizationClient ?? createLinkedInOrganizationClient(),
              }
    async function resolveLinkedInApplication(applicationId?: string | null) {
        if (applicationId === null) {
            return linkedin === undefined ? undefined : { applicationId: null, ...linkedin }
        }
        const configured = await providerApplicationStore.resolveProviderApplication(
            'linkedin',
            applicationId
        )
        if (configured !== null) {
            if (configured.clientId === null || configured.clientSecret === null) return undefined
            return {
                applicationId: configured.id,
                clientId: configured.clientId,
                clientSecret: configured.clientSecret,
                authorizationServer:
                    options.linkedin?.authorizationServer ?? defaultLinkedInAuthorizationServer,
                clientAuthentication: clientSecretPost(configured.clientSecret),
                profileClient:
                    options.linkedin?.profileClient ?? createLinkedInMemberProfileClient(),
                organizationClient:
                    options.linkedin?.organizationClient ?? createLinkedInOrganizationClient(),
            }
        }
        if (applicationId !== undefined && applicationId !== null) {
            return undefined
        }
        if (providerApplicationStore.hasProviderApplication('linkedin')) return undefined
        if (linkedin === undefined) return undefined
        return { applicationId: null, ...linkedin }
    }

    return {
        linkedin,
        callbackUri,
        resolveLinkedInApplication,
        resolveLinkedInOAuth: async (applicationId?: string | null) => {
            const resolved = await resolveLinkedInApplication(applicationId)
            if (resolved === undefined) return undefined
            return {
                clientId: resolved.clientId,
                clientAuthentication: resolved.clientAuthentication,
                authorizationServer: resolved.authorizationServer,
            }
        },
    }
}
