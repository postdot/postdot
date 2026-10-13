import {
    createSecretCipher,
    encryptedSecretEnvelopeVersion,
    type EncryptedSecretEnvelope,
    type SecretCipher,
} from './encrypted-secret-crypto'

export const notificationDestinationSecretEnvelopeVersion = encryptedSecretEnvelopeVersion

export type EncryptedNotificationDestinationSecret = EncryptedSecretEnvelope
export type NotificationDestinationSecretCipher = SecretCipher

export interface CreateNotificationDestinationSecretCipherOptions {
    readonly keyId: string
    readonly key: Uint8Array
}

export function createNotificationDestinationSecretCipher(
    options: CreateNotificationDestinationSecretCipherOptions
): NotificationDestinationSecretCipher {
    return createSecretCipher({
        domain: 'postbot.notification-destination-secret',
        keyId: options.keyId,
        key: options.key,
    })
}
