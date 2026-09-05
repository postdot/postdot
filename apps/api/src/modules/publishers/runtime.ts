import { createBlueskyClientMetadata } from '@herald/bluesky'
import {
    createAuthorizationAttemptStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
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
import { clientSecretPost, validateReturnPath, type OAuthAuthorizationServer } from '@herald/oauth'

import { blueskyPublisherConnectionPolicy } from './providers/bluesky'
import { linkedInPublisherConnectionPolicy } from './providers/linkedin'

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
    readonly now?: () => number
    readonly createId?: () => string
}

export function createPublisherRuntime(database: HeraldDatabase, options: PublisherRuntimeOptions) {
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const callbackUri = new URL('/api/oauth/linkedin/callback', options.apiOrigin).toString()
    const blueskyCallbackUri = new URL('/api/oauth/bluesky/callback', options.apiOrigin).toString()
    const cipher = createPublisherCredentialCipher({
        keyId: options.publisherEncryptionKeyId,
        key: options.publisherEncryptionKey,
    })
    const credentialStore = createPublisherCredentialStore(database, { cipher, now, createId })
    const publisherStore = createPublisherStore(database, {
        credentialRevoker: credentialStore,
        connectionPolicies: {
            bluesky: blueskyPublisherConnectionPolicy,
            linkedin: linkedInPublisherConnectionPolicy,
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

    return {
        apiOrigin: options.apiOrigin,
        webOrigin: options.webOrigin,
        callbackUri,
        now,
        publisherStore,
        credentialStore,
        authorizationAttemptStore,
        linkedin,
        bluesky,
    }
}

export type PublisherRuntime = ReturnType<typeof createPublisherRuntime>

const defaultLinkedInAuthorizationServer: OAuthAuthorizationServer = {
    issuer: LINKEDIN_OAUTH_ISSUER,
    authorizationEndpoint: LINKEDIN_OAUTH_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: LINKEDIN_OAUTH_TOKEN_ENDPOINT,
    // LinkedIn's standard web flow uses client-secret-post without PKCE. Its
    // PKCE flow is a separate native-client integration with different provider
    // requirements; state validation remains enabled for this server flow.
    pkce: 'disabled',
}
