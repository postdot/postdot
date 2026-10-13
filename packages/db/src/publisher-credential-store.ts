import {
    createPublisherCredential,
    publisherCredentialStates,
    requireNonBlank,
    requireTimestamp,
    type Actor,
    type Project,
    type PublisherCredential,
    type PublisherCredentialState,
} from '@postbot/core'

import type { PostbotDatabase } from './client'
import {
    type EncryptedPublisherSecret,
    type PublisherCredentialCipher,
    type PublisherSecretField,
} from './publisher-credential-crypto'

export interface CreatePublisherCredentialInput {
    readonly projectId: string
    readonly connectedByActorId: string
    readonly providerId: string
    readonly providerApplicationId?: string | null
    readonly externalAccountId: string
    readonly externalAccountName?: string | null
    readonly scopes?: readonly string[]
    readonly accessToken: string
    readonly refreshToken?: string | null
    /** Serialized provider-owned session state, encrypted at rest when present. */
    readonly providerSession?: string | null
    readonly expiresAt?: number | null
}

export type CreatePublisherCredentialResult =
    | { readonly kind: 'created'; readonly credential: PublisherCredential }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'already_exists'; readonly credential: PublisherCredential }

export interface ReplacePublisherCredentialTokensInput {
    readonly projectId: string
    readonly credentialId: string
    /** Undefined preserves the scopes granted to the credential. */
    readonly scopes?: readonly string[]
    /** Undefined preserves the application that issued the credential. */
    readonly providerApplicationId?: string | null
    readonly accessToken: string
    /** Undefined preserves the current refresh token; null removes it. */
    readonly refreshToken?: string | null
    /** Undefined preserves the current provider session; null removes it. */
    readonly providerSession?: string | null
    readonly expiresAt: number | null
}

export type ReplacePublisherCredentialTokensResult =
    | { readonly kind: 'updated'; readonly credential: PublisherCredential }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'conflict' }

export interface PublisherCredentialSecrets {
    readonly accessToken: string
    readonly refreshToken: string | null
    readonly providerSession: string | null
}

export interface PublisherCredentialStoreOptions {
    readonly cipher: PublisherCredentialCipher
    readonly now?: () => number
    readonly createId?: () => string
}

