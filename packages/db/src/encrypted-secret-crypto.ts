import { requireNonBlank } from '@postdot/core'

export const encryptedSecretEnvelopeVersion = 1 as const

export interface EncryptedSecretEnvelope {
    readonly version: typeof encryptedSecretEnvelopeVersion
    readonly keyId: string
    readonly nonce: Uint8Array
    readonly ciphertext: Uint8Array
}

export type SecretCipherErrorCode =
    | 'invalid_key'
    | 'invalid_secret'
    | 'unsupported_version'
    | 'unknown_key'
    | 'decryption_failed'

export class SecretCipherError extends Error {
    readonly code: SecretCipherErrorCode

    constructor(code: SecretCipherErrorCode, message: string) {
        super(message)
        this.name = 'SecretCipherError'
        this.code = code
    }
}

export interface SecretCipherContext {
    readonly recordId: string
    readonly purpose: readonly string[]
}

export interface SecretCipher {
    readonly keyId: string
    encrypt(context: SecretCipherContext, plaintext: string): Promise<EncryptedSecretEnvelope>
    decrypt(context: SecretCipherContext, envelope: EncryptedSecretEnvelope): Promise<string>
}

export interface CreateSecretCipherOptions {
    readonly domain: string
    readonly keyId: string
    readonly key: Uint8Array
}

// Authenticated-data bytes are a storage protocol, independent of the product name.
// Keep these protocol identifiers stable so existing encrypted credentials remain readable.
const domainProtocolIds: Readonly<Record<string, string>> = {
    'postbot.publisher-secret': '686572616c642e7075626c69736865722d736563726574',
    'postbot.notification-destination-secret':
        '686572616c642e6e6f74696669636174696f6e2d64657374696e6174696f6e2d736563726574',
    'postbot.provider-application': '686572616c642e70726f76696465722d6170706c69636174696f6e',
    'postbot.installation-email': '686572616c642e696e7374616c6c6174696f6e2d656d61696c',
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function webCryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
    copy.set(value)
    return copy
}

function authenticatedData(domain: string, context: SecretCipherContext): Uint8Array<ArrayBuffer> {
    const purpose = context.purpose.map((part, index) => requireNonBlank(part, `purpose[${index}]`))

    return webCryptoBytes(
        encoder.encode(
            JSON.stringify([
                domainProtocolIds[domain]
                    ? decoder.decode(Buffer.from(domainProtocolIds[domain], 'hex'))
                    : requireNonBlank(domain, 'domain'),
                encryptedSecretEnvelopeVersion,
                requireNonBlank(context.recordId, 'recordId'),
                ...purpose,
            ])
        )
    )
}

function validateEnvelope(envelope: EncryptedSecretEnvelope, keyId: string): void {
    if (envelope.version !== encryptedSecretEnvelopeVersion) {
        throw new SecretCipherError('unsupported_version', 'Unsupported secret envelope version')
    }
    if (envelope.keyId !== keyId) {
        throw new SecretCipherError('unknown_key', 'Secret envelope uses an unavailable key')
    }
    if (envelope.nonce.byteLength !== 12 || envelope.ciphertext.byteLength <= 16) {
        throw new SecretCipherError('decryption_failed', 'Secret decryption failed')
    }
}

export function createSecretCipher(options: CreateSecretCipherOptions): SecretCipher {
    const domain = requireNonBlank(options.domain, 'domain')
    const keyId = requireNonBlank(options.keyId, 'keyId')
    const keyBytes = Uint8Array.from(options.key)

    if (keyBytes.byteLength !== 32) {
        throw new SecretCipherError(
            'invalid_key',
            'Secret encryption key must contain exactly 32 bytes'
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
                throw new SecretCipherError('invalid_secret', 'Secret must not be empty')
            }

            const nonce = crypto.getRandomValues(new Uint8Array(12))
            const ciphertext = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: nonce,
                    additionalData: authenticatedData(domain, context),
                    tagLength: 128,
                },
                await cryptoKey,
                encoder.encode(plaintext)
            )

            return {
                version: encryptedSecretEnvelopeVersion,
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
                        additionalData: authenticatedData(domain, context),
                        tagLength: 128,
                    },
                    await cryptoKey,
                    webCryptoBytes(envelope.ciphertext)
                )

                return decoder.decode(plaintext)
            } catch {
                throw new SecretCipherError('decryption_failed', 'Secret decryption failed')
            }
        },
    }
}
