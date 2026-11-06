import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type CompleteExternalEffectInput,
    type ExternalEffectExecutorStore,
    type ProviderCommentPolicy,
} from '@postdot/core'

import { createAccessStore } from './access-store'
import { defineTransaction, type DatabaseHandle } from './client'
import { createEventJournalStore } from './event-journal-store'
import { jsonExtractTextSql } from './sql/dialect'
import type { SqlDialect } from './sql/port'

/** Longest relative delay a prepared comment may wait after parent confirmation. */
export const firstCommentMaximumDelaySeconds = 604_800
const editableStates = ['waiting', 'pending', 'suspended'] as const

/** Persisted provider identities are accepted only through the installed policy registry. */
export type PublicationFirstCommentProvider = string
export interface PublicationFirstCommentStoreOptions {
    readonly policies: readonly ProviderCommentPolicy[]
}

/**
 * Lifecycle of a prepared first comment.
 *
 * `waiting` means the parent publication is not confirmed yet, `pending` means
 * the comment is armed against an exact parent receipt, `running` means a
 * worker claimed it, `suspended` means the enabling editor lost access, and
 * the remaining states are terminal outcomes of the send itself.
 */
export const publicationFirstCommentStates = [
    'waiting',
    'pending',
    'running',
    'suspended',
    'sent',
    'failed',
    'ambiguous',
    'cancelled',
] as const
export type PublicationFirstCommentState = (typeof publicationFirstCommentStates)[number]

/** A `publication_first_comments` row. */
export interface PublicationFirstComment {
    id: string
    projectId: string
    publicationId: string
    actorId: string
    text: string
    delaySeconds: number
    state: PublicationFirstCommentState
    providerId: string
    instanceOrigin: string | null
    revision: number
    dueAt: number | null
    rootUri: string | null
    executionRevisionId: string | null
    connectionId: string | null
    credentialId: string | null
    accountId: string | null
    recordKey: string
    attempts: number
    claimToken: string | null
    leaseExpiresAt: number | null
    effectStartedAt: number | null
    externalId: string | null
    externalUrl: string | null
    lastError: string | null
    createdAt: number
    updatedAt: number
}

export interface SavePublicationFirstCommentInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly text: string
    readonly delaySeconds: number
    readonly expectedRevision: number
    readonly recordKey: string
    readonly now: number
}

export interface CancelPublicationFirstCommentInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly expectedRevision: number
    readonly now: number
}

export type PublicationFirstCommentMutation =
    | { readonly kind: 'saved'; readonly firstComment: PublicationFirstComment }
    | { readonly kind: 'conflict' }
    | { readonly kind: 'not_found' }

/**
 * Public projection of a prepared comment. It deliberately omits the record
 * key, the pinned receipt and the credential identity.
 */
export interface PublicationFirstCommentView {
    readonly id: string
    readonly text: string
    readonly delaySeconds: number
    readonly state: PublicationFirstCommentState
    readonly revision: number
    readonly dueAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
    readonly externalUrl: string | null
    readonly lastError: string | null
    readonly authorName: string
}

interface PublicationRow {
    readonly id: string
    readonly projectId: string
    readonly channelId: string
    readonly state: string
    readonly deliveryMode: string
    readonly publishedAt: number | null
    readonly externalId: string | null
    readonly externalUrl: string | null
}

/**
 * A native parent receipt, recognized from the publication and its succeeded
 * delivery job only. It deliberately does not depend on the current
 * publisher connection: the receipt stays a fact even when the connection that
 * produced it is gone.
 */
interface NativeReceiptRow {
    readonly executionRevisionId: string
    readonly externalId: string | null
    readonly publishedAt: number
}

/** The publisher identity currently able to act for a channel. */
interface ReceiptIdentityRow {
    readonly connectionId: string
    readonly endpointUrl: string | null
    readonly credentialId: string
    readonly accountId: string
    readonly scopes: string
    readonly credentialState: string
}

/** The pinned execution, revalidated against its succeeded job and profile. */
interface PinnedReceiptRow {
    readonly executionRevisionId: string
    readonly externalId: string | null
    readonly publishedAt: number | null
}

interface CredentialRow {
    readonly id: string
    readonly providerId: string
    readonly externalAccountId: string
    readonly scopes: string
    readonly state: string
}

interface ConnectionRow {
    readonly id: string
    readonly publisherId: string
    readonly credentialId: string
    readonly endpointUrl: string | null
}

interface PublisherRow {
    readonly id: string
    readonly channelId: string
    readonly kind: string
}

interface FirstCommentActorRow {
    readonly id: string
    readonly subjectId: string | null
    readonly displayName: string
}

const firstCommentColumns = `
    id,
    project_id as "projectId",
    publication_id as "publicationId",
    actor_id as "actorId",
    text,
    delay_seconds as "delaySeconds",
    state,
    provider_id as "providerId",
    instance_origin as "instanceOrigin",
    revision,
    due_at as "dueAt",
    root_uri as "rootUri",
    execution_revision_id as "executionRevisionId",
    connection_id as "connectionId",
    credential_id as "credentialId",
    account_id as "accountId",
    record_key as "recordKey",
    attempts,
    claim_token as "claimToken",
    lease_expires_at as "leaseExpiresAt",
    effect_started_at as "effectStartedAt",
    external_id as "externalId",
    external_url as "externalUrl",
    last_error as "lastError",
    created_at as "createdAt",
    updated_at as "updatedAt"
`

/**
 * A native parent receipt exists only when the publication was delivered by a
 * succeeded automatic job whose completion is the recorded publication time,
 * and the executed profile is the built-in contract of the pinned provider.
 *
 * The proof never joins the publisher connection. The receipt is a property of
 * the publication, so removing a connection cannot hide a delivery that already
 * happened.
 */
