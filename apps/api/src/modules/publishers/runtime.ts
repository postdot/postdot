import {
    createAuthorizationAttemptStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    createProviderApplicationStore,
    createSecretCipher,
    type PostbotDatabase,
} from '@postdot/db'
import { validateReturnPath } from '@postdot/oauth'

import {
    providerApplicationPolicies,
    publisherConnectionPolicies,
    createProviderRuntime,
    type ProviderRuntimeOptions,
} from '../../providers/registry'
export interface PublisherRuntimeBaseOptions {
    readonly apiOrigin: string
    readonly webOrigin: string
    readonly publisherEncryptionKey: Uint8Array
    readonly publisherEncryptionKeyId: string
    readonly now?: () => number
    readonly createId?: () => string
}
export type PublisherRuntimeOptions = PublisherRuntimeBaseOptions & ProviderRuntimeOptions
export function createPublisherRuntime(
    database: PostbotDatabase,
    options: PublisherRuntimeOptions
) {
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const cipher = createPublisherCredentialCipher({
        keyId: options.publisherEncryptionKeyId,
        key: options.publisherEncryptionKey,
    })
    const applicationCipher = createSecretCipher({
        domain: 'postbot.provider-application',
        keyId: options.publisherEncryptionKeyId,
        key: options.publisherEncryptionKey,
    })
    const providerApplicationStore = createProviderApplicationStore(database, {
        policies: providerApplicationPolicies,
        cipher: applicationCipher,
        now,
        createId,
    })
    const credentialStore = createPublisherCredentialStore(database, { cipher, now, createId })
    const publisherStore = createPublisherStore(database, {
        credentialRevoker: credentialStore,
        connectionPolicies: publisherConnectionPolicies,
        now,
        createId,
    })
    const authorizationAttemptStore = createAuthorizationAttemptStore(database, {
        cipher,
        validateReturnPath: path => validateReturnPath(path, ['/dashboard']),
        now,
        createId,
    })
    return {
        apiOrigin: options.apiOrigin,
        webOrigin: options.webOrigin,
        now,
        publisherStore,
        credentialStore,
        authorizationAttemptStore,
        providerApplicationStore,
        ...createProviderRuntime({ options, providerApplicationStore, now }),
    }
}
export type PublisherRuntime = ReturnType<typeof createPublisherRuntime>
