import { DomainInvariantError, requireNonBlank, requireTimestamp } from '@herald/core'

import type { HeraldDatabase } from './client'
import type { NotificationDestinationSecretCipher } from './notification-destination-secret-crypto'

type NotificationDestinationSecretState = 'active' | 'retired'

interface DestinationRow {
    readonly id: string
    readonly projectId: string
    readonly recipientActorId: string
    readonly transportId: string
    readonly createdAt: number
}

interface ActiveSecretRow {
    readonly id: string
    readonly projectId: string
    readonly destinationId: string
    readonly version: number
    readonly transportId: string
    readonly state: NotificationDestinationSecretState
    readonly encryptionVersion: number
    readonly encryptionKeyId: string
    readonly ciphertext: Uint8Array
    readonly nonce: Uint8Array
    readonly createdAt: number
    readonly updatedAt: number
}

interface DeliverySecretRow {
    readonly deliverySecretId: string | null
    readonly deliveryTransportId: string
    readonly id: string | null
    readonly projectId: string | null
    readonly destinationId: string | null
    readonly version: number | null
    readonly transportId: string | null
    readonly state: NotificationDestinationSecretState | null
    readonly encryptionVersion: number | null
    readonly encryptionKeyId: string | null
    readonly ciphertext: Uint8Array | null
    readonly nonce: Uint8Array | null
    readonly createdAt: number | null
    readonly updatedAt: number | null
}

export type NotificationDestinationSecretMaterial = Readonly<Record<string, string>>

export interface NotificationDestinationSecret {
    readonly id: string
    readonly projectId: string
    readonly destinationId: string
    readonly version: number
    readonly transportId: string
    readonly state: NotificationDestinationSecretState
    readonly encryptionVersion: number
    readonly encryptionKeyId: string
    readonly createdAt: number
    readonly updatedAt: number
}

export interface SetNotificationDestinationSecretInput {
    readonly projectId: string
    readonly subjectId: string
    readonly destinationId: string
    readonly material: NotificationDestinationSecretMaterial
}

export interface ResolveNotificationDestinationSecretInput {
    readonly projectId: string
    readonly deliveryId: string
    readonly claimToken: string
}

export interface NotificationDestinationSecretStoreOptions {
    readonly cipher: NotificationDestinationSecretCipher
    readonly createId?: () => string
    readonly now?: () => number
}