function buildNativeReceiptProof(dialect: SqlDialect): string {
    return `
        exists (
            select 1
            from publications as proof_publications
            inner join jobs as proof_jobs
                on proof_jobs.project_id = proof_publications.project_id
               and proof_jobs.publication_id = proof_publications.id
               and proof_jobs.state = 'succeeded'
               and proof_jobs.completed_at = proof_publications.published_at
            inner join publication_execution_revisions as proof_executions
                on proof_executions.project_id = proof_jobs.project_id
               and proof_executions.job_id = proof_jobs.id
               and proof_executions.publication_id = proof_publications.id
               and proof_executions.delivery_mode = 'automatic'
            inner join project_channel_profile_contexts as proof_profiles
                on proof_profiles.project_id = proof_executions.project_id
               and proof_profiles.id = proof_executions.profile_version_id
            where proof_publications.project_id = publication_first_comments.project_id
              and proof_publications.id = publication_first_comments.publication_id
              and proof_publications.state = 'published'
              and proof_publications.delivery_mode = 'automatic'
              and proof_publications.published_at is not null
              and proof_profiles.state <> 'disabled'
              and proof_profiles.origin = 'built_in'
              and ${jsonExtractTextSql(dialect, 'proof_profiles.profile_json', ['execution', 'kind'])} = 'built_in'
              and ${jsonExtractTextSql(dialect, 'proof_profiles.profile_json', ['execution', 'contractId'])} = publication_first_comments.provider_id
        )
    `
}

