import type { PostdotDatabase } from './client'
import type { SecretCipher } from './encrypted-secret-crypto'

const context = { recordId: 'default', purpose: ['smtp-configuration'] } as const

interface InstallationEmailSettingsRow {
    readonly encryptionVersion: number
    readonly encryptionKeyId: string
    readonly nonce: Uint8Array
    readonly ciphertext: Uint8Array
}

export function createInstallationEmailSettingsStore(
    database: PostdotDatabase,
    cipher: SecretCipher
) {
    const sql = database.sql
    const readStatement = sql.statement<InstallationEmailSettingsRow, []>(`
        select encryption_version as "encryptionVersion",
               encryption_key_id as "encryptionKeyId",
               nonce,
               ciphertext
        from installation_email_settings
        where id = 'default'
    `)
    const writeStatement = sql.statement<
        void,
        [
            encryptionVersion: number,
            encryptionKeyId: string,
            nonce: Uint8Array,
            ciphertext: Uint8Array,
            updatedAt: number,
        ]
    >(`
        insert into installation_email_settings (
            id,
            encryption_version,
            encryption_key_id,
            nonce,
            ciphertext,
            updated_at
        ) values ('default', ?1, ?2, ?3, ?4, ?5)
        on conflict (id) do update set
            encryption_version = excluded.encryption_version,
            encryption_key_id = excluded.encryption_key_id,
            nonce = excluded.nonce,
            ciphertext = excluded.ciphertext,
            updated_at = excluded.updated_at
    `)

    return {
        async read(): Promise<string | null> {
            const row = await readStatement.get()
            if (row === null) return null
            return cipher.decrypt(context, {
                version: row.encryptionVersion as 1,
                keyId: row.encryptionKeyId,
                nonce: row.nonce,
                ciphertext: row.ciphertext,
            })
        },
        async write(payload: string) {
            const encrypted = await cipher.encrypt(context, payload)
            await writeStatement.run(
                encrypted.version,
                encrypted.keyId,
                Buffer.from(encrypted.nonce),
                Buffer.from(encrypted.ciphertext),
                Date.now()
            )
        },
    }
}
