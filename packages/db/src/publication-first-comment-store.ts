import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type CompleteExternalEffectInput,
    type ExternalEffectExecutorStore,
    type ProviderCommentPolicy,
} from '@postdot/core'
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'

import { createAccessStore } from './access-store'
import { createDatabaseTransaction, type PostdotDatabase } from './client'
import { actors, publicationFirstComments as firstComments } from './domain-schema'
import { createEventJournalStore } from './event-journal-store'

/** Longest relative delay a prepared comment may wait after parent confirmation. */
export const firstCommentMaximumDelaySeconds = 604_800
const editableStates = ['waiting', 'pending', 'suspended'] as const
const reconcilableStates = ['waiting', 'pending'] as const

/** Persisted provider identities are accepted only through the installed policy registry. */
export type PublicationFirstCommentProvider = string
export interface PublicationFirstCommentStoreOptions {
    readonly policies: readonly ProviderCommentPolicy[]
}

export type PublicationFirstComment = typeof firstComments.$inferSelect
export type PublicationFirstCommentState = PublicationFirstComment['state']

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

/**
 * A native parent receipt exists only when the publication was delivered by a
 * succeeded automatic job whose completion is the recorded publication time,
 * and the executed profile is the built-in contract of the pinned provider.
 *
 * The proof never joins the publisher connection. The receipt is a property of
 * the publication, so removing a connection cannot hide a delivery that already
 * happened.
 */
const nativeReceiptProof = `
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
          and json_extract(proof_profiles.profile_json, '$.execution.kind') = 'built_in'
          and json_extract(proof_profiles.profile_json, '$.execution.contractId') = publication_first_comments.provider_id
    )
`

