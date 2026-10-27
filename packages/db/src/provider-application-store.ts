import {
    requireNonBlank,
    requireTimestamp,
    type ProviderApplicationPolicy,
    type ProviderApplicationFields,
} from '@postdot/core'

import type { PostdotDatabase } from './client'
import type { EncryptedSecretEnvelope, SecretCipher } from './encrypted-secret-crypto'

export type ProviderApplicationProvider = string

export const providerApplicationStates = ['active', 'disabled'] as const
export type ProviderApplicationState = (typeof providerApplicationStates)[number]

export const providerApplicationOAuthModes = ['loopback', 'web'] as const
export type ProviderApplicationOAuthMode = (typeof providerApplicationOAuthModes)[number]

export interface ProviderApplicationConfiguration<Id extends string = string> {
    readonly id: string
    readonly providerId: Id
    readonly name: string
    readonly clientId: string | null
    readonly clientMetadataUrl: string | null
    readonly handleResolver: string | null
    /** Derived from the provider-specific configuration shape; not persisted separately. */
    readonly oauthMode: ProviderApplicationOAuthMode | null
    readonly state: ProviderApplicationState
    readonly isDefault: boolean
    readonly createdByUserId: string
    readonly hasClientSecret: boolean
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ResolvedProviderApplication<
    Id extends string = string,
> extends ProviderApplicationConfiguration<Id> {
    readonly clientSecret: string | null
}

export interface CreateProviderApplicationInput<Id extends string = string> {
    readonly providerId: Id
    readonly name: string
    readonly clientId?: string | null
    readonly clientMetadataUrl?: string | null
    readonly handleResolver?: string | null
    readonly clientSecret?: string | null
    readonly state?: ProviderApplicationState
    readonly isDefault?: boolean
    readonly createdByUserId: string
}

export interface UpdateProviderApplicationInput {
    readonly id: string
    readonly name?: string
    readonly clientId?: string | null
    readonly clientMetadataUrl?: string | null
    readonly handleResolver?: string | null
    /** Undefined preserves the current secret; null removes it for secretless providers. */
    readonly clientSecret?: string | null
    readonly state?: ProviderApplicationState
    readonly isDefault?: boolean
}

export type CreateProviderApplicationResult<Id extends string = string> =
    | { readonly kind: 'created'; readonly configuration: ProviderApplicationConfiguration<Id> }
    | { readonly kind: 'conflict' }

export type UpdateProviderApplicationResult<Id extends string = string> =
    | { readonly kind: 'updated'; readonly configuration: ProviderApplicationConfiguration<Id> }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'conflict' }

export interface ProviderApplicationStoreOptions<Id extends string = string> {
    readonly policies: readonly ProviderApplicationPolicy<Id>[]
    readonly cipher: SecretCipher
    readonly now?: () => number
    readonly createId?: () => string
}

interface ProviderApplicationRow {
    readonly id: string
    readonly providerId: string
    readonly name: string
    readonly clientId: string | null
    readonly clientMetadataUrl: string | null
    readonly handleResolver: string | null
    readonly state: ProviderApplicationState
    readonly isDefault: number
    readonly createdByUserId: string
    readonly encryptionVersion: number | null
    readonly encryptionKeyId: string | null
    readonly clientSecretCiphertext: Uint8Array | null
    readonly clientSecretNonce: Uint8Array | null
    readonly createdAt: number
    readonly updatedAt: number
}

const applicationColumns = `
    id,
    provider_id as providerId,
    name,
    client_id as clientId,
    client_metadata_url as clientMetadataUrl,
    handle_resolver as handleResolver,
    state,
    is_default as isDefault,
    created_by_user_id as createdByUserId,
    encryption_version as encryptionVersion,
    encryption_key_id as encryptionKeyId,
    client_secret_ciphertext as clientSecretCiphertext,
    client_secret_nonce as clientSecretNonce,
    created_at as createdAt,
    updated_at as updatedAt
`

function state(value: string): ProviderApplicationState {
    if (!(providerApplicationStates as readonly string[]).includes(value)) {
        throw new Error(`Unsupported provider application state: ${value}`)
    }
    return value as ProviderApplicationState
}

function envelope(row: ProviderApplicationRow): EncryptedSecretEnvelope | null {
    if (
        row.encryptionVersion === null &&
        row.encryptionKeyId === null &&
        row.clientSecretCiphertext === null &&
        row.clientSecretNonce === null
    ) {
        return null
    }
    if (
        row.encryptionVersion === null ||
        row.encryptionKeyId === null ||
        row.clientSecretCiphertext === null ||
        row.clientSecretNonce === null
    ) {
        throw new Error('Provider application client secret envelope is incomplete')
    }
    return {
        version: row.encryptionVersion as EncryptedSecretEnvelope['version'],
        keyId: row.encryptionKeyId,
        ciphertext: row.clientSecretCiphertext,
        nonce: row.clientSecretNonce,
    }
}

