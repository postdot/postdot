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
    createLinkedInMemberProfileClient,
    type LinkedInMemberProfileClient,
} from '@herald/linkedin'
import { clientSecretPost, validateReturnPath, type OAuthAuthorizationServer } from '@herald/oauth'

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
    }
    readonly now?: () => number
    readonly createId?: () => string
}

export function createPublisherRuntime(database: HeraldDatabase, options: PublisherRuntimeOptions) {
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const callbackUri = new URL('/api/oauth/linkedin/callback', options.apiOrigin).toString()
    const cipher = createPublisherCredentialCipher({
        keyId: options.publisherEncryptionKeyId,
        key: options.publisherEncryptionKey,
    })
    const credentialStore = createPublisherCredentialStore(database, { cipher, now, createId })
    const publisherStore = createPublisherStore(database, {
        credentialRevoker: credentialStore,
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