export function createPublicationFirstCommentStore(
    database: DatabaseHandle,
    options: PublicationFirstCommentStoreOptions
) {
    const db = database.sql
    const dialect = db.dialect
    const access = createAccessStore(database)
    const journal = createEventJournalStore(database)
    const nativeReceiptProof = buildNativeReceiptProof(dialect)

    const loadPublicationStatement = db.statement<PublicationRow, [string, string]>(`
        select id,
               project_id as "projectId",
               channel_id as "channelId",
               state,
               delivery_mode as "deliveryMode",
               published_at as "publishedAt",
               external_id as "externalId",
               external_url as "externalUrl"
        from publications
        where project_id = ?1
          and id = ?2
    `)
    const loadNativeReceiptStatement = db.statement<NativeReceiptRow, [string, string, string]>(`
        select proof_executions.id as "executionRevisionId",
               proof_publications.external_id as "externalId",
               proof_publications.published_at as "publishedAt"
        from publications as proof_publications
        inner join jobs as proof_jobs
            on proof_jobs.project_id = proof_publications.project_id
           and proof_jobs.publication_id = proof_publications.id
           and proof_jobs.state = 'succeeded'
           and proof_jobs.completed_at = proof_publications.published_at
        inner join publication_execution_revisions as proof_executions
            on proof_executions.project_id = proof_jobs.project_id
           and proof_executions.job_id = proof_jobs.id
           and proof_executions.publication_id = proof_publications.id
           and proof_executions.delivery_mode = 'automatic'
        inner join project_channel_profile_contexts as proof_profiles
            on proof_profiles.project_id = proof_executions.project_id
           and proof_profiles.id = proof_executions.profile_version_id
        where proof_publications.project_id = ?1
          and proof_publications.id = ?2
          and proof_publications.state = 'published'
          and proof_publications.delivery_mode = 'automatic'
          and proof_publications.published_at is not null
          and proof_profiles.state <> 'disabled'
          and proof_profiles.origin = 'built_in'
          and ${jsonExtractTextSql(dialect, 'proof_profiles.profile_json', ['execution', 'kind'])} = 'built_in'
          and ${jsonExtractTextSql(dialect, 'proof_profiles.profile_json', ['execution', 'contractId'])} = ?3
        order by proof_jobs.completed_at desc, proof_executions.created_at desc
        limit 1
    `)
    const loadReceiptIdentityStatement = db.statement<
        ReceiptIdentityRow,
        [string, string, string]
    >(`
        select proof_connections.id as "connectionId",
               proof_connections.endpoint_url as "endpointUrl",
               proof_credentials.id as "credentialId",
               proof_credentials.external_account_id as "accountId",
               proof_credentials.scopes as scopes,
               proof_credentials.state as "credentialState"
        from project_publisher_contexts as proof_publishers
        inner join project_publisher_connection_contexts as proof_connections
            on proof_connections.project_id = proof_publishers.project_id
           and proof_connections.publisher_id = proof_publishers.id
        inner join project_publisher_credential_contexts as proof_credentials
            on proof_credentials.project_id = proof_connections.project_id
           and proof_credentials.id = proof_connections.credential_id
           and proof_credentials.provider_id = ?3
        where proof_publishers.project_id = ?1
          and proof_publishers.channel_id = ?2
          and proof_publishers.kind = ?3
    `)
    const loadPinnedReceiptStatement = db.statement<
        PinnedReceiptRow,
        [string, string, string, string]
    >(`
        select proof_executions.id as "executionRevisionId",
               proof_publications.external_id as "externalId",
               proof_publications.published_at as "publishedAt"
        from publication_execution_revisions as proof_executions
        inner join jobs as proof_jobs
            on proof_jobs.project_id = proof_executions.project_id
           and proof_jobs.id = proof_executions.job_id
           and proof_jobs.state = 'succeeded'
        inner join publications as proof_publications
            on proof_publications.project_id = proof_executions.project_id
           and proof_publications.id = proof_executions.publication_id
           and proof_publications.state = 'published'
           and proof_publications.published_at = proof_jobs.completed_at
        inner join project_channel_profile_contexts as proof_profiles
            on proof_profiles.project_id = proof_executions.project_id
           and proof_profiles.id = proof_executions.profile_version_id
           and proof_profiles.state <> 'disabled'
           and proof_profiles.origin = 'built_in'
           and ${jsonExtractTextSql(dialect, 'proof_profiles.profile_json', ['execution', 'kind'])} = 'built_in'
           and ${jsonExtractTextSql(dialect, 'proof_profiles.profile_json', ['execution', 'contractId'])} = ?4
        where proof_executions.project_id = ?1
          and proof_executions.id = ?2
          and proof_executions.publication_id = ?3
          and proof_executions.delivery_mode = 'automatic'
    `)
    const loadCredentialStatement = db.statement<CredentialRow, [string, string]>(`
        select id,
               provider_id as "providerId",
               external_account_id as "externalAccountId",
               scopes,
               state
        from project_publisher_credential_contexts as publisher_credentials
        where project_id = ?1
          and id = ?2
    `)
    const loadConnectionStatement = db.statement<ConnectionRow, [string, string]>(`
        select id,
               publisher_id as "publisherId",
               credential_id as "credentialId",
               endpoint_url as "endpointUrl"
        from project_publisher_connection_contexts as publisher_connections
        where project_id = ?1
          and id = ?2
    `)
    const loadPublisherStatement = db.statement<PublisherRow, [string, string]>(`
        select id,
               channel_id as "channelId",
               kind
        from project_publisher_contexts as publishers
        where project_id = ?1
          and id = ?2
    `)
    const nativeChannelProviderStatement = db.statement<
        { readonly contractId: string },
        [string, string]
    >(`
        select ${jsonExtractTextSql(dialect, 'channel_profile_versions.profile_json', ['execution', 'contractId'])} as "contractId"
        from project_channel_contexts as channels
        inner join project_channel_profile_contexts as channel_profile_versions
            on channel_profile_versions.project_id = channels.project_id
           and channel_profile_versions.id = channels.profile_version_id
        where channels.project_id = ?1
          and channels.id = ?2
          and channel_profile_versions.state <> 'disabled'
          and channel_profile_versions.origin = 'built_in'
          and ${jsonExtractTextSql(dialect, 'channel_profile_versions.profile_json', ['execution', 'kind'])} = 'built_in'
    `)
    const nextEventStatement = db.statement<{ readonly eventAt: number | null }, [number]>(`
        select min(event_at) as "eventAt"
        from (
            select due_at as event_at
            from publication_first_comments
            where state = 'pending'
              and not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = publication_first_comments.project_id and state <> 'active')
              and due_at is not null
            union all
            select lease_expires_at as event_at
            from publication_first_comments
            where state = 'running'
              and lease_expires_at is not null
            union all
            select ?1 as event_at
            from publication_first_comments
            where state = 'waiting'
              and not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = publication_first_comments.project_id and state <> 'active')
              and ${nativeReceiptProof}
        ) as events
    `)
    const loadFirstCommentStatement = db.statement<
        PublicationFirstComment,
        [projectId: string, publicationId: string]
    >(`
        select ${firstCommentColumns}
        from publication_first_comments
        where project_id = ?1
          and publication_id = ?2
    `)
    const loadFirstCommentByIdStatement = db.statement<PublicationFirstComment, [id: string]>(`
        select ${firstCommentColumns}
        from publication_first_comments
        where id = ?1
    `)
    const loadActorByIdStatement = db.statement<
        FirstCommentActorRow,
        [projectId: string, actorId: string]
    >(`
        select id,
               subject_id as "subjectId",
               display_name as "displayName"
        from actors
        where project_id = ?1
          and id = ?2
    `)
    const loadActorBySubjectStatement = db.statement<
        FirstCommentActorRow,
        [projectId: string, subjectId: string]
    >(`
        select id,
               subject_id as "subjectId",
               display_name as "displayName"
        from actors
        where project_id = ?1
          and subject_id = ?2
        limit 1
    `)
    const transitionFirstCommentStatement = db.statement<
        PublicationFirstComment,
        [
            state: PublicationFirstCommentState,
            dueAt: number | null,
            rootUri: string | null,
            instanceOrigin: string | null,
            executionRevisionId: string | null,
            connectionId: string | null,
            credentialId: string | null,
            accountId: string | null,
            claimToken: string | null,
            leaseExpiresAt: number | null,
            effectStartedAt: number | null,
            externalId: string | null,
            externalUrl: string | null,
            lastError: string | null,
            updatedAt: number,
            id: string,
            expectedState: PublicationFirstCommentState,
        ]
    >(`
        update publication_first_comments
        set state = ?1,
            due_at = ?2,
            root_uri = ?3,
            instance_origin = ?4,
            execution_revision_id = ?5,
            connection_id = ?6,
            credential_id = ?7,
            account_id = ?8,
            claim_token = ?9,
            lease_expires_at = ?10,
            effect_started_at = ?11,
            external_id = ?12,
            external_url = ?13,
            last_error = ?14,
            updated_at = ?15
        where id = ?16
          and state = ?17
        returning ${firstCommentColumns}
    `)
    const listExpiredClaimsStatement = db.statement<PublicationFirstComment, [now: number]>(`
        select ${firstCommentColumns}
        from publication_first_comments
        where state = 'running'
          and lease_expires_at <= ?1
    `)
    const selectNextDueCommentStatement = db.statement<
        PublicationFirstComment,
        [now: number, projectId: string | null]
    >(`
        select ${firstCommentColumns}
        from publication_first_comments
        where state = 'pending'
          and not exists (
              select 1
              from resource_lifecycles
              where kind = 'project'
                and resource_id = publication_first_comments.project_id
                and state <> 'active'
          )
          and due_at <= ?1
          and (cast(?2 as text) is null or project_id = ?2)
        order by due_at asc, id asc
        limit 1
    `)
    const claimPendingCommentStatement = db.statement<
        PublicationFirstComment,
        [
            attempts: number,
            claimToken: string,
            leaseExpiresAt: number,
            updatedAt: number,
            id: string,
        ]
    >(`
        update publication_first_comments
        set state = 'running',
            attempts = ?1,
            claim_token = ?2,
            lease_expires_at = ?3,
            effect_started_at = null,
            updated_at = ?4
        where id = ?5
          and state = 'pending'
        returning ${firstCommentColumns}
    `)
    const renewClaimStatement = db.statement<
        { readonly id: string },
        [leaseExpiresAt: number, id: string, claimToken: string, now: number]
    >(`
        update publication_first_comments
        set lease_expires_at = ?1
        where id = ?2
          and claim_token = ?3
          and state = 'running'
          and lease_expires_at > ?4
          and lease_expires_at <= ?1
        returning id
    `)
    const insertFirstCommentStatement = db.statement<
        void,
        [
            id: string,
            projectId: string,
            publicationId: string,
            actorId: string,
            text: string,
            delaySeconds: number,
            state: PublicationFirstCommentState,
            providerId: string,
            instanceOrigin: string | null,
            revision: number,
            dueAt: number | null,
            rootUri: string | null,
            executionRevisionId: string | null,
            connectionId: string | null,
            credentialId: string | null,
            accountId: string | null,
            recordKey: string,
            attempts: number,
            claimToken: string | null,
            leaseExpiresAt: number | null,
            effectStartedAt: number | null,
            externalId: string | null,
            externalUrl: string | null,
            lastError: string | null,
            createdAt: number,
            updatedAt: number,
        ]
    >(`
        insert into publication_first_comments (
            id,
            project_id,
            publication_id,
            actor_id,
            text,
            delay_seconds,
            state,
            provider_id,
            instance_origin,
            revision,
            due_at,
            root_uri,
            execution_revision_id,
            connection_id,
            credential_id,
            account_id,
            record_key,
            attempts,
            claim_token,
            lease_expires_at,
            effect_started_at,
            external_id,
            external_url,
            last_error,
            created_at,
            updated_at
        ) values (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
        )
    `)
    const updateSavedCommentStatement = db.statement<
        PublicationFirstComment,
        [
            text: string,
            delaySeconds: number,
            actorId: string,
            state: PublicationFirstCommentState,
            dueAt: number | null,
            nextRevision: number,
            updatedAt: number,
            id: string,
            expectedRevision: number,
        ]
    >(`
        update publication_first_comments
        set text = ?1,
            delay_seconds = ?2,
            actor_id = ?3,
            state = ?4,
            due_at = ?5,
            revision = ?6,
            updated_at = ?7,
            last_error = null
        where id = ?8
          and revision = ?9
          and state in ('waiting', 'pending', 'suspended')
        returning ${firstCommentColumns}
    `)
    const cancelFirstCommentStatement = db.statement<
        PublicationFirstComment,
        [nextRevision: number, updatedAt: number, id: string, expectedRevision: number]
    >(`
        update publication_first_comments
        set state = 'cancelled',
            claim_token = null,
            lease_expires_at = null,
            revision = ?1,
            updated_at = ?2,
            last_error = null
        where id = ?3
          and revision = ?4
          and state in ('waiting', 'pending', 'suspended')
        returning ${firstCommentColumns}
    `)
    const listReconcilableCommentsStatement = db.statement<PublicationFirstComment, []>(`
        select ${firstCommentColumns}
        from publication_first_comments
        where state in ('waiting', 'pending')
        order by created_at asc, id asc
    `)

    const row = (projectId: string, publicationId: string) =>
        loadFirstCommentStatement.get(projectId, publicationId)
    const rowById = (id: string) => loadFirstCommentByIdStatement.get(id)
    const actorOf = (rowValue: PublicationFirstComment) =>
        loadActorByIdStatement.get(rowValue.projectId, rowValue.actorId)
    const actorForSubject = (projectId: string, subjectId: string) =>
        loadActorBySubjectStatement.get(projectId, subjectId)

    async function hasEditorAccess(projectId: string, actorId: string): Promise<boolean> {
        const actor = await loadActorByIdStatement.get(projectId, actorId)
        if (actor === null || actor.subjectId === null) return false
        return access.canAccessProject(projectId, actor.subjectId, 'editor')
    }

    /**
     * The provider that publishes a channel natively, or null when the channel
     * has no explicit built-in execution contract.
     */
    async function nativeProviderForChannel(
        projectId: string,
        channelId: string
    ): Promise<PublicationFirstCommentProvider | null> {
        const contractId = (await nativeChannelProviderStatement.get(projectId, channelId))
            ?.contractId
        return options.policies.find(policy => policy.id === contractId)?.id ?? null
    }

    async function event(
        rowValue: PublicationFirstComment,
        name: string,
        at: number,
        payload: Readonly<Record<string, unknown>> = {}
    ): Promise<void> {
        await journal.append({
            projectId: rowValue.projectId,
            actorId: rowValue.actorId,
            name,
            version: 1,
            subject: { type: 'publication_first_comment', id: rowValue.id },
            payload: {
                publicationId: rowValue.publicationId,
                state: rowValue.state,
                revision: rowValue.revision,
                delaySeconds: rowValue.delaySeconds,
                ...payload,
            },
            occurredAt: at,
        })
    }

    /**
     * Reports why a prepared comment can no longer run under its pinned
     * identity. The reasons are safe to show to an operator: they never carry
     * provider payloads or internal identifiers.
     *
     * The check revalidates the exact receipt that armed the comment: the
     * pinned execution must still be the succeeded automatic delivery of the
     * parent, and the parent must still expose the pinned root. A parent that
     * was reconciled or re-published under another receipt is rejected instead
     * of being followed.
     *
     * A Mastodon comment is pinned to the instance that published the parent,
     * so its account identifier is only meaningful together with that
     * instance: the connection must still point at the pinned origin and the
     * credential must still be allowed to write statuses.
     */
    async function identityFailureReason(
        rowValue: PublicationFirstComment
    ): Promise<string | null> {
        const publication = await loadPublicationStatement.get(
            rowValue.projectId,
            rowValue.publicationId
        )
        if (publication === null) return 'The parent publication is no longer available'
        if (publication.state !== 'published') {
            return 'The parent publication is no longer published'
        }
        if (
            rowValue.executionRevisionId === null ||
            rowValue.rootUri === null ||
            rowValue.connectionId === null ||
            rowValue.credentialId === null ||
            rowValue.accountId === null
        ) {
            return 'The confirmed publication receipt is incomplete'
        }
        const policy = options.policies.find(candidate => candidate.id === rowValue.providerId)
        if (!policy) return 'The original provider is no longer available'
        if (policy.requiresInstanceOrigin && rowValue.instanceOrigin === null) {
            return 'The confirmed publication receipt is incomplete'
        }
        const receipt = await loadPinnedReceiptStatement.get(
            rowValue.projectId,
            rowValue.executionRevisionId,
            rowValue.publicationId,
            rowValue.providerId
        )
        if (receipt === null || receipt.publishedAt !== publication.publishedAt) {
            return 'The confirmed publication receipt is no longer available'
        }
        const currentParent = policy.resolveParent({
            externalId: publication.externalId,
            externalUrl: publication.externalUrl,
            receiptExternalId: publication.externalId,
        })
        if (
            !currentParent ||
            currentParent.rootUri !== rowValue.rootUri ||
            currentParent.instanceOrigin !== rowValue.instanceOrigin
        )
            return 'The confirmed parent publication changed'
        const credential = await loadCredentialStatement.get(
            rowValue.projectId,
            rowValue.credentialId
        )
        if (
            credential === null ||
            credential.providerId !== rowValue.providerId ||
            credential.externalAccountId !== rowValue.accountId ||
            credential.state !== 'active'
        ) {
            return 'The original account is no longer available'
        }
        const connection = await loadConnectionStatement.get(
            rowValue.projectId,
            rowValue.connectionId
        )
        if (connection === null || connection.credentialId !== rowValue.credentialId) {
            return 'The original connection is no longer available'
        }
        const publisher = await loadPublisherStatement.get(
            rowValue.projectId,
            connection.publisherId
        )
        if (
            publisher === null ||
            publisher.kind !== rowValue.providerId ||
            publisher.channelId !== publication.channelId
        ) {
            return 'The original connection is no longer available'
        }
        const failure = policy.identityFailure(currentParent, {
            accountId: rowValue.accountId,
            endpointUrl: connection.endpointUrl,
            scopes: credential.scopes,
        })
        if (failure === 'connection') return 'The original connection is no longer available'
        if (failure === 'authorization') return 'The original account is no longer available'
        if (failure === 'account')
            return 'The confirmed publication does not belong to the connected account'

        return null
    }

    async function transition(
        rowValue: PublicationFirstComment,
        values: Partial<PublicationFirstComment>,
        name: string,
        at: number,
        payload: Readonly<Record<string, unknown>> = {}
    ): Promise<PublicationFirstComment | null> {
        const next: PublicationFirstComment = { ...rowValue, ...values }
        const updated = await transitionFirstCommentStatement.get(
            next.state,
            next.dueAt,
            next.rootUri,
            next.instanceOrigin,
            next.executionRevisionId,
            next.connectionId,
            next.credentialId,
            next.accountId,
            next.claimToken,
            next.leaseExpiresAt,
            next.effectStartedAt,
            next.externalId,
            next.externalUrl,
            next.lastError,
            next.updatedAt,
            rowValue.id,
            rowValue.state
        )
        if (updated === null) return null
        await event(updated, name, at, payload)
        return updated
    }

    const deliveries: ExternalEffectExecutorStore<PublicationFirstComment> = {
        recoverExpiredClaims(now) {
            return defineTransaction(database, async () => {
                const expired = await listExpiredClaimsStatement.all(now)
                const requeuedJobIds: string[] = [],
                    ambiguousJobIds: string[] = []
                for (const expiredRow of expired) {
                    const uncertain = expiredRow.effectStartedAt !== null
                    const updated = await transition(
                        expiredRow,
                        {
                            state: uncertain ? 'ambiguous' : 'pending',
                            claimToken: null,
                            leaseExpiresAt: null,
                            updatedAt: now,
                            lastError: uncertain
                                ? 'The process stopped before the comment outcome was confirmed'
                                : null,
                        },
                        uncertain
                            ? 'publication_first_comment.ambiguous'
                            : 'publication_first_comment.recovered',
                        now,
                        { attempts: expiredRow.attempts }
                    )
                    if (updated === null) continue
                    ;(uncertain ? ambiguousJobIds : requeuedJobIds).push(expiredRow.id)
                }
                return { requeuedJobIds, ambiguousJobIds }
            })()
        },
        claimNextDueJob(input) {
            return defineTransaction(database, async () => {
                const due = await selectNextDueCommentStatement.get(
                    input.now,
                    input.projectId ?? null
                )
                if (due === null) return null
                return claimPendingCommentStatement.get(
                    due.attempts + 1,
                    input.claimToken,
                    input.leaseExpiresAt,
                    input.now,
                    due.id
                )
            })()
        },
        async renewClaim(input) {
            const at = requireTimestamp(input.now, 'now')
            const expiry = requireTimestamp(input.leaseExpiresAt, 'leaseExpiresAt')
            if (expiry <= at) return false
            return (
                (await renewClaimStatement.get(
                    expiry,
                    requireNonBlank(input.jobId, 'jobId'),
                    requireNonBlank(input.claimToken, 'claimToken'),
                    at
                )) !== null
            )
        },
        startExternalEffect(jobId, claimToken, now) {
            return defineTransaction(database, async () => {
                const running = await rowById(jobId)
                if (
                    running === null ||
                    running.state !== 'running' ||
                    running.claimToken !== claimToken ||
                    running.leaseExpiresAt === null ||
                    running.leaseExpiresAt <= now
                ) {
                    return false
                }
                const failureReason = await identityFailureReason(running)
                if (failureReason !== null) {
                    await transition(
                        running,
                        {
                            state: 'failed',
                            claimToken: null,
                            leaseExpiresAt: null,
                            updatedAt: now,
                            lastError: failureReason,
                        },
                        'publication_first_comment.failed',
                        now
                    )
                    return false
                }
                if (!(await hasEditorAccess(running.projectId, running.actorId))) {
                    await transition(
                        running,
                        {
                            state: 'suspended',
                            claimToken: null,
                            leaseExpiresAt: null,
                            updatedAt: now,
                            lastError: 'The enabling editor no longer has editor access',
                        },
                        'publication_first_comment.suspended',
                        now
                    )
                    return false
                }
                const updated = await transition(
                    running,
                    { effectStartedAt: now, updatedAt: now },
                    'publication_first_comment.started',
                    now
                )
                return updated !== null
            })()
        },
        completeExternalEffect(input: CompleteExternalEffectInput) {
            return defineTransaction(database, async () => {
                const running = await rowById(input.jobId)
                if (
                    running === null ||
                    running.state !== 'running' ||
                    running.claimToken !== input.claimToken
                ) {
                    return null
                }
                const { outcome } = input
                if (outcome.type === 'published') {
                    const updated = await transition(
                        running,
                        {
                            state: 'sent',
                            claimToken: null,
                            leaseExpiresAt: null,
                            updatedAt: input.completedAt,
                            externalId: outcome.externalId ?? null,
                            externalUrl: outcome.externalUrl ?? null,
                            lastError: null,
                        },
                        'publication_first_comment.sent',
                        input.completedAt,
                        { text: running.text, externalId: outcome.externalId ?? null }
                    )
                    return updated === null ? null : 'published'
                }
                if (outcome.type === 'ambiguous') {
                    const updated = await transition(
                        running,
                        {
                            state: 'ambiguous',
                            claimToken: null,
                            leaseExpiresAt: null,
                            updatedAt: input.completedAt,
                            externalId: null,
                            externalUrl: null,
                            lastError: outcome.errorMessage,
                        },
                        'publication_first_comment.ambiguous',
                        input.completedAt,
                        { text: running.text }
                    )
                    return updated === null ? null : 'ambiguous'
                }
                const blocked = !(await hasEditorAccess(running.projectId, running.actorId))
                const updated = await transition(
                    running,
                    {
                        state: blocked ? 'suspended' : 'failed',
                        claimToken: null,
                        leaseExpiresAt: null,
                        updatedAt: input.completedAt,
                        externalId: null,
                        externalUrl: null,
                        lastError: blocked
                            ? 'The enabling editor no longer has editor access'
                            : outcome.errorMessage,
                    },
                    blocked
                        ? 'publication_first_comment.suspended'
                        : 'publication_first_comment.failed',
                    input.completedAt,
                    { text: running.text }
                )
                return updated === null ? null : 'failed'
            })()
        },
    }

    return {
        deliveries,

        async get(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): Promise<PublicationFirstComment | null> {
            if (!(await access.canAccessProject(projectId, subjectId, 'viewer'))) return null
            return row(projectId, publicationId)
        },

        async view(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): Promise<PublicationFirstCommentView | null> {
            return db.transaction(async () => {
                if (!(await access.canAccessProject(projectId, subjectId, 'viewer'))) return null
                const current = await row(projectId, publicationId)
                if (current === null) return null
                return {
                    id: current.id,
                    text: current.text,
                    delaySeconds: current.delaySeconds,
                    state: current.state,
                    revision: current.revision,
                    dueAt: current.dueAt,
                    createdAt: current.createdAt,
                    updatedAt: current.updatedAt,
                    externalUrl: current.externalUrl,
                    lastError: current.lastError,
                    authorName: (await actorOf(current))?.displayName ?? '',
                }
            }, 'immediate')
        },

        async canManage(projectId: string, subjectId: string): Promise<boolean> {
            return access.canAccessProject(projectId, subjectId, 'editor')
        },

        /**
         * A comment can be configured for a native automatic Bluesky or
         * Mastodon publication before delivery, or for a publication that
         * already owns a prepared comment. Terminal and claimed comments are
         * frozen.
         */
        async canConfigure(projectId: string, publicationId: string): Promise<boolean> {
            return db.transaction(async () => {
                const publication = await loadPublicationStatement.get(projectId, publicationId)
                if (publication === null) return false
                const existing = await row(projectId, publicationId)
                if (existing !== null) return isEditableState(existing.state)
                if (publication.deliveryMode !== 'automatic') return false
                if (publication.state !== 'draft' && publication.state !== 'scheduled') return false
                return (await nativeProviderForChannel(projectId, publication.channelId)) !== null
            }, 'deferred')
        },

        /**
         * Saves the prepared comment and explicitly enables it.
         *
         * The revision is a configuration revision: it advances only when an
         * editor changes the configuration (save or cancel) and never when the
         * delivery lifecycle moves the row between states. A client can
         * therefore recognize its own write by `revision === expectedRevision
         * + 1` even when the row has since been armed or suspended, and a
         * duplicated request returns the same row instead of a second
         * configuration.
         *
         * The provider is pinned when the comment is first configured and never
         * changes afterwards: an edit that would move the comment to another
         * provider is refused instead of silently changing what it publishes.
         */
        async save(
            input: SavePublicationFirstCommentInput
        ): Promise<PublicationFirstCommentMutation> {
            return db.transaction(async () => {
                const projectId = requireNonBlank(input.projectId, 'projectId')
                const publicationId = requireNonBlank(input.publicationId, 'publicationId')
                const subjectId = requireNonBlank(input.subjectId, 'subjectId')
                const delaySeconds = normalizeDelaySeconds(input.delaySeconds)
                const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
                const recordKey = requireNonBlank(input.recordKey, 'recordKey')
                const now = requireTimestamp(input.now, 'now')

                return defineTransaction(
                    database,
                    async (): Promise<PublicationFirstCommentMutation> => {
                        const actor = await actorForSubject(projectId, subjectId)
                        if (actor === null) return { kind: 'not_found' }
                        if (!(await access.canAccessProject(projectId, subjectId, 'editor'))) {
                            return { kind: 'not_found' }
                        }
                        const existing = await row(projectId, publicationId)
                        const publication = await loadPublicationStatement.get(
                            projectId,
                            publicationId
                        )
                        const channelProvider =
                            publication === null
                                ? null
                                : await nativeProviderForChannel(projectId, publication.channelId)
                        const providerId = existing?.providerId ?? channelProvider
                        const policy = options.policies.find(
                            candidate => candidate.id === providerId
                        )
                        if (!policy) return { kind: 'conflict' }
                        const text = policy.normalizeText(input.text)
                        if (existing === null) {
                            if (expectedRevision !== 0) return { kind: 'conflict' }
                            if (publication === null) return { kind: 'not_found' }
                            if (
                                publication.deliveryMode !== 'automatic' ||
                                (publication.state !== 'draft' &&
                                    publication.state !== 'scheduled') ||
                                channelProvider === null
                            ) {
                                return { kind: 'conflict' }
                            }
                            const created: PublicationFirstComment = {
                                id: crypto.randomUUID(),
                                projectId,
                                publicationId,
                                actorId: actor.id,
                                text,
                                delaySeconds,
                                state: 'waiting',
                                providerId: channelProvider,
                                instanceOrigin: null,
                                revision: 1,
                                dueAt: null,
                                rootUri: null,
                                executionRevisionId: null,
                                connectionId: null,
                                credentialId: null,
                                accountId: null,
                                recordKey,
                                attempts: 0,
                                claimToken: null,
                                leaseExpiresAt: null,
                                effectStartedAt: null,
                                externalId: null,
                                externalUrl: null,
                                lastError: null,
                                createdAt: now,
                                updatedAt: now,
                            }
                            await insertFirstCommentStatement.run(
                                created.id,
                                created.projectId,
                                created.publicationId,
                                created.actorId,
                                created.text,
                                created.delaySeconds,
                                created.state,
                                created.providerId,
                                created.instanceOrigin,
                                created.revision,
                                created.dueAt,
                                created.rootUri,
                                created.executionRevisionId,
                                created.connectionId,
                                created.credentialId,
                                created.accountId,
                                created.recordKey,
                                created.attempts,
                                created.claimToken,
                                created.leaseExpiresAt,
                                created.effectStartedAt,
                                created.externalId,
                                created.externalUrl,
                                created.lastError,
                                created.createdAt,
                                created.updatedAt
                            )
                            await event(created, 'publication_first_comment.requested', now, {
                                text,
                            })
                            return { kind: 'saved', firstComment: created }
                        }

                        // The provider is pinned: a channel that now publishes with
                        // another provider never moves a prepared comment.
                        if (channelProvider !== null && channelProvider !== existing.providerId) {
                            return { kind: 'conflict' }
                        }

                        const identicalConfiguration =
                            existing.text === text && existing.delaySeconds === delaySeconds
                        const suspended = existing.state === 'suspended'
                        // A retried identical save of an already applied request is the
                        // same request: it returns the current row instead of applying
                        // the configuration twice.
                        if (
                            !suspended &&
                            existing.revision === expectedRevision + 1 &&
                            identicalConfiguration
                        ) {
                            return { kind: 'saved', firstComment: existing }
                        }
                        if (!isEditableState(existing.state)) return { kind: 'conflict' }
                        // Re-enabling requires the current configuration revision: a delayed
                        // duplicate of an earlier request must not silently lift suspension.
                        if (existing.revision !== expectedRevision) return { kind: 'conflict' }

                        const armed = existing.executionRevisionId !== null
                        const dueAt = armed
                            ? computeDueAt(
                                  publication?.publishedAt ?? null,
                                  delaySeconds,
                                  existing.dueAt
                              )
                            : null
                        const updated = await updateSavedCommentStatement.get(
                            text,
                            delaySeconds,
                            actor.id,
                            armed ? 'pending' : 'waiting',
                            dueAt,
                            existing.revision + 1,
                            now,
                            existing.id,
                            existing.revision
                        )
                        if (updated === null) return { kind: 'conflict' }
                        await event(updated, 'publication_first_comment.enabled', now, { text })
                        return { kind: 'saved', firstComment: updated }
                    }
                )()
            }, 'immediate')
        },

        async cancel(
            input: CancelPublicationFirstCommentInput
        ): Promise<PublicationFirstCommentMutation> {
            return db.transaction(async () => {
                const projectId = requireNonBlank(input.projectId, 'projectId')
                const publicationId = requireNonBlank(input.publicationId, 'publicationId')
                const subjectId = requireNonBlank(input.subjectId, 'subjectId')
                const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
                const now = requireTimestamp(input.now, 'now')

                return defineTransaction(
                    database,
                    async (): Promise<PublicationFirstCommentMutation> => {
                        const actor = await actorForSubject(projectId, subjectId)
                        if (actor === null) return { kind: 'not_found' }
                        if (!(await access.canAccessProject(projectId, subjectId, 'editor'))) {
                            return { kind: 'not_found' }
                        }
                        const existing = await row(projectId, publicationId)
                        if (existing === null) return { kind: 'not_found' }
                        if (
                            existing.state === 'cancelled' &&
                            existing.revision === expectedRevision + 1
                        ) {
                            return { kind: 'saved', firstComment: existing }
                        }
                        if (!isEditableState(existing.state)) return { kind: 'conflict' }
                        if (existing.revision !== expectedRevision) return { kind: 'conflict' }
                        const updated = await cancelFirstCommentStatement.get(
                            existing.revision + 1,
                            now,
                            existing.id,
                            expectedRevision
                        )
                        if (updated === null) return { kind: 'conflict' }
                        await event(updated, 'publication_first_comment.cancelled', now)
                        return { kind: 'saved', firstComment: updated }
                    }
                )()
            }, 'deferred')
        },

        /**
         * Reconciles prepared comments against their parent publication.
         *
         * A waiting comment is armed only by a native, automatically delivered
         * parent receipt. A comment whose enabling editor lost access is
         * suspended and never resumes on its own. A comment whose pinned
         * identity no longer exists fails with a safe reason.
         */
        async reconcile(now: number): Promise<void> {
            const timestamp = requireTimestamp(now, 'now')
            await defineTransaction(database, async () => {
                const rows = await listReconcilableCommentsStatement.all()
                for (const current of rows) {
                    const publication = await loadPublicationStatement.get(
                        current.projectId,
                        current.publicationId
                    )
                    if (publication === null) continue
                    if (publication.state === 'cancelled') {
                        await transition(
                            current,
                            {
                                state: 'cancelled',
                                claimToken: null,
                                leaseExpiresAt: null,
                                updatedAt: timestamp,
                                lastError: 'The parent publication was cancelled',
                            },
                            'publication_first_comment.cancelled',
                            timestamp
                        )
                        continue
                    }
                    if (!(await hasEditorAccess(current.projectId, current.actorId))) {
                        await transition(
                            current,
                            {
                                state: 'suspended',
                                claimToken: null,
                                leaseExpiresAt: null,
                                updatedAt: timestamp,
                                lastError: 'The enabling editor no longer has editor access',
                            },
                            'publication_first_comment.suspended',
                            timestamp
                        )
                        continue
                    }
                    let armed = current
                    if (current.state === 'waiting') {
                        const failWaiting = async (reason: string): Promise<void> => {
                            await transition(
                                current,
                                {
                                    state: 'failed',
                                    claimToken: null,
                                    leaseExpiresAt: null,
                                    updatedAt: timestamp,
                                    lastError: reason,
                                },
                                'publication_first_comment.failed',
                                timestamp
                            )
                        }
                        // A channel that now publishes with another provider can
                        // never confirm this comment, so it fails closed
                        // instead of waiting forever.
                        const channelProvider = await nativeProviderForChannel(
                            current.projectId,
                            publication.channelId
                        )
                        if (channelProvider !== null && channelProvider !== current.providerId) {
                            await failWaiting(
                                'The configured channel no longer publishes with this provider'
                            )
                            continue
                        }
                        const receipt = await loadNativeReceiptStatement.get(
                            current.projectId,
                            current.publicationId,
                            current.providerId
                        )
                        if (receipt === null) continue
                        const policy = options.policies.find(
                            candidate => candidate.id === current.providerId
                        )
                        if (!policy) {
                            await failWaiting('The original provider is no longer available')
                            continue
                        }
                        const parent = policy.resolveParent({
                            externalId: publication.externalId,
                            externalUrl: publication.externalUrl,
                            receiptExternalId: receipt.externalId,
                        })
                        if (!parent) {
                            await failWaiting('The confirmed publication could not be resolved')
                            continue
                        }
                        const identity = await loadReceiptIdentityStatement.get(
                            current.projectId,
                            publication.channelId,
                            current.providerId
                        )
                        if (!identity) {
                            await failWaiting('The original connection is no longer available')
                            continue
                        }
                        if (identity.credentialState !== 'active') {
                            await failWaiting('The original account is no longer available')
                            continue
                        }
                        const identityFailure = policy.identityFailure(parent, identity)
                        if (identityFailure) {
                            await failWaiting(
                                identityFailure === 'connection'
                                    ? 'The original connection is no longer available'
                                    : identityFailure === 'authorization'
                                      ? 'The original account is no longer available'
                                      : 'The confirmed publication does not belong to the connected account'
                            )
                            continue
                        }
                        const bound = await transition(
                            current,
                            {
                                state: 'pending',
                                dueAt: receipt.publishedAt + current.delaySeconds * 1000,
                                rootUri: parent.rootUri,
                                instanceOrigin: parent.instanceOrigin,
                                executionRevisionId: receipt.executionRevisionId,
                                connectionId: identity.connectionId,
                                credentialId: identity.credentialId,
                                accountId: identity.accountId,
                                updatedAt: timestamp,
                                lastError: null,
                            },
                            'publication_first_comment.armed',
                            timestamp
                        )
                        if (!bound) continue
                        armed = bound
                    }
                    const failureReason = await identityFailureReason(armed)
                    if (failureReason !== null) {
                        await transition(
                            armed,
                            {
                                state: 'failed',
                                claimToken: null,
                                leaseExpiresAt: null,
                                updatedAt: timestamp,
                                lastError: failureReason,
                            },
                            'publication_first_comment.failed',
                            timestamp
                        )
                    }
                }
            })()
        },

        async claimCurrent(rowValue: PublicationFirstComment, now = Date.now()): Promise<boolean> {
            return db.transaction(async () => {
                const current = await rowById(rowValue.id)
                if (current === null) return false
                if (current.state !== 'running') return false
                if (current.claimToken === null || current.claimToken !== rowValue.claimToken) {
                    return false
                }
                if (current.leaseExpiresAt === null || current.leaseExpiresAt <= now) return false
                if ((await identityFailureReason(current)) !== null) return false
                return hasEditorAccess(current.projectId, current.actorId)
            }, 'immediate')
        },

        /**
         * Reports the next moment the worker has something to do.
         *
         * A waiting comment whose parent receipt is already confirmed is
         * included at `now`, so a parent success or a restart can never strand
         * the work. The receipt is recognized independently from the publisher
         * connection; a comment that can no longer be armed is failed by
         * `reconcile` instead of staying in the schedule.
         */
        async getNextEventAt(now = Date.now()): Promise<number | null> {
            return (await nextEventStatement.get(now))?.eventAt ?? null
        },
    }
}

export type PublicationFirstCommentStore = ReturnType<typeof createPublicationFirstCommentStore>

function isEditableState(state: PublicationFirstCommentState): boolean {
    return (editableStates as readonly string[]).includes(state)
}

function normalizeDelaySeconds(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > firstCommentMaximumDelaySeconds) {
        throw new DomainInvariantError(
            'invalid_input',
            `delaySeconds must be an integer between 0 and ${String(firstCommentMaximumDelaySeconds)}`
        )
    }
    return value
}

function normalizeExpectedRevision(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError(
            'invalid_input',
            'expectedRevision must be a non-negative integer'
        )
    }
    return value
}

function computeDueAt(
    publishedAt: number | null,
    delaySeconds: number,
    fallback: number | null
): number | null {
    if (publishedAt === null) return fallback
    return publishedAt + delaySeconds * 1_000
}