export function createPublicationFirstCommentStore(
    database: PostdotDatabase,
    options: PublicationFirstCommentStoreOptions
) {
    const client = database.$client
    const access = createAccessStore(database)
    const journal = createEventJournalStore(database)

    const loadPublicationStatement = client.query<PublicationRow, [string, string]>(`
        select id,
               project_id as projectId,
               channel_id as channelId,
               state,
               delivery_mode as deliveryMode,
               published_at as publishedAt,
               external_id as externalId,
               external_url as externalUrl
        from publications
        where project_id = ?1
          and id = ?2
    `)
    const loadNativeReceiptStatement = client.query<NativeReceiptRow, [string, string, string]>(`
        select proof_executions.id as executionRevisionId,
               proof_publications.external_id as externalId,
               proof_publications.published_at as publishedAt
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
          and json_extract(proof_profiles.profile_json, '$.execution.kind') = 'built_in'
          and json_extract(proof_profiles.profile_json, '$.execution.contractId') = ?3
        order by proof_jobs.completed_at desc, proof_executions.created_at desc
        limit 1
    `)
    const loadReceiptIdentityStatement = client.query<
        ReceiptIdentityRow,
        [string, string, string]
    >(`
        select proof_connections.id as connectionId,
               proof_connections.endpoint_url as endpointUrl,
               proof_credentials.id as credentialId,
               proof_credentials.external_account_id as accountId,
               proof_credentials.scopes as scopes,
               proof_credentials.state as credentialState
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
    const loadPinnedReceiptStatement = client.query<
        PinnedReceiptRow,
        [string, string, string, string]
    >(`
        select proof_executions.id as executionRevisionId,
               proof_publications.external_id as externalId,
               proof_publications.published_at as publishedAt
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
           and json_extract(proof_profiles.profile_json, '$.execution.kind') = 'built_in'
           and json_extract(proof_profiles.profile_json, '$.execution.contractId') = ?4
        where proof_executions.project_id = ?1
          and proof_executions.id = ?2
          and proof_executions.publication_id = ?3
          and proof_executions.delivery_mode = 'automatic'
    `)
    const loadCredentialStatement = client.query<CredentialRow, [string, string]>(`
        select id,
               provider_id as providerId,
               external_account_id as externalAccountId,
               scopes,
               state
        from project_publisher_credential_contexts as publisher_credentials
        where project_id = ?1
          and id = ?2
    `)
    const loadConnectionStatement = client.query<ConnectionRow, [string, string]>(`
        select id,
               publisher_id as publisherId,
               credential_id as credentialId,
               endpoint_url as endpointUrl
        from project_publisher_connection_contexts as publisher_connections
        where project_id = ?1
          and id = ?2
    `)
    const loadPublisherStatement = client.query<PublisherRow, [string, string]>(`
        select id,
               channel_id as channelId,
               kind
        from project_publisher_contexts as publishers
        where project_id = ?1
          and id = ?2
    `)
    const nativeChannelProviderStatement = client.query<
        { readonly contractId: string },
        [string, string]
    >(`
        select json_extract(channel_profile_versions.profile_json, '$.execution.contractId') as contractId
        from project_channel_contexts as channels
        inner join project_channel_profile_contexts as channel_profile_versions
            on channel_profile_versions.project_id = channels.project_id
           and channel_profile_versions.id = channels.profile_version_id
        where channels.project_id = ?1
          and channels.id = ?2
          and channel_profile_versions.state <> 'disabled'
          and channel_profile_versions.origin = 'built_in'
          and json_extract(channel_profile_versions.profile_json, '$.execution.kind') = 'built_in'
    `)
    const nextEventStatement = client.query<{ readonly eventAt: number | null }, [number]>(`
        select min(event_at) as eventAt
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
        )
    `)

    function row(projectId: string, publicationId: string): PublicationFirstComment | null {
        return (
            database
                .select()
                .from(firstComments)
                .where(
                    and(
                        eq(firstComments.projectId, projectId),
                        eq(firstComments.publicationId, publicationId)
                    )
                )
                .get() ?? null
        )
    }
    function rowById(id: string): PublicationFirstComment | null {
        return database.select().from(firstComments).where(eq(firstComments.id, id)).get() ?? null
    }
    function actorOf(rowValue: PublicationFirstComment) {
        return (
            database
                .select()
                .from(actors)
                .where(
                    and(eq(actors.projectId, rowValue.projectId), eq(actors.id, rowValue.actorId))
                )
                .get() ?? null
        )
    }
    function actorForSubject(projectId: string, subjectId: string) {
        return (
            database
                .select()
                .from(actors)
                .where(and(eq(actors.projectId, projectId), eq(actors.subjectId, subjectId)))
                .get() ?? null
        )
    }
    function hasEditorAccess(projectId: string, actorId: string): boolean {
        const actor = database
            .select()
            .from(actors)
            .where(and(eq(actors.projectId, projectId), eq(actors.id, actorId)))
            .get()
        if (actor === undefined || actor === null || actor.subjectId === null) return false
        return access.canAccessProject(projectId, actor.subjectId, 'editor')
    }

    /**
     * The provider that publishes a channel natively, or null when the channel
     * has no explicit built-in execution contract.
     */
    function nativeProviderForChannel(
        projectId: string,
        channelId: string
    ): PublicationFirstCommentProvider | null {
        const contractId = nativeChannelProviderStatement.get(projectId, channelId)?.contractId
        return options.policies.find(policy => policy.id === contractId)?.id ?? null
    }

    function event(
        rowValue: PublicationFirstComment,
        name: string,
        at: number,
        payload: Readonly<Record<string, unknown>> = {}
    ): void {
        journal.append({
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
    function identityFailureReason(rowValue: PublicationFirstComment): string | null {
        const publication = loadPublicationStatement.get(rowValue.projectId, rowValue.publicationId)
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
        const receipt = loadPinnedReceiptStatement.get(
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
        const credential = loadCredentialStatement.get(rowValue.projectId, rowValue.credentialId)
        if (
            credential === null ||
            credential.providerId !== rowValue.providerId ||
            credential.externalAccountId !== rowValue.accountId ||
            credential.state !== 'active'
        ) {
            return 'The original account is no longer available'
        }
        const connection = loadConnectionStatement.get(rowValue.projectId, rowValue.connectionId)
        if (connection === null || connection.credentialId !== rowValue.credentialId) {
            return 'The original connection is no longer available'
        }
        const publisher = loadPublisherStatement.get(rowValue.projectId, connection.publisherId)
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

    function transition(
        rowValue: PublicationFirstComment,
        values: Partial<PublicationFirstComment>,
        name: string,
        at: number,
        payload: Readonly<Record<string, unknown>> = {}
    ): PublicationFirstComment | null {
        const updated = database
            .update(firstComments)
            .set(values)
            .where(and(eq(firstComments.id, rowValue.id), eq(firstComments.state, rowValue.state)))
            .returning()
            .get()
        if (updated === null) return null
        event(updated, name, at, payload)
        return updated
    }

    const deliveries: ExternalEffectExecutorStore<PublicationFirstComment> = {
        recoverExpiredClaims(now) {
            return createDatabaseTransaction(database, () => {
                const expired = database
                    .select()
                    .from(firstComments)
                    .where(
                        and(
                            eq(firstComments.state, 'running'),
                            lte(firstComments.leaseExpiresAt, now)
                        )
                    )
                    .all()
                const requeuedJobIds: string[] = [],
                    ambiguousJobIds: string[] = []
                for (const expiredRow of expired) {
                    const uncertain = expiredRow.effectStartedAt !== null
                    const updated = transition(
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
            return createDatabaseTransaction(database, () => {
                const due = database
                    .select()
                    .from(firstComments)
                    .where(
                        and(
                            eq(firstComments.state, 'pending'),
                            sql`not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = ${firstComments.projectId} and state <> 'active')`,
                            lte(firstComments.dueAt, input.now),
                            input.projectId === undefined
                                ? undefined
                                : eq(firstComments.projectId, input.projectId)
                        )
                    )
                    .orderBy(asc(firstComments.dueAt), asc(firstComments.id))
                    .get()
                if (due === undefined || due === null) return null
                return (
                    database
                        .update(firstComments)
                        .set({
                            state: 'running',
                            attempts: due.attempts + 1,
                            claimToken: input.claimToken,
                            leaseExpiresAt: input.leaseExpiresAt,
                            effectStartedAt: null,
                            updatedAt: input.now,
                        })
                        .where(
                            and(eq(firstComments.id, due.id), eq(firstComments.state, 'pending'))
                        )
                        .returning()
                        .get() ?? null
                )
            })()
        },
        renewClaim(input) {
            const at = requireTimestamp(input.now, 'now')
            const expiry = requireTimestamp(input.leaseExpiresAt, 'leaseExpiresAt')
            if (expiry <= at) return false
            return (
                database
                    .update(firstComments)
                    .set({ leaseExpiresAt: expiry })
                    .where(
                        and(
                            eq(firstComments.id, requireNonBlank(input.jobId, 'jobId')),
                            eq(
                                firstComments.claimToken,
                                requireNonBlank(input.claimToken, 'claimToken')
                            ),
                            eq(firstComments.state, 'running'),
                            gt(firstComments.leaseExpiresAt, at),
                            lte(firstComments.leaseExpiresAt, expiry)
                        )
                    )
                    .returning({ id: firstComments.id })
                    .get() != null
            )
        },
        startExternalEffect(jobId, claimToken, now) {
            return createDatabaseTransaction(database, () => {
                const running = rowById(jobId)
                if (
                    running === null ||
                    running.state !== 'running' ||
                    running.claimToken !== claimToken ||
                    running.leaseExpiresAt === null ||
                    running.leaseExpiresAt <= now
                ) {
                    return false
                }
                const failureReason = identityFailureReason(running)
                if (failureReason !== null) {
                    transition(
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
                if (!hasEditorAccess(running.projectId, running.actorId)) {
                    transition(
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
                const updated = transition(
                    running,
                    { effectStartedAt: now, updatedAt: now },
                    'publication_first_comment.started',
                    now
                )
                return updated !== null
            })()
        },
        completeExternalEffect(input: CompleteExternalEffectInput) {
            return createDatabaseTransaction(database, () => {
                const running = rowById(input.jobId)
                if (
                    running === null ||
                    running.state !== 'running' ||
                    running.claimToken !== input.claimToken
                ) {
                    return null
                }
                const { outcome } = input
                if (outcome.type === 'published') {
                    const updated = transition(
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
                    const updated = transition(
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
                const blocked = !hasEditorAccess(running.projectId, running.actorId)
                const updated = transition(
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

        get(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): PublicationFirstComment | null {
            if (!access.canAccessProject(projectId, subjectId, 'viewer')) return null
            return row(projectId, publicationId)
        },

        view(
            projectId: string,
            publicationId: string,
            subjectId: string
        ): PublicationFirstCommentView | null {
            if (!access.canAccessProject(projectId, subjectId, 'viewer')) return null
            const current = row(projectId, publicationId)
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
                authorName: actorOf(current)?.displayName ?? '',
            }
        },

        canManage(projectId: string, subjectId: string): boolean {
            return access.canAccessProject(projectId, subjectId, 'editor')
        },

        /**
         * A comment can be configured for a native automatic Bluesky or
         * Mastodon publication before delivery, or for a publication that
         * already owns a prepared comment. Terminal and claimed comments are
         * frozen.
         */
        canConfigure(projectId: string, publicationId: string): boolean {
            const publication = loadPublicationStatement.get(projectId, publicationId)
            if (publication === null) return false
            const existing = row(projectId, publicationId)
            if (existing !== null) return isEditableState(existing.state)
            if (publication.deliveryMode !== 'automatic') return false
            if (publication.state !== 'draft' && publication.state !== 'scheduled') return false
            return nativeProviderForChannel(projectId, publication.channelId) !== null
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
        save(input: SavePublicationFirstCommentInput): PublicationFirstCommentMutation {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const delaySeconds = normalizeDelaySeconds(input.delaySeconds)
            const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
            const recordKey = requireNonBlank(input.recordKey, 'recordKey')
            const now = requireTimestamp(input.now, 'now')

            return createDatabaseTransaction(database, (): PublicationFirstCommentMutation => {
                const actor = actorForSubject(projectId, subjectId)
                if (actor === null) return { kind: 'not_found' }
                if (!access.canAccessProject(projectId, subjectId, 'editor')) {
                    return { kind: 'not_found' }
                }
                const existing = row(projectId, publicationId)
                const publication = loadPublicationStatement.get(projectId, publicationId)
                const channelProvider =
                    publication === null
                        ? null
                        : nativeProviderForChannel(projectId, publication.channelId)
                const providerId = existing?.providerId ?? channelProvider
                const policy = options.policies.find(candidate => candidate.id === providerId)
                if (!policy) return { kind: 'conflict' }
                const text = policy.normalizeText(input.text)
                if (existing === null) {
                    if (expectedRevision !== 0) return { kind: 'conflict' }
                    if (publication === null) return { kind: 'not_found' }
                    if (
                        publication.deliveryMode !== 'automatic' ||
                        (publication.state !== 'draft' && publication.state !== 'scheduled') ||
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
                    database.insert(firstComments).values(created).run()
                    event(created, 'publication_first_comment.requested', now, { text })
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
                    ? computeDueAt(publication?.publishedAt ?? null, delaySeconds, existing.dueAt)
                    : null
                const updated = database
                    .update(firstComments)
                    .set({
                        text,
                        delaySeconds,
                        actorId: actor.id,
                        state: armed ? 'pending' : 'waiting',
                        dueAt,
                        revision: existing.revision + 1,
                        updatedAt: now,
                        lastError: null,
                    })
                    .where(
                        and(
                            eq(firstComments.id, existing.id),
                            eq(firstComments.revision, existing.revision),
                            inArray(firstComments.state, [...editableStates])
                        )
                    )
                    .returning()
                    .get()
                if (updated === null) return { kind: 'conflict' }
                event(updated, 'publication_first_comment.enabled', now, { text })
                return { kind: 'saved', firstComment: updated }
            })()
        },

        cancel(input: CancelPublicationFirstCommentInput): PublicationFirstCommentMutation {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
            const now = requireTimestamp(input.now, 'now')

            return createDatabaseTransaction(database, (): PublicationFirstCommentMutation => {
                const actor = actorForSubject(projectId, subjectId)
                if (actor === null) return { kind: 'not_found' }
                if (!access.canAccessProject(projectId, subjectId, 'editor')) {
                    return { kind: 'not_found' }
                }
                const existing = row(projectId, publicationId)
                if (existing === null) return { kind: 'not_found' }
                if (existing.state === 'cancelled' && existing.revision === expectedRevision + 1) {
                    return { kind: 'saved', firstComment: existing }
                }
                if (!isEditableState(existing.state)) return { kind: 'conflict' }
                if (existing.revision !== expectedRevision) return { kind: 'conflict' }
                const updated = database
                    .update(firstComments)
                    .set({
                        state: 'cancelled',
                        claimToken: null,
                        leaseExpiresAt: null,
                        revision: existing.revision + 1,
                        updatedAt: now,
                        lastError: null,
                    })
                    .where(
                        and(
                            eq(firstComments.id, existing.id),
                            eq(firstComments.revision, expectedRevision),
                            inArray(firstComments.state, [...editableStates])
                        )
                    )
                    .returning()
                    .get()
                if (updated === null) return { kind: 'conflict' }
                event(updated, 'publication_first_comment.cancelled', now)
                return { kind: 'saved', firstComment: updated }
            })()
        },

        /**
         * Reconciles prepared comments against their parent publication.
         *
         * A waiting comment is armed only by a native, automatically delivered
         * parent receipt. A comment whose enabling editor lost access is
         * suspended and never resumes on its own. A comment whose pinned
         * identity no longer exists fails with a safe reason.
         */
        reconcile(now: number): void {
            const timestamp = requireTimestamp(now, 'now')
            createDatabaseTransaction(database, () => {
                const rows = database
                    .select()
                    .from(firstComments)
                    .where(inArray(firstComments.state, [...reconcilableStates]))
                    .orderBy(asc(firstComments.createdAt), asc(firstComments.id))
                    .all()
                for (const current of rows) {
                    const publication = loadPublicationStatement.get(
                        current.projectId,
                        current.publicationId
                    )
                    if (publication === null) continue
                    if (publication.state === 'cancelled') {
                        transition(
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
                    if (!hasEditorAccess(current.projectId, current.actorId)) {
                        transition(
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
                        const failWaiting = (reason: string): void => {
                            transition(
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
                        const channelProvider = nativeProviderForChannel(
                            current.projectId,
                            publication.channelId
                        )
                        if (channelProvider !== null && channelProvider !== current.providerId) {
                            failWaiting(
                                'The configured channel no longer publishes with this provider'
                            )
                            continue
                        }
                        const receipt = loadNativeReceiptStatement.get(
                            current.projectId,
                            current.publicationId,
                            current.providerId
                        )
                        if (receipt === null) continue
                        const policy = options.policies.find(
                            candidate => candidate.id === current.providerId
                        )
                        if (!policy) {
                            failWaiting('The original provider is no longer available')
                            continue
                        }
                        const parent = policy.resolveParent({
                            externalId: publication.externalId,
                            externalUrl: publication.externalUrl,
                            receiptExternalId: receipt.externalId,
                        })
                        if (!parent) {
                            failWaiting('The confirmed publication could not be resolved')
                            continue
                        }
                        const identity = loadReceiptIdentityStatement.get(
                            current.projectId,
                            publication.channelId,
                            current.providerId
                        )
                        if (!identity) {
                            failWaiting('The original connection is no longer available')
                            continue
                        }
                        if (identity.credentialState !== 'active') {
                            failWaiting('The original account is no longer available')
                            continue
                        }
                        const identityFailure = policy.identityFailure(parent, identity)
                        if (identityFailure) {
                            failWaiting(
                                identityFailure === 'connection'
                                    ? 'The original connection is no longer available'
                                    : identityFailure === 'authorization'
                                      ? 'The original account is no longer available'
                                      : 'The confirmed publication does not belong to the connected account'
                            )
                            continue
                        }
                        const bound = transition(
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
                    const failureReason = identityFailureReason(armed)
                    if (failureReason !== null) {
                        transition(
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

        claimCurrent(rowValue: PublicationFirstComment, now = Date.now()): boolean {
            const current = rowById(rowValue.id)
            if (current === null) return false
            if (current.state !== 'running') return false
            if (current.claimToken === null || current.claimToken !== rowValue.claimToken) {
                return false
            }
            if (current.leaseExpiresAt === null || current.leaseExpiresAt <= now) return false
            if (identityFailureReason(current) !== null) return false
            return hasEditorAccess(current.projectId, current.actorId)
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
        getNextEventAt(now = Date.now()): number | null {
            return nextEventStatement.get(now)?.eventAt ?? null
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
