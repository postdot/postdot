import { describe, expect, it } from 'bun:test'

import {
    createPublisherCredentialCipher,
    PublisherCredentialCipherError,
    type EncryptedPublisherSecret,
    type PublisherSecretContext,
} from './publisher-credential-crypto'

const context: PublisherSecretContext = {
    credentialId: 'credential-1',
    providerId: 'linkedin',
    field: 'access_token',
}

function expectCipherError(
    action: () => Promise<unknown> | unknown,
    code: PublisherCredentialCipherError['code']
): Promise<void> | void {
    const verify = (error: unknown) => {
        expect(error).toBeInstanceOf(PublisherCredentialCipherError)
        expect((error as PublisherCredentialCipherError).code).toBe(code)
    }

    try {
        const result = action()
        if (result instanceof Promise) {
            return result.then(() => {
                throw new Error(`Expected ${code}`)
            }, verify)
        }
        throw new Error(`Expected ${code}`)
    } catch (error) {
        verify(error)
    }
}

describe('publisher credential cipher', () => {
    it('encrypts opaque secrets with fresh nonces and authenticated context', async () => {
        const cipher = createPublisherCredentialCipher({
            keyId: 'primary',
            key: new Uint8Array(32).fill(1),
        })
        const first = await cipher.encrypt(context, 'access-token-value')
        const second = await cipher.encrypt(context, 'access-token-value')

        expect(first.version).toBe(1)
        expect(first.keyId).toBe('primary')
        expect(first.nonce).toHaveLength(12)
        expect(first.ciphertext).not.toEqual(second.ciphertext)
        expect(first.nonce).not.toEqual(second.nonce)
        expect(new TextDecoder().decode(first.ciphertext)).not.toContain('access-token-value')
        expect(await cipher.decrypt(context, first)).toBe('access-token-value')

        await expectCipherError(
            () => cipher.decrypt({ ...context, field: 'refresh_token' }, first),
            'decryption_failed'
        )
        await expectCipherError(
            () => cipher.decrypt({ ...context, providerId: 'mastodon' }, first),
            'decryption_failed'
        )
        await expectCipherError(
            () => cipher.decrypt({ ...context, credentialId: 'credential-2' }, first),
            'decryption_failed'
        )
    })

    it('rejects tampering, wrong keys, unknown keys, and unsupported versions', async () => {
        const cipher = createPublisherCredentialCipher({
            keyId: 'primary',
            key: new Uint8Array(32).fill(1),
        })
        const wrongCipher = createPublisherCredentialCipher({
            keyId: 'primary',
            key: new Uint8Array(32).fill(2),
        })
        const envelope = await cipher.encrypt(context, 'access-token-value')
        const tampered = Uint8Array.from(envelope.ciphertext)
        tampered[0] = (tampered[0] ?? 0) ^ 1

        await expectCipherError(
            () => cipher.decrypt(context, { ...envelope, ciphertext: tampered }),
            'decryption_failed'
        )
        await expectCipherError(() => wrongCipher.decrypt(context, envelope), 'decryption_failed')
        await expectCipherError(
            () => cipher.decrypt(context, { ...envelope, keyId: 'retired' }),
            'unknown_key'
        )
        await expectCipherError(
            () =>
                cipher.decrypt(context, {
                    ...envelope,
                    version: 2,
                } as unknown as EncryptedPublisherSecret),
            'unsupported_version'
        )
    })

    it('validates key and secret material without including it in errors', async () => {
        expectCipherError(
            () =>
                createPublisherCredentialCipher({
                    keyId: 'primary',
                    key: new Uint8Array(31),
                }),
            'invalid_key'
        )

        const cipher = createPublisherCredentialCipher({
            keyId: 'primary',
            key: new Uint8Array(32).fill(1),
        })
        await expectCipherError(() => cipher.encrypt(context, ''), 'invalid_secret')
    })
})
