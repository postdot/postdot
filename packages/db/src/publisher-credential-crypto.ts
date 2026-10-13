import {
    createSecretCipher,
    encryptedSecretEnvelopeVersion,
    SecretCipherError,
    type EncryptedSecretEnvelope,
} from './encrypted-secret-crypto'

export const publisherCredentialEnvelopeVersion = encryptedSecretEnvelopeVersion

export type PublisherSecretField =
    | 'access_token'
    | 'refresh_token'
    | 'pkce_verifier'
    | 'provider_session'
    | 'provider_state'

export type EncryptedPublisherSecret = EncryptedSecretEnvelope

export type PublisherCredentialCipherErrorCode =
    | 'invalid_key'
    | 'invalid_secret'
    | 'unsupported_version'
    | 'unknown_key'
    | 'decryption_failed'

export class PublisherCredentialCipherError extends Error {
    readonly code: PublisherCredentialCipherErrorCode

    constructor(code: PublisherCredentialCipherErrorCode, message: string) {
        super(message)
        this.name = 'PublisherCredentialCipherError'
        this.code = code
    }
}

export interface PublisherSecretContext {
    readonly recordId: string
    readonly providerId: string
    readonly field: PublisherSecretField
}

export interface PublisherCredentialCipher {
    readonly keyId: string
    encrypt(context: PublisherSecretContext, plaintext: string): Promise<EncryptedPublisherSecret>
    decrypt(context: PublisherSecretContext, envelope: EncryptedPublisherSecret): Promise<string>
}

export interface CreatePublisherCredentialCipherOptions {
    readonly keyId: string
    readonly key: Uint8Array
}

export function createPublisherCredentialCipher(
    options: CreatePublisherCredentialCipherOptions
): PublisherCredentialCipher {
    let cipher: ReturnType<typeof createSecretCipher>
    try {
        cipher = createSecretCipher({
            domain: 'postbot.publisher-secret',
            keyId: options.keyId,
            key: options.key,
        })
    } catch (error) {
        throw toPublisherCipherError(error)
    }

    return {
        keyId: cipher.keyId,
        async encrypt(context, plaintext) {
            try {
                return await cipher.encrypt(
                    {
                        recordId: context.recordId,
                        purpose: [context.providerId, context.field],
                    },
                    plaintext
                )
            } catch (error) {
                throw toPublisherCipherError(error)
            }
        },
        async decrypt(context, envelope) {
            try {
                return await cipher.decrypt(
                    {
                        recordId: context.recordId,
                        purpose: [context.providerId, context.field],
                    },
                    envelope
                )
            } catch (error) {
                throw toPublisherCipherError(error)
            }
        },
    }
}

function toPublisherCipherError(error: unknown): PublisherCredentialCipherError {
    if (error instanceof PublisherCredentialCipherError) return error
    if (error instanceof SecretCipherError) {
        return new PublisherCredentialCipherError(error.code, publisherMessage(error.code))
    }
    if (error instanceof Error) {
        return new PublisherCredentialCipherError('decryption_failed', error.message)
    }
    return new PublisherCredentialCipherError(
        'decryption_failed',
        'Publisher credential operation failed'
    )
}

function publisherMessage(code: PublisherCredentialCipherErrorCode): string {
    switch (code) {
        case 'invalid_key':
            return 'Publisher credential encryption key must contain exactly 32 bytes'
        case 'invalid_secret':
            return 'Publisher credential secret must not be empty'
        case 'unsupported_version':
            return 'Unsupported publisher credential envelope version'
        case 'unknown_key':
            return 'Publisher credential envelope uses an unavailable key'
        case 'decryption_failed':
            return 'Publisher credential decryption failed'
    }
}
