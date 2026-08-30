import { requireNonBlank } from '@herald/core'

export const publisherCredentialEnvelopeVersion = 1 as const

export type PublisherSecretField = 'access_token' | 'refresh_token' | 'pkce_verifier'

export interface EncryptedPublisherSecret {
    readonly version: typeof publisherCredentialEnvelopeVersion
    readonly keyId: string
    readonly nonce: Uint8Array
    readonly ciphertext: Uint8Array
}

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

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function webCryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
    copy.set(value)
    return copy
}

function authenticatedData(context: PublisherSecretContext): Uint8Array<ArrayBuffer> {
    return webCryptoBytes(
        encoder.encode(
            JSON.stringify([
                'herald.publisher-secret',
                publisherCredentialEnvelopeVersion,
                requireNonBlank(context.recordId, 'recordId'),
                requireNonBlank(context.providerId, 'providerId'),
                context.field,
            ])
        )
    )
}

function validateEnvelope(envelope: EncryptedPublisherSecret, keyId: string): void {
    if (envelope.version !== publisherCredentialEnvelopeVersion) {
        throw new PublisherCredentialCipherError(
            'unsupported_version',
            'Unsupported publisher credential envelope version'
        )
    }
    if (envelope.keyId !== keyId) {
        throw new PublisherCredentialCipherError(
            'unknown_key',
            'Publisher credential envelope uses an unavailable key'
        )
    }
    if (envelope.nonce.byteLength !== 12 || envelope.ciphertext.byteLength <= 16) {
        throw new PublisherCredentialCipherError(
            'decryption_failed',
            'Publisher credential decryption failed'
        )
    }
}

export function createPublisherCredentialCipher(
    options: CreatePublisherCredentialCipherOptions
): PublisherCredentialCipher {
    const keyId = requireNonBlank(options.keyId, 'keyId')
    const keyBytes = Uint8Array.from(options.key)

    if (keyBytes.byteLength !== 32) {
        throw new PublisherCredentialCipherError(
            'invalid_key',
            'Publisher credential encryption key must contain exactly 32 bytes'
        )
    }

    const cryptoKey = crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
    ])

    return {
        keyId,
        async encrypt(context, plaintext) {
            if (plaintext.length === 0) {
                throw new PublisherCredentialCipherError(
                    'invalid_secret',
                    'Publisher credential secret must not be empty'
                )
            }

            const nonce = crypto.getRandomValues(new Uint8Array(12))
            const ciphertext = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: nonce,
                    additionalData: authenticatedData(context),
                    tagLength: 128,
                },
                await cryptoKey,
                encoder.encode(plaintext)
            )

            return {
                version: publisherCredentialEnvelopeVersion,
                keyId,
                nonce,
                ciphertext: new Uint8Array(ciphertext),
            }
        },
        async decrypt(context, envelope) {
            validateEnvelope(envelope, keyId)

            try {
                const plaintext = await crypto.subtle.decrypt(
                    {
                        name: 'AES-GCM',
                        iv: webCryptoBytes(envelope.nonce),
                        additionalData: authenticatedData(context),
                        tagLength: 128,
                    },
                    await cryptoKey,
                    webCryptoBytes(envelope.ciphertext)
                )

                return decoder.decode(plaintext)
            } catch {
                throw new PublisherCredentialCipherError(
                    'decryption_failed',
                    'Publisher credential decryption failed'
                )
            }
        },
    }
}
