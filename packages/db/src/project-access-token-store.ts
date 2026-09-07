import { createHash, randomBytes } from 'node:crypto'

import { DomainInvariantError, requireNonBlank, requireTimestamp } from '@herald/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type HeraldDatabase,
} from './client'

const tokenPrefix = 'herald_pat_v1_'
const tokenEntropyBytes = 32
const tokenNameLimit = 100

interface ProjectAccessTokenRow {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly tokenPrefix: string
    readonly expiresAt: number | null
    readonly revokedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface AuthenticatedProjectAccessTokenRow {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly subjectId: string
    readonly displayName: string
}

export interface ProjectAccessToken {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly tokenPrefix: string
    readonly expiresAt: number | null
    readonly revokedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface CreatedProjectAccessToken {
    readonly accessToken: ProjectAccessToken
    /** The plaintext secret is available only in the creation result. */
    readonly token: string
}

export interface CreateProjectAccessTokenInput {
    readonly projectId: string
    readonly subjectId: string
    readonly name: string
    readonly expiresAt?: number | null
}

export interface RevokeProjectAccessTokenInput {
    readonly projectId: string
    readonly subjectId: string
    readonly tokenId: string
}

export interface ProjectAccessTokenStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
    readonly createToken?: () => string
}

export type ProjectAccessTokenAuthentication = AuthenticatedProjectAccessTokenRow

function createOpaqueToken(): string {
    return `${tokenPrefix}${randomBytes(tokenEntropyBytes).toString('base64url')}`
}

function hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex')
}

function normalizeTokenName(name: string): string {
    const normalized = requireNonBlank(name, 'name')
    if (normalized.length > tokenNameLimit) {
        throw new DomainInvariantError(
            'invalid_input',
            `name must not be longer than ${tokenNameLimit} characters`
        )
    }
    return normalized
}

function normalizeExpiry(expiresAt: number | null | undefined, now: number): number | null {
    if (expiresAt === null || expiresAt === undefined) return null

    const normalized = requireTimestamp(expiresAt, 'expiresAt')
    if (normalized <= now) {
        throw new DomainInvariantError('invalid_time', 'expiresAt must be after now')
    }
    return normalized
}