interface ProjectRow {
    readonly id: string
    readonly name: string
    readonly timeZone: string
    readonly workspaceId: string | null
    readonly primaryCategoryId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface ActorRow {
    readonly id: string
    readonly projectId: string
    readonly kind: Actor['kind']
    readonly subjectId: string | null
    readonly displayName: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface CredentialMetadataRow {
    readonly id: string
    readonly projectId: string
    readonly providerId: string
    readonly providerApplicationId: string | null
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly scopesJson: string
    readonly state: PublisherCredentialState
    readonly expiresAt: number | null
    readonly connectedByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface CredentialSecretRow extends CredentialMetadataRow {
    readonly encryptionVersion: number | null
    readonly encryptionKeyId: string | null
    readonly accessTokenCiphertext: Uint8Array | null
    readonly accessTokenNonce: Uint8Array | null
    readonly refreshTokenCiphertext: Uint8Array | null
    readonly refreshTokenNonce: Uint8Array | null
    readonly providerSessionCiphertext: Uint8Array | null
    readonly providerSessionNonce: Uint8Array | null
    readonly revision: number
}

const metadataColumns = `
    id,
    project_id as projectId,
    provider_id as providerId,
    provider_application_id as providerApplicationId,
    external_account_id as externalAccountId,
    external_account_name as externalAccountName,
    scopes as scopesJson,
    state,
    expires_at as expiresAt,
    connected_by_actor_id as connectedByActorId,
    created_at as createdAt,
    updated_at as updatedAt
`

const secretColumns = `
    ${metadataColumns},
    encryption_version as encryptionVersion,
    encryption_key_id as encryptionKeyId,
    access_token_ciphertext as accessTokenCiphertext,
    access_token_nonce as accessTokenNonce,
    refresh_token_ciphertext as refreshTokenCiphertext,
    refresh_token_nonce as refreshTokenNonce,
    provider_session_ciphertext as providerSessionCiphertext,
    provider_session_nonce as providerSessionNonce,
    revision
`

function parseScopes(scopesJson: string): readonly string[] {
    const value: unknown = JSON.parse(scopesJson)
    if (!Array.isArray(value) || !value.every(scope => typeof scope === 'string')) {
        throw new Error('Stored publisher credential scopes are invalid')
    }
    return value.map(scope => requireNonBlank(scope, 'scope'))
}

function toCredential(row: CredentialMetadataRow): PublisherCredential {
    if (!(publisherCredentialStates as readonly string[]).includes(row.state)) {
        throw new Error('Stored publisher credential state is invalid')
    }

    return {
        id: row.id,
        projectId: row.projectId,
        providerId: row.providerId,
        ...(row.providerApplicationId === null
            ? {}
            : { providerApplicationId: row.providerApplicationId }),
        externalAccountId: row.externalAccountId,
        externalAccountName: row.externalAccountName,
        scopes: parseScopes(row.scopesJson),
        state: row.state,
        expiresAt: row.expiresAt,
        connectedByActorId: row.connectedByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        timeZone: row.timeZone,
        workspaceId: row.workspaceId,
        primaryCategoryId: row.primaryCategoryId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toActor(row: ActorRow): Actor {
    return {
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
        subjectId: row.subjectId,
        displayName: row.displayName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function envelopeFromRow(
    row: CredentialSecretRow,
    field: Extract<PublisherSecretField, 'access_token' | 'refresh_token' | 'provider_session'>
): EncryptedPublisherSecret | null {
    const ciphertext =
        field === 'access_token'
            ? row.accessTokenCiphertext
            : field === 'refresh_token'
              ? row.refreshTokenCiphertext
              : row.providerSessionCiphertext
    const nonce =
        field === 'access_token'
            ? row.accessTokenNonce
            : field === 'refresh_token'
              ? row.refreshTokenNonce
              : row.providerSessionNonce

    if (ciphertext === null && nonce === null) return null
    if (
        ciphertext === null ||
        nonce === null ||
        row.encryptionVersion === null ||
        row.encryptionKeyId === null
    ) {
        throw new Error('Stored publisher credential envelope is incomplete')
    }

    return {
        version: row.encryptionVersion as EncryptedPublisherSecret['version'],
        keyId: row.encryptionKeyId,
        ciphertext,
        nonce,
    }
}

export function createPublisherCredentialStore(
    database: PostbotDatabase,
    options: PublisherCredentialStoreOptions
) {
    const client = database.$client
    const cipher = options.cipher
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())

    const loadProjectStatement = client.query<ProjectRow, [projectId: string]>(`
        select id,
               name,
               time_zone as timeZone,
               workspace_id as workspaceId,
               primary_category_id as primaryCategoryId,
               created_at as createdAt,
               updated_at as updatedAt
        from projects
        where id = ?1
    `)
    const loadActorStatement = client.query<
        ActorRow,
        [projectId: string, connectedByActorId: string]
    >(`
        select id,
               project_id as projectId,
               kind,
               subject_id as subjectId,
               display_name as displayName,
               created_at as createdAt,
               updated_at as updatedAt
        from actors
        where project_id = ?1
          and id = ?2
    `)
    const loadCredentialMetadataStatement = client.query<
        CredentialMetadataRow,
        [projectId: string, credentialId: string]
    >(`
        select ${metadataColumns}
        from publisher_credentials
        where project_id = ?1
          and id = ?2
    `)
    const loadCredentialByExternalAccountStatement = client.query<
        CredentialMetadataRow,
        [projectId: string, providerId: string, externalAccountId: string]
    >(`
        select ${metadataColumns}
        from publisher_credentials
        where project_id = ?1
          and provider_id = ?2
          and external_account_id = ?3
    `)
    const listCredentialMetadataStatement = client.query<
        CredentialMetadataRow,
        [projectId: string]
    >(`
        select ${metadataColumns}
        from publisher_credentials
        where project_id = ?1
        order by created_at, id
    `)
    const loadCredentialSecretsStatement = client.query<
        CredentialSecretRow,
        [projectId: string, credentialId: string]
    >(`
        select ${secretColumns}
        from publisher_credentials
        where project_id = ?1
          and id = ?2
    `)
    const insertCredentialStatement = client.query<
        { changes: number },
        [
            id: string,
            projectId: string,
            providerId: string,
            externalAccountId: string,
            externalAccountName: string | null,
            scopesJson: string,
            state: PublisherCredentialState,
            expiresAt: number | null,
            connectedByActorId: string,
            providerApplicationId: string | null,
            encryptionVersion: number,
            encryptionKeyId: string,
            accessTokenCiphertext: Uint8Array,
            accessTokenNonce: Uint8Array,
            refreshTokenCiphertext: Uint8Array | null,
            refreshTokenNonce: Uint8Array | null,
            providerSessionCiphertext: Uint8Array | null,
            providerSessionNonce: Uint8Array | null,
            timestamp: number,
        ]
    >(`
        insert into publisher_credentials (
            id,
            project_id,
            provider_id,
            external_account_id,
            external_account_name,
            scopes,
            state,
            expires_at,
            connected_by_actor_id,
            provider_application_id,
            encryption_version,
            encryption_key_id,
            access_token_ciphertext,
            access_token_nonce,
            refresh_token_ciphertext,
            refresh_token_nonce,
            provider_session_ciphertext,
            provider_session_nonce,
            created_at,
            updated_at
        ) values (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19
        )
        on conflict (project_id, provider_id, external_account_id) do nothing
    `)
    const replaceTokensStatement = client.query<
        { changes: number },
        [
            encryptionVersion: number,
            encryptionKeyId: string,
            accessTokenCiphertext: Uint8Array,
            accessTokenNonce: Uint8Array,
            refreshTokenCiphertext: Uint8Array | null,
            refreshTokenNonce: Uint8Array | null,
            providerSessionCiphertext: Uint8Array | null,
            providerSessionNonce: Uint8Array | null,
            expiresAt: number | null,
            scopesJson: string,
            providerApplicationId: string | null,
            timestamp: number,
            projectId: string,
            credentialId: string,
            revision: number,
        ]
    >(`
        update publisher_credentials
        set encryption_version = ?1,
            encryption_key_id = ?2,
            access_token_ciphertext = ?3,
            access_token_nonce = ?4,
            refresh_token_ciphertext = ?5,
            refresh_token_nonce = ?6,
            provider_session_ciphertext = ?7,
            provider_session_nonce = ?8,
            expires_at = ?9,
            scopes = ?10,
            provider_application_id = ?11,
            state = 'active',
            revision = revision + 1,
            updated_at = ?12
        where project_id = ?13
          and id = ?14
          and revision = ?15
    `)
    const markReconnectRequiredStatement = client.query<
        { changes: number },
        [timestamp: number, projectId: string, credentialId: string]
    >(`
        update publisher_credentials
        set state = 'reconnect_required',
            revision = revision + 1,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state != 'revoked'
    `)
    const revokeCredentialStatement = client.query<
        { changes: number },
        [timestamp: number, projectId: string, credentialId: string]
    >(`
        update publisher_credentials
        set state = 'revoked',
            expires_at = null,
            encryption_version = null,
            encryption_key_id = null,
            access_token_ciphertext = null,
            access_token_nonce = null,
            refresh_token_ciphertext = null,
            refresh_token_nonce = null,
            provider_session_ciphertext = null,
            provider_session_nonce = null,
            revision = revision + 1,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state != 'revoked'
    `)
    const revokeUnreferencedCredentialStatement = client.query<
        { changes: number },
        [timestamp: number, projectId: string, credentialId: string]
    >(`
        update publisher_credentials
        set state = 'revoked',
            expires_at = null,
            encryption_version = null,
            encryption_key_id = null,
            access_token_ciphertext = null,
            access_token_nonce = null,
            refresh_token_ciphertext = null,
            refresh_token_nonce = null,
            provider_session_ciphertext = null,
            provider_session_nonce = null,
            revision = revision + 1,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state != 'revoked'
          and not exists (
              select 1
              from publisher_connections
              where publisher_connections.project_id = publisher_credentials.project_id
                and publisher_connections.credential_id = publisher_credentials.id
          )
    `)

    return {
        async createPublisherCredential(
            input: CreatePublisherCredentialInput
        ): Promise<CreatePublisherCredentialResult> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const connectedByActorId = requireNonBlank(
                input.connectedByActorId,
                'connectedByActorId'
            )
            const providerId = requireNonBlank(input.providerId, 'providerId')
            const externalAccountId = requireNonBlank(input.externalAccountId, 'externalAccountId')
            const projectRow = loadProjectStatement.get(projectId)
            const actorRow = loadActorStatement.get(projectId, connectedByActorId)
            if (projectRow === null || actorRow === null) return { kind: 'not_found' }

            const existing = loadCredentialByExternalAccountStatement.get(
                projectId,
                providerId,
                externalAccountId
            )
            if (existing !== null) {
                return { kind: 'already_exists', credential: toCredential(existing) }
            }

            const timestamp = requireTimestamp(now(), 'now')
            const credential = createPublisherCredential({
                id: createId(),
                project: toProject(projectRow),
                connectedBy: toActor(actorRow),
                providerId,
                providerApplicationId: input.providerApplicationId,
                externalAccountId,
                externalAccountName: input.externalAccountName,
                scopes: input.scopes,
                expiresAt: input.expiresAt,
                now: timestamp,
            })
            const accessToken = await cipher.encrypt(
                {
                    recordId: credential.id,
                    providerId: credential.providerId,
                    field: 'access_token',
                },
                input.accessToken
            )
            const refreshToken =
                input.refreshToken === null || input.refreshToken === undefined
                    ? null
                    : await cipher.encrypt(
                          {
                              recordId: credential.id,
                              providerId: credential.providerId,
                              field: 'refresh_token',
                          },
                          input.refreshToken
                      )
            const providerSession =
                input.providerSession === null || input.providerSession === undefined
                    ? null
                    : await cipher.encrypt(
                          {
                              recordId: credential.id,
                              providerId: credential.providerId,
                              field: 'provider_session',
                          },
                          input.providerSession
                      )

            const inserted = insertCredentialStatement.run(
                credential.id,
                credential.projectId,
                credential.providerId,
                credential.externalAccountId,
                credential.externalAccountName,
                JSON.stringify(credential.scopes),
                credential.state,
                credential.expiresAt,
                credential.connectedByActorId,
                credential.providerApplicationId ?? null,
                accessToken.version,
                accessToken.keyId,
                accessToken.ciphertext,
                accessToken.nonce,
                refreshToken?.ciphertext ?? null,
                refreshToken?.nonce ?? null,
                providerSession?.ciphertext ?? null,
                providerSession?.nonce ?? null,
                timestamp
            )

            if (inserted.changes !== 1) {
                const concurrent = loadCredentialByExternalAccountStatement.get(
                    credential.projectId,
                    credential.providerId,
                    credential.externalAccountId
                )
                if (concurrent === null) {
                    throw new Error('Publisher credential insertion did not persist a row')
                }
                return { kind: 'already_exists', credential: toCredential(concurrent) }
            }

            return { kind: 'created', credential }
        },

        getPublisherCredential(
            projectId: string,
            credentialId: string
        ): PublisherCredential | null {
            const row = loadCredentialMetadataStatement.get(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(credentialId, 'credentialId')
            )
            return row === null ? null : toCredential(row)
        },

        listPublisherCredentials(projectId: string): PublisherCredential[] {
            return listCredentialMetadataStatement
                .all(requireNonBlank(projectId, 'projectId'))
                .map(toCredential)
        },

        async resolvePublisherCredentialSecrets(
            projectId: string,
            credentialId: string
        ): Promise<PublisherCredentialSecrets | null> {
            const row = loadCredentialSecretsStatement.get(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(credentialId, 'credentialId')
            )
            if (row === null || row.state !== 'active') return null

            const accessToken = envelopeFromRow(row, 'access_token')
            if (accessToken === null) {
                throw new Error('Active publisher credential has no access token')
            }
            const refreshToken = envelopeFromRow(row, 'refresh_token')
            const providerSession = envelopeFromRow(row, 'provider_session')
            const context = { recordId: row.id, providerId: row.providerId } as const

            return {
                accessToken: await cipher.decrypt(
                    { ...context, field: 'access_token' },
                    accessToken
                ),
                refreshToken:
                    refreshToken === null
                        ? null
                        : await cipher.decrypt(
                              { ...context, field: 'refresh_token' },
                              refreshToken
                          ),
                providerSession:
                    providerSession === null
                        ? null
                        : await cipher.decrypt(
                              { ...context, field: 'provider_session' },
                              providerSession
                          ),
            }
        },

        async replacePublisherCredentialTokens(
            input: ReplacePublisherCredentialTokensInput
        ): Promise<ReplacePublisherCredentialTokensResult> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const credentialId = requireNonBlank(input.credentialId, 'credentialId')
            const expiresAt =
                input.expiresAt === null ? null : requireTimestamp(input.expiresAt, 'expiresAt')
            const row = loadCredentialSecretsStatement.get(projectId, credentialId)
            if (row === null) return { kind: 'not_found' }
            const scopesJson =
                input.scopes === undefined
                    ? row.scopesJson
                    : JSON.stringify(
                          [
                              ...new Set(
                                  input.scopes.map(scope => requireNonBlank(scope, 'scope'))
                              ),
                          ].sort()
                      )

            let refreshTokenValue = input.refreshToken
            if (refreshTokenValue === undefined) {
                const existingRefreshToken = envelopeFromRow(row, 'refresh_token')
                refreshTokenValue =
                    existingRefreshToken === null
                        ? null
                        : await cipher.decrypt(
                              {
                                  recordId: row.id,
                                  providerId: row.providerId,
                                  field: 'refresh_token',
                              },
                              existingRefreshToken
                          )
            }

            let providerSessionValue = input.providerSession
            if (providerSessionValue === undefined) {
                const existingProviderSession = envelopeFromRow(row, 'provider_session')
                providerSessionValue =
                    existingProviderSession === null
                        ? null
                        : await cipher.decrypt(
                              {
                                  recordId: row.id,
                                  providerId: row.providerId,
                                  field: 'provider_session',
                              },
                              existingProviderSession
                          )
            }

            const accessToken = await cipher.encrypt(
                {
                    recordId: row.id,
                    providerId: row.providerId,
                    field: 'access_token',
                },
                input.accessToken
            )
            const refreshToken =
                refreshTokenValue === null
                    ? null
                    : await cipher.encrypt(
                          {
                              recordId: row.id,
                              providerId: row.providerId,
                              field: 'refresh_token',
                          },
                          refreshTokenValue
                      )
            const providerSession =
                providerSessionValue === null
                    ? null
                    : await cipher.encrypt(
                          {
                              recordId: row.id,
                              providerId: row.providerId,
                              field: 'provider_session',
                          },
                          providerSessionValue
                      )
            const timestamp = requireTimestamp(now(), 'now')
            const result = replaceTokensStatement.run(
                accessToken.version,
                accessToken.keyId,
                accessToken.ciphertext,
                accessToken.nonce,
                refreshToken?.ciphertext ?? null,
                refreshToken?.nonce ?? null,
                providerSession?.ciphertext ?? null,
                providerSession?.nonce ?? null,
                expiresAt,
                scopesJson,
                input.providerApplicationId === undefined
                    ? row.providerApplicationId
                    : input.providerApplicationId,
                timestamp,
                projectId,
                credentialId,
                row.revision
            )
            if (result.changes !== 1) return { kind: 'conflict' }

            const updated = loadCredentialMetadataStatement.get(projectId, credentialId)
            if (updated === null) return { kind: 'not_found' }
            return { kind: 'updated', credential: toCredential(updated) }
        },

        markPublisherCredentialReconnectRequired(
            projectId: string,
            credentialId: string
        ): PublisherCredential | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedCredentialId = requireNonBlank(credentialId, 'credentialId')
            markReconnectRequiredStatement.run(
                requireTimestamp(now(), 'now'),
                normalizedProjectId,
                normalizedCredentialId
            )
            const row = loadCredentialMetadataStatement.get(
                normalizedProjectId,
                normalizedCredentialId
            )
            return row === null ? null : toCredential(row)
        },

        revokePublisherCredential(
            projectId: string,
            credentialId: string
        ): PublisherCredential | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedCredentialId = requireNonBlank(credentialId, 'credentialId')
            revokeCredentialStatement.run(
                requireTimestamp(now(), 'now'),
                normalizedProjectId,
                normalizedCredentialId
            )
            const row = loadCredentialMetadataStatement.get(
                normalizedProjectId,
                normalizedCredentialId
            )
            return row === null ? null : toCredential(row)
        },

        revokePublisherCredentialIfUnreferenced(projectId: string, credentialId: string): void {
            revokeUnreferencedCredentialStatement.run(
                requireTimestamp(now(), 'now'),
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(credentialId, 'credentialId')
            )
        },
    }
}