export function createProviderApplicationStore<const Id extends string>(
    database: PostdotDatabase,
    options: ProviderApplicationStoreOptions<Id>
) {
    function policy(id: string): ProviderApplicationPolicy<Id> {
        const found = options.policies.find(candidate => candidate.id === id)
        if (!found) throw new Error(`Unsupported provider application provider: ${id}`)
        return found
    }
    function provider(id: string): Id {
        return policy(id).id
    }
    function normalizeApplication(
        input: ProviderApplicationFields & { readonly providerId: string; readonly name: string },
        normalizationOptions: { readonly preserveMissingSecret?: boolean } = {}
    ) {
        const selected = policy(input.providerId)
        return {
            providerId: selected.id,
            name: requireNonBlank(input.name, 'name'),
            ...selected.normalize(input, normalizationOptions),
        }
    }
    function toConfiguration(row: ProviderApplicationRow): ProviderApplicationConfiguration<Id> {
        const clientSecret = envelope(row)
        return {
            id: row.id,
            providerId: provider(row.providerId),
            name: row.name,
            clientId: row.clientId,
            clientMetadataUrl: row.clientMetadataUrl,
            handleResolver: row.handleResolver,
            oauthMode: policy(row.providerId).oauthMode(row),
            state: state(row.state),
            isDefault: row.isDefault === 1,
            createdByUserId: row.createdByUserId,
            hasClientSecret: clientSecret !== null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }
    }

    const client = database.$client
    const cipher = options.cipher
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())

    const loadByIdStatement = client.query<ProviderApplicationRow, [id: string]>(`
        select ${applicationColumns}
        from provider_application_configurations
        where id = ?1
    `)
    const listStatement = client.query<ProviderApplicationRow, []>(`
        select ${applicationColumns}
        from provider_application_configurations
        order by provider_id, is_default desc, created_at, id
    `)
    const listProviderStatement = client.query<ProviderApplicationRow, [providerId: string]>(`
        select ${applicationColumns}
        from provider_application_configurations
        where provider_id = ?1
        order by is_default desc, created_at, id
    `)
    const loadDefaultStatement = client.query<ProviderApplicationRow, [providerId: string]>(`
        select ${applicationColumns}
        from provider_application_configurations
        where provider_id = ?1
          and state = 'active'
          and is_default = 1
    `)
    const insertStatement = client.query<
        { readonly changes: number },
        [
            id: string,
            providerId: Id,
            name: string,
            clientId: string | null,
            clientMetadataUrl: string | null,
            handleResolver: string | null,
            state: ProviderApplicationState,
            isDefault: number,
            createdByUserId: string,
            encryptionVersion: number | null,
            encryptionKeyId: string | null,
            clientSecretCiphertext: Uint8Array | null,
            clientSecretNonce: Uint8Array | null,
            timestamp: number,
        ]
    >(`
        insert into provider_application_configurations (
            id, provider_id, name, client_id, client_metadata_url, handle_resolver,
            state, is_default, created_by_user_id, encryption_version, encryption_key_id,
            client_secret_ciphertext, client_secret_nonce, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
    `)
    const updateStatement = client.query<
        { readonly changes: number },
        [
            name: string,
            clientId: string | null,
            clientMetadataUrl: string | null,
            handleResolver: string | null,
            state: ProviderApplicationState,
            isDefault: number,
            encryptionVersion: number | null,
            encryptionKeyId: string | null,
            clientSecretCiphertext: Uint8Array | null,
            clientSecretNonce: Uint8Array | null,
            timestamp: number,
            id: string,
        ]
    >(`
        update provider_application_configurations
        set name = ?1,
            client_id = ?2,
            client_metadata_url = ?3,
            handle_resolver = ?4,
            state = ?5,
            is_default = ?6,
            encryption_version = ?7,
            encryption_key_id = ?8,
            client_secret_ciphertext = ?9,
            client_secret_nonce = ?10,
            updated_at = ?11
        where id = ?12
    `)
    const clearDefaultsStatement = client.query<
        { readonly changes: number },
        [providerId: string]
    >(`
        update provider_application_configurations
        set is_default = 0
        where provider_id = ?1
    `)
    const promoteFallbackStatement = client.query<
        { readonly changes: number },
        [providerId: string, timestamp: number]
    >(`
        update provider_application_configurations
        set is_default = 1, updated_at = ?2
        where id = (
            select id
            from provider_application_configurations
            where provider_id = ?1 and state = 'active'
            order by created_at, id
            limit 1
        )
    `)

    function load(id: string): ProviderApplicationRow | null {
        return loadByIdStatement.get(requireNonBlank(id, 'id'))
    }

    function requireDefaultPolicy(
        providerId: Id,
        requestedDefault: boolean | undefined,
        requestedState: ProviderApplicationState
    ): boolean {
        if (requestedState !== 'active') return false
        if (requestedDefault === true) return true
        return loadDefaultStatement.get(providerId) === null
    }

    async function encryptSecret(
        id: string,
        providerId: Id,
        clientSecret: string | null
    ): Promise<EncryptedSecretEnvelope | null> {
        if (clientSecret === null) return null
        return cipher.encrypt(
            { recordId: id, purpose: [providerId, 'client_secret'] },
            clientSecret
        )
    }

    return {
        listProviderApplicationConfigurations(providerId?: Id) {
            return (
                providerId === undefined
                    ? listStatement.all()
                    : listProviderStatement.all(providerId)
            ).map(toConfiguration)
        },

        getProviderApplicationConfiguration(
            id: string
        ): ProviderApplicationConfiguration<Id> | null {
            const row = load(id)
            return row === null ? null : toConfiguration(row)
        },

        hasProviderApplication(providerId: Id): boolean {
            return listProviderStatement.all(providerId).length > 0
        },

        async resolveProviderApplication(
            providerId: Id,
            id?: string | null
        ): Promise<ResolvedProviderApplication<Id> | null> {
            const row =
                id === undefined || id === null ? loadDefaultStatement.get(providerId) : load(id)
            if (row === null || row.providerId !== providerId || row.state !== 'active') return null
            const configuration = toConfiguration(row)
            const clientSecretEnvelope = envelope(row)
            return {
                ...configuration,
                clientSecret:
                    clientSecretEnvelope === null
                        ? null
                        : await cipher.decrypt(
                              {
                                  recordId: row.id,
                                  purpose: [row.providerId, 'client_secret'],
                              },
                              clientSecretEnvelope
                          ),
            }
        },

        async createProviderApplication(
            input: CreateProviderApplicationInput<Id>
        ): Promise<CreateProviderApplicationResult<Id>> {
            const normalized = normalizeApplication(input)
            const createdByUserId = requireNonBlank(input.createdByUserId, 'createdByUserId')
            const applicationId = createId()
            const applicationState = input.state ?? 'active'
            const isDefault = requireDefaultPolicy(
                normalized.providerId,
                input.isDefault,
                applicationState
            )
            const secret = await encryptSecret(
                applicationId,
                normalized.providerId,
                normalized.clientSecret
            )
            const timestamp = requireTimestamp(now(), 'now')
            const transaction = client.transaction(() => {
                if (isDefault) clearDefaultsStatement.run(normalized.providerId)
                const inserted = insertStatement.run(
                    applicationId,
                    normalized.providerId,
                    normalized.name,
                    normalized.clientId,
                    normalized.clientMetadataUrl,
                    normalized.handleResolver,
                    applicationState,
                    isDefault ? 1 : 0,
                    createdByUserId,
                    secret?.version ?? null,
                    secret?.keyId ?? null,
                    secret?.ciphertext ?? null,
                    secret?.nonce ?? null,
                    timestamp
                )
                if (inserted.changes !== 1) throw new Error('Provider application was not created')
            })
            transaction()
            const created = load(applicationId)
            if (created === null) throw new Error('Provider application was not persisted')
            return { kind: 'created', configuration: toConfiguration(created) }
        },

        async updateProviderApplication(
            input: UpdateProviderApplicationInput
        ): Promise<UpdateProviderApplicationResult<Id>> {
            const existing = load(input.id)
            if (existing === null) return { kind: 'not_found' }
            const hasOwn = (key: keyof UpdateProviderApplicationInput) =>
                Object.prototype.hasOwnProperty.call(input, key)
            const normalized = normalizeApplication(
                {
                    providerId: existing.providerId,
                    name: input.name ?? existing.name,
                    clientId: hasOwn('clientId') ? input.clientId : existing.clientId,
                    clientMetadataUrl: hasOwn('clientMetadataUrl')
                        ? input.clientMetadataUrl
                        : existing.clientMetadataUrl,
                    handleResolver: hasOwn('handleResolver')
                        ? input.handleResolver
                        : existing.handleResolver,
                    clientSecret: input.clientSecret,
                },
                { preserveMissingSecret: input.clientSecret === undefined }
            )
            const applicationState = input.state ?? existing.state
            const isDefault = requireDefaultPolicy(
                provider(existing.providerId),
                input.isDefault ?? existing.isDefault === 1,
                applicationState
            )
            const secret =
                input.clientSecret === undefined
                    ? envelope(existing)
                    : await encryptSecret(
                          existing.id,
                          provider(existing.providerId),
                          normalized.clientSecret
                      )
            const timestamp = requireTimestamp(now(), 'now')
            const transaction = client.transaction(() => {
                if (isDefault) clearDefaultsStatement.run(existing.providerId)
                updateStatement.run(
                    normalized.name,
                    normalized.clientId,
                    normalized.clientMetadataUrl,
                    normalized.handleResolver,
                    applicationState,
                    isDefault ? 1 : 0,
                    secret?.version ?? null,
                    secret?.keyId ?? null,
                    secret?.ciphertext ?? null,
                    secret?.nonce ?? null,
                    timestamp,
                    existing.id
                )
                if (!isDefault && existing.isDefault === 1 && applicationState !== 'active') {
                    promoteFallbackStatement.run(existing.providerId, timestamp)
                }
            })
            transaction()
            const updated = load(existing.id)
            if (updated === null) return { kind: 'conflict' }
            return { kind: 'updated', configuration: toConfiguration(updated) }
        },
    }
}

export type ProviderApplicationStore = ReturnType<typeof createProviderApplicationStore>
