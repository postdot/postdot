import { createBlueskyClientMetadata } from '@herald/bluesky'
import {
    createAuthorizationAttemptStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    createProviderApplicationStore,
    createSecretCipher,
    type HeraldDatabase,
} from '@herald/db'
import {
    LINKEDIN_OAUTH_AUTHORIZATION_ENDPOINT,
    LINKEDIN_OAUTH_ISSUER,
    LINKEDIN_OAUTH_TOKEN_ENDPOINT,
    createLinkedInOrganizationClient,
    createLinkedInMemberProfileClient,
    type LinkedInMemberProfileClient,
    type LinkedInOrganizationClient,
} from '@herald/linkedin'
import type { MastodonFetcher } from '@herald/mastodon'
import {
    clientSecretBasic,
    clientSecretPost,
    validateReturnPath,
    type OAuthAuthorizationServer,
} from '@herald/oauth'
import {
    X_OAUTH_AUTHORIZATION_ENDPOINT,
    X_OAUTH_ISSUER,
    X_OAUTH_TOKEN_ENDPOINT,
    createXPublisher,
    type XPublisher,
} from '@herald/x'

import { blueskyPublisherConnectionPolicy } from './providers/bluesky'
import { devtoPublisherConnectionPolicy } from './providers/devto'
import { discordPublisherConnectionPolicy } from './providers/discord'
import { linkedInPublisherConnectionPolicy } from './providers/linkedin'
import { mastodonPublisherConnectionPolicy } from './providers/mastodon'
import { xPublisherConnectionPolicy } from './providers/x'

export interface PublisherRuntimeOptions {
    readonly apiOrigin: string
    readonly webOrigin: string
    readonly publisherEncryptionKey: Uint8Array
    readonly publisherEncryptionKeyId: string
    readonly linkedin?: {
        readonly clientId: string
        readonly clientSecret: string
        readonly authorizationServer?: OAuthAuthorizationServer
        readonly profileClient?: LinkedInMemberProfileClient
        readonly organizationClient?: LinkedInOrganizationClient
    }
    readonly bluesky?: {
        readonly clientMetadataUrl: string
        readonly handleResolver: string
    }
    readonly mastodon?: {
        readonly clientName?: string
        readonly fetcher?: MastodonFetcher
    }
    readonly x?: {
        readonly clientId: string
        readonly clientSecret: string
        readonly authorizationServer?: OAuthAuthorizationServer
        readonly publisher?: XPublisher
    }
    readonly now?: () => number
    readonly createId?: () => string
}