export function createNotificationDestinationSecretStore(
    database: HeraldDatabase,
    options: NotificationDestinationSecretStoreOptions
) {
    const client = database.$client
    const cipher = options.cipher
    const createId = options.createId ?? (() => crypto.randomUUID())
    const now = options.now ?? Date.now

    const loadDestinationStatement = client.query<
        DestinationRow,
        [projectId: string, destinationId: string, subjectId: string]
    >(`
        select
            d.id,
            d.project_id as projectId,
            d.recipient_actor_id as recipientActorId,
            d.transport_id as transportId,
            d.created_at as createdAt
        from notification_destinations d
        inner join actors a
            on a.project_id = d.project_id and a.id = d.recipient_actor_id
        where d.project_id = ?1
          and d.id = ?2
          and a.subject_id = ?3
          and a.kind = 'human'
    `)
    const loadActiveSecretStatement = client.query<
        ActiveSecretRow,
        [projectId: string, destinationId: string]
    >(secretSelect(`where s.project_id = ?1 and s.destination_id = ?2 and s.state = 'active'`))
    const loadSecretForDeliveryStatement = client.query<
        DeliverySecretRow,
        [projectId: string, deliveryId: string, claimToken: string]
    >(`
        select
            d.secret_id as deliverySecretId,
            d.transport_id as deliveryTransportId,
            s.id,
            s.project_id as projectId,
            s.destination_id as destinationId,
            s.version,
            s.transport_id as transportId,
            s.state,
            s.encryption_version as encryptionVersion,
            s.encryption_key_id as encryptionKeyId,
            s.ciphertext,
            s.nonce,
            s.created_at as createdAt,
            s.updated_at as updatedAt
        from notification_deliveries d
        left join notification_destination_secrets s
            on s.project_id = d.project_id
           and s.destination_id = d.destination_id
           and s.id = d.secret_id
        where d.project_id = ?1 and d.id = ?2
          and d.state = 'running' and d.lease_token = ?3
    `)
    const retireActiveSecretStatement = client.query<
        { readonly changes: number },
        [updatedAt: number, projectId: string, destinationId: string]
    >(`
        update notification_destination_secrets
        set state = 'retired', updated_at = ?1
        where project_id = ?2 and destination_id = ?3 and state = 'active'
    `)
    const insertSecretStatement = client.query<
        { readonly changes: number },
        [
            id: string,
            projectId: string,
            destinationId: string,
            version: number,
            transportId: string,
            encryptionVersion: number,
            encryptionKeyId: string,
            ciphertext: Uint8Array,
            nonce: Uint8Array,
            createdAt: number,
        ]
    >(`
        insert into notification_destination_secrets (
            id, project_id, destination_id, version, transport_id, state,
            encryption_version, encryption_key_id, ciphertext, nonce, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?10, ?10)
    `)

    const store = {
        async setSecret(
            input: SetNotificationDestinationSecretInput
        ): Promise<NotificationDestinationSecret | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const destinationId = requireNonBlank(input.destinationId, 'destinationId')
            const destination = loadDestinationStatement.get(projectId, destinationId, subjectId)
            if (destination === null) return null

            const material = normalizeSecretMaterial(input.material)
            const active = loadActiveSecretStatement.get(projectId, destinationId)
            const version = (active?.version ?? 0) + 1
            const secretId = createId()
            const createdAt = Math.max(requireTimestamp(now(), 'now'), destination.createdAt)
            const envelope = await cipher.encrypt(
                {
                    recordId: secretId,
                    purpose: [destination.transportId, String(version)],
                },
                JSON.stringify(material)
            )

            const inserted = client
                .transaction(() => {
                    const current = loadActiveSecretStatement.get(projectId, destinationId)
                    if ((current?.version ?? 0) !== (active?.version ?? 0)) {
                        throw new DomainInvariantError(
                            'write_conflict',
                            'Notification destination secret changed during rotation'
                        )
                    }
                    retireActiveSecretStatement.run(createdAt, projectId, destinationId)
                    return insertSecretStatement.run(
                        secretId,
                        projectId,
                        destinationId,
                        version,
                        destination.transportId,
                        envelope.version,
                        envelope.keyId,
                        envelope.ciphertext,
                        envelope.nonce,
                        createdAt
                    )
                })
                .immediate()
            if (inserted.changes !== 1) {
                throw new Error('Notification destination secret was not persisted')
            }

            const stored = loadActiveSecretStatement.get(projectId, destinationId)
            if (stored === null) {
                throw new Error('Notification destination secret disappeared after persistence')
            }
            return toSecret(stored)
        },

        async resolveForClaim(
            input: ResolveNotificationDestinationSecretInput
        ): Promise<NotificationDestinationSecretMaterial | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const deliveryId = requireNonBlank(input.deliveryId, 'deliveryId')
            const claimToken = requireNonBlank(input.claimToken, 'claimToken')
            const row = loadSecretForDeliveryStatement.get(projectId, deliveryId, claimToken)
            if (row === null) return null
            if (row.deliverySecretId === null) return null
            if (row.id === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Notification delivery references a missing secret'
                )
            }
            if (
                row.transportId === null ||
                row.version === null ||
                row.encryptionVersion === null ||
                row.encryptionKeyId === null ||
                row.ciphertext === null ||
                row.nonce === null
            ) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Notification delivery secret envelope is incomplete'
                )
            }
            if (row.transportId !== row.deliveryTransportId) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Notification delivery secret transport does not match its delivery'
                )
            }

            const plaintext = await cipher.decrypt(
                {
                    recordId: row.id,
                    purpose: [row.transportId, String(row.version)],
                },
                {
                    version: row.encryptionVersion as 1,
                    keyId: row.encryptionKeyId,
                    ciphertext: row.ciphertext,
                    nonce: row.nonce,
                }
            )
            return parseSecretMaterial(plaintext)
        },
    }

    return store
}

export type NotificationDestinationSecretStore = ReturnType<
    typeof createNotificationDestinationSecretStore
>

function secretSelect(predicate: string): string {
    return `
        select
            s.id,
            s.project_id as projectId,
            s.destination_id as destinationId,
            s.version,
            s.transport_id as transportId,
            s.state,
            s.encryption_version as encryptionVersion,
            s.encryption_key_id as encryptionKeyId,
            s.ciphertext,
            s.nonce,
            s.created_at as createdAt,
            s.updated_at as updatedAt
        from notification_destination_secrets s
        ${predicate}
    `
}

function toSecret(row: ActiveSecretRow): NotificationDestinationSecret {
    return {
        id: row.id,
        projectId: row.projectId,
        destinationId: row.destinationId,
        version: row.version,
        transportId: row.transportId,
        state: row.state,
        encryptionVersion: row.encryptionVersion,
        encryptionKeyId: row.encryptionKeyId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function normalizeSecretMaterial(
    value: NotificationDestinationSecretMaterial
): NotificationDestinationSecretMaterial {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new DomainInvariantError(
            'invalid_input',
            'Notification destination secret must be an object'
        )
    }
    const entries = Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, secret]) => {
            if (key.trim().length === 0 || typeof secret !== 'string' || secret.length === 0) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Notification destination secret fields must be non-empty strings'
                )
            }
            return [key, secret] as const
        })
    if (entries.length === 0) {
        throw new DomainInvariantError(
            'invalid_input',
            'Notification destination secret must contain at least one field'
        )
    }
    const normalized = Object.fromEntries(entries) as NotificationDestinationSecretMaterial
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 64 * 1024) {
        throw new DomainInvariantError(
            'invalid_input',
            'Notification destination secret is too large'
        )
    }
    return normalized
}

function parseSecretMaterial(value: string): NotificationDestinationSecretMaterial {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError(
            'invalid_input',
            'Notification destination secret payload is invalid'
        )
    }
    return normalizeSecretMaterial(parsed as NotificationDestinationSecretMaterial)
}
