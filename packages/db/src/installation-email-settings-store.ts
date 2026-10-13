import { eq } from 'drizzle-orm'

import type { PostbotDatabase } from './client'
import { installationEmailSettings } from './domain-schema'
import type { SecretCipher } from './encrypted-secret-crypto'

const context = { recordId: 'default', purpose: ['smtp-configuration'] } as const

export function createInstallationEmailSettingsStore(
    database: PostbotDatabase,
    cipher: SecretCipher
) {
    return {
        async read(): Promise<string | null> {
            const row = database
                .select()
                .from(installationEmailSettings)
                .where(eq(installationEmailSettings.id, 'default'))
                .get()
            if (row === undefined) return null
            return cipher.decrypt(context, {
                version: row.encryptionVersion as 1,
                keyId: row.encryptionKeyId,
                nonce: row.nonce,
                ciphertext: row.ciphertext,
            })
        },
        async write(payload: string) {
            const encrypted = await cipher.encrypt(context, payload)
            const values = {
                id: 'default',
                encryptionVersion: encrypted.version,
                encryptionKeyId: encrypted.keyId,
                nonce: Buffer.from(encrypted.nonce),
                ciphertext: Buffer.from(encrypted.ciphertext),
                updatedAt: Date.now(),
            }
            database
                .insert(installationEmailSettings)
                .values(values)
                .onConflictDoUpdate({ target: installationEmailSettings.id, set: values })
                .run()
        },
    }
}