export function createPublisherRuntime(database: HeraldDatabase, options: PublisherRuntimeOptions) {
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const callbackUri = new URL('/api/oauth/linkedin/callback', options.apiOrigin).toString()
    const blueskyCallbackUri = new URL('/api/oauth/bluesky/callback', options.apiOrigin).toString()
    const mastodonCallbackUri = new URL(
        '/api/oauth/mastodon/callback',
        options.apiOrigin
    ).toString()
    const xCallbackUri = new URL('/api/oauth/x/callback', options.apiOrigin).toString()
    const cipher = createPublisherCredentialCipher({
        keyId: options.publisherEncryptionKeyId,
        key: options.publisherEncryptionKey,
    })
    const applicationCipher = createSecretCipher({
        domain: 'herald.provider-application',
        keyId: options.publisherEncryptionKeyId,
        key: options.publisherEncryptionKey,
    })
    const providerApplicationStore = createProviderApplicationStore(database, {
        cipher: applicationCipher,
        now,
        createId,
    })
    const credentialStore = createPublisherCredentialStore(database, { cipher, now, createId })
    const publisherStore = createPublisherStore(database, {
        credentialRevoker: credentialStore,
        connectionPolicies: {
            bluesky: blueskyPublisherConnectionPolicy,
            devto: devtoPublisherConnectionPolicy,
            discord: discordPublisherConnectionPolicy,
            linkedin: linkedInPublisherConnectionPolicy,
            mastodon: mastodonPublisherConnectionPolicy,
            x: xPublisherConnectionPolicy,
        },
        now,
        createId,
    })
    const authorizationAttemptStore = createAuthorizationAttemptStore(database, {
        cipher,
        validateReturnPath: path => validateReturnPath(path, ['/dashboard']),
        now,
        createId,
    })
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
    const bluesky =
        options.bluesky === undefined
            ? undefined
            : {
                  callbackUri: blueskyCallbackUri,
                  clientMetadata: createBlueskyClientMetadata({
                      clientId: options.bluesky.clientMetadataUrl,
                      clientName: 'Herald',
                      clientUri: options.webOrigin,
                      redirectUri: blueskyCallbackUri,
                  }),
                  handleResolver: options.bluesky.handleResolver,
              }

    const mastodon = {
        callbackUri: mastodonCallbackUri,
        clientName: options.mastodon?.clientName ?? 'Herald',
        ...(options.mastodon?.fetcher === undefined ? {} : { fetcher: options.mastodon.fetcher }),
    }

    const x =
        options.x === undefined
            ? undefined
            : {
                  ...options.x,
                  authorizationServer: options.x.authorizationServer ?? defaultXAuthorizationServer,
                  clientAuthentication: clientSecretBasic(options.x.clientSecret),
                  publisher: options.x.publisher ?? createXPublisher(),
                  callbackUri: xCallbackUri,
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

    async function resolveBlueskyApplication(applicationId?: string | null) {
        if (applicationId === null) {
            return bluesky === undefined ? undefined : { applicationId: null, ...bluesky }
        }
        const configured = await providerApplicationStore.resolveProviderApplication(
            'bluesky',
            applicationId
        )
        if (configured !== null) {
            if (configured.clientMetadataUrl === null || configured.handleResolver === null) {
                return undefined
            }
            return {
                applicationId: configured.id,
                callbackUri: blueskyCallbackUri,
                clientMetadata: createBlueskyClientMetadata({
                    clientId: configured.clientMetadataUrl,
                    clientName: 'Herald',
                    clientUri: options.webOrigin,
                    redirectUri: blueskyCallbackUri,
                }),
                handleResolver: configured.handleResolver,
            }
        }
        if (applicationId !== undefined && applicationId !== null) return undefined
        if (providerApplicationStore.hasProviderApplication('bluesky')) return undefined
        return bluesky === undefined ? undefined : { applicationId: null, ...bluesky }
    }

    async function resolveXApplication(applicationId?: string | null) {
        if (applicationId === null) {
            return x === undefined ? undefined : { applicationId: null, ...x }
        }
        const configured = await providerApplicationStore.resolveProviderApplication(
            'x',
            applicationId
        )
        if (configured !== null) {
            if (configured.clientId === null || configured.clientSecret === null) return undefined
            return {
                applicationId: configured.id,
                clientId: configured.clientId,
                clientSecret: configured.clientSecret,
                authorizationServer: options.x?.authorizationServer ?? defaultXAuthorizationServer,
                clientAuthentication: clientSecretBasic(configured.clientSecret),
                publisher: options.x?.publisher ?? createXPublisher(),
                callbackUri: xCallbackUri,
            }
        }
        if (applicationId !== undefined && applicationId !== null) return undefined
        if (providerApplicationStore.hasProviderApplication('x')) return undefined
        return x === undefined ? undefined : { applicationId: null, ...x }
    }

    return {
        apiOrigin: options.apiOrigin,
        webOrigin: options.webOrigin,
        callbackUri,
        mastodonCallbackUri,
        xCallbackUri,
        now,
        publisherStore,
        credentialStore,
        authorizationAttemptStore,
        providerApplicationStore,
        resolveLinkedInApplication,
        resolveBlueskyApplication,
        resolveXApplication,
        resolveBlueskyOAuth: async (applicationId?: string | null) => {
            const resolved = await resolveBlueskyApplication(applicationId)
            if (resolved === undefined) return undefined
            return {
                clientMetadata: resolved.clientMetadata,
                handleResolver: resolved.handleResolver,
            }
        },
        resolveLinkedInOAuth: async (applicationId?: string | null) => {
            const resolved = await resolveLinkedInApplication(applicationId)
            if (resolved === undefined) return undefined
            return {
                clientId: resolved.clientId,
                clientAuthentication: resolved.clientAuthentication,
                authorizationServer: resolved.authorizationServer,
            }
        },
        resolveXOAuth: async (applicationId?: string | null) => {
            const resolved = await resolveXApplication(applicationId)
            if (resolved === undefined) return undefined
            return {
                clientId: resolved.clientId,
                clientAuthentication: resolved.clientAuthentication,
                authorizationServer: resolved.authorizationServer,
            }
        },
        linkedin,
        bluesky,
        mastodon,
        x,
    }
}

export type PublisherRuntime = ReturnType<typeof createPublisherRuntime>

const defaultXAuthorizationServer: OAuthAuthorizationServer = {
    issuer: X_OAUTH_ISSUER,
    authorizationEndpoint: X_OAUTH_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: X_OAUTH_TOKEN_ENDPOINT,
    pkce: 'required',
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