function toProjectAccessToken(row: ProjectAccessTokenRow): ProjectAccessToken {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        tokenPrefix: row.tokenPrefix,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function createProjectAccessTokenStore(
    database: HeraldDatabase,
    options: ProjectAccessTokenStoreOptions = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const createToken = options.createToken ?? createOpaqueToken

    const loadHumanActorStatement = client.query<
        { readonly id: string },
        [projectId: string, subjectId: string]
    >(`
        select id
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind = 'human'
        limit 1
    `)
    const loadTokenStatement = client.query<
        ProjectAccessTokenRow,
        [projectId: string, tokenId: string]
    >(`
        select id,
               project_id as projectId,
               name,
               token_prefix as tokenPrefix,
               expires_at as expiresAt,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_access_tokens
        where project_id = ?1
          and id = ?2
    `)
    const listTokensStatement = client.query<ProjectAccessTokenRow, [projectId: string]>(`
        select id,
               project_id as projectId,
               name,
               token_prefix as tokenPrefix,
               expires_at as expiresAt,
               revoked_at as revokedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_access_tokens
        where project_id = ?1
        order by created_at desc, id desc
    `)
    const authenticateTokenStatement = client.query<
        AuthenticatedProjectAccessTokenRow,
        [tokenHash: string, now: number]
    >(`
        select access_tokens.id,
               access_tokens.project_id as projectId,
               access_tokens.actor_id as actorId,
               actors.subject_id as subjectId,
               actors.display_name as displayName
        from project_access_tokens as access_tokens
        inner join actors
            on actors.project_id = access_tokens.project_id
           and actors.id = access_tokens.actor_id
           and actors.kind = 'api_token'
           and actors.subject_id is not null
        where access_tokens.token_hash = ?1
          and access_tokens.revoked_at is null
          and (access_tokens.expires_at is null or access_tokens.expires_at > ?2)
        limit 1
    `)
    const insertActorStatement = client.query<
        void,
        [id: string, projectId: string, subjectId: string, displayName: string, now: number]
    >(`
        insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, 'api_token', ?3, ?4, ?5, ?5)
    `)
    const insertTokenStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            name: string,
            prefix: string,
            hash: string,
            expiresAt: number | null,
            createdByActorId: string,
            now: number,
        ]
    >(`
        insert into project_access_tokens (
            id,
            project_id,
            actor_id,
            name,
            token_prefix,
            token_hash,
            expires_at,
            created_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    `)
    const updateTokenRevocationStatement = client.query<
        { readonly changes: number },
        [revokedAt: number, updatedAt: number, projectId: string, tokenId: string]
    >(`
        update project_access_tokens
        set revoked_at = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
          and revoked_at is null
    `)
    const insertAuditEventStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: string,
            entityType: string,
            entityId: string,
            metadataJson: string,
            createdAt: number,
        ]
    >(`
        insert into audit_events (
            id,
            project_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata_json,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)

    const createTokenTransaction = createDatabaseTransaction(
        database,
        (input: CreateProjectAccessTokenInput): CreatedProjectAccessToken | null => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = loadHumanActorStatement.get(projectId, subjectId)
            if (actor === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const name = normalizeTokenName(input.name)
            const expiresAt = normalizeExpiry(input.expiresAt, timestamp)
            const id = requireNonBlank(createId(), 'tokenId')
            const actorId = requireNonBlank(createId(), 'actorId')
            const token = requireNonBlank(createToken(), 'token')
            const prefix = token.slice(0, Math.min(token.length, tokenPrefix.length + 12))
            const tokenActorSubjectId = `api-token:${id}`
            const displayName = `API token: ${name}`

            insertActorStatement.run(
                actorId,
                projectId,
                tokenActorSubjectId,
                displayName,
                timestamp
            )
            insertTokenStatement.run(
                id,
                projectId,
                actorId,
                name,
                prefix,
                hashToken(token),
                expiresAt,
                actor.id,
                timestamp
            )
            recordDatabaseCommitProject(database, projectId)
            insertAuditEventStatement.run(
                requireNonBlank(createId(), 'auditEventId'),
                projectId,
                actor.id,
                'project.access_token.created',
                'access_token',
                id,
                JSON.stringify({ name, tokenPrefix: prefix, expiresAt }),
                timestamp
            )

            return {
                accessToken: {
                    id,
                    projectId,
                    name,
                    tokenPrefix: prefix,
                    expiresAt,
                    revokedAt: null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                token,
            }
        }
    )

    const revokeTokenTransaction = createDatabaseTransaction(
        database,
        (input: RevokeProjectAccessTokenInput): ProjectAccessToken | null => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const tokenId = requireNonBlank(input.tokenId, 'tokenId')
            const actor = loadHumanActorStatement.get(projectId, subjectId)
            if (actor === null) return null

            const current = loadTokenStatement.get(projectId, tokenId)
            if (current === null) return null
            if (current.revokedAt !== null) return toProjectAccessToken(current)

            const timestamp = requireTimestamp(now(), 'now')
            const revokedAt = Math.max(timestamp, current.createdAt)
            const updated = updateTokenRevocationStatement.run(
                revokedAt,
                revokedAt,
                projectId,
                tokenId
            )
            if (updated.changes !== 1) {
                const latest = loadTokenStatement.get(projectId, tokenId)
                return latest === null ? null : toProjectAccessToken(latest)
            }

            recordDatabaseCommitProject(database, projectId)
            insertAuditEventStatement.run(
                requireNonBlank(createId(), 'auditEventId'),
                projectId,
                actor.id,
                'project.access_token.revoked',
                'access_token',
                tokenId,
                JSON.stringify({ tokenPrefix: current.tokenPrefix }),
                revokedAt
            )

            const revoked = loadTokenStatement.get(projectId, tokenId)
            return revoked === null ? null : toProjectAccessToken(revoked)
        }
    )

    return {
        authenticate(token: string): ProjectAccessTokenAuthentication | null {
            if (token.length === 0) return null

            const timestamp = requireTimestamp(now(), 'now')
            return authenticateTokenStatement.get(hashToken(token), timestamp)
        },

        create(input: CreateProjectAccessTokenInput): CreatedProjectAccessToken | null {
            return createTokenTransaction.immediate(input)
        },

        list(projectId: string, subjectId: string): readonly ProjectAccessToken[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (loadHumanActorStatement.get(normalizedProjectId, normalizedSubjectId) === null) {
                return null
            }

            return listTokensStatement.all(normalizedProjectId).map(toProjectAccessToken)
        },

        revoke(input: RevokeProjectAccessTokenInput): ProjectAccessToken | null {
            return revokeTokenTransaction.immediate(input)
        },
    }
}

export type ProjectAccessTokenStore = ReturnType<typeof createProjectAccessTokenStore>
