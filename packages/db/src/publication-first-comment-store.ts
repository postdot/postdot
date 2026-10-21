import {
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type CompleteExternalEffectInput,
    type ExternalEffectExecutorStore,
} from '@postbot/core'
import { and, asc, eq, inArray, lte } from 'drizzle-orm'

import { createAccessStore } from './access-store'
import { createDatabaseTransaction, type PostbotDatabase } from './client'
import { actors, publicationFirstComments as firstComments } from './domain-schema'
import { createEventJournalStore } from './event-journal-store'

/** Longest relative delay a prepared comment may wait after parent confirmation. */
export const firstCommentMaximumDelaySeconds = 604_800
/** Longest first comment accepted by the Bluesky contract. */
export const firstCommentMaximumGraphemes = 300
/** Longest first comment accepted by the Bluesky contract in UTF-16 code units. */
export const firstCommentMaximumTextLength = 3_000

const editableStates = ['waiting', 'pending', 'suspended'] as const
const reconcilableStates = ['waiting', 'pending'] as const

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
    readonly credentialId: string
    readonly accountId: string
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
    readonly state: string
}

interface ConnectionRow {
    readonly id: string
    readonly publisherId: string
    readonly credentialId: string
}

interface PublisherRow {
    readonly id: string
    readonly channelId: string
    readonly kind: string
}

/**
 * A native parent receipt exists only when the publication was delivered by a
 * succeeded automatic job whose completion is the recorded publication time,
 * and the executed profile is the built-in Bluesky contract.
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
        inner join channel_profile_versions as proof_profiles
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
          and json_extract(proof_profiles.profile_json, '$.execution.contractId') = 'bluesky'
    )
`

export function createPublicationFirstCommentStore(database: PostbotDatabase) {
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
               external_id as externalId
        from publications
        where project_id = ?1
          and id = ?2
    `)
    const loadNativeReceiptStatement = client.query<NativeReceiptRow, [string, string]>(`
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
        inner join channel_profile_versions as proof_profiles
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
          and json_extract(proof_profiles.profile_json, '$.execution.contractId') = 'bluesky'
        order by proof_jobs.completed_at desc, proof_executions.created_at desc
        limit 1
    `)
    const loadReceiptIdentityStatement = client.query<ReceiptIdentityRow, [string, string]>(`
        select proof_connections.id as connectionId,
               proof_credentials.id as credentialId,
               proof_credentials.external_account_id as accountId,
               proof_credentials.state as credentialState
        from publishers as proof_publishers
        inner join publisher_connections as proof_connections
            on proof_connections.project_id = proof_publishers.project_id
           and proof_connections.publisher_id = proof_publishers.id
        inner join publisher_credentials as proof_credentials
            on proof_credentials.project_id = proof_connections.project_id
           and proof_credentials.id = proof_connections.credential_id
           and proof_credentials.provider_id = 'bluesky'
        where proof_publishers.project_id = ?1
          and proof_publishers.channel_id = ?2
          and proof_publishers.kind = 'bluesky'
    `)
    const loadPinnedReceiptStatement = client.query<PinnedReceiptRow, [string, string, string]>(`
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
        inner join channel_profile_versions as proof_profiles
            on proof_profiles.project_id = proof_executions.project_id
           and proof_profiles.id = proof_executions.profile_version_id
           and proof_profiles.state <> 'disabled'
           and proof_profiles.origin = 'built_in'
           and json_extract(proof_profiles.profile_json, '$.execution.kind') = 'built_in'
           and json_extract(proof_profiles.profile_json, '$.execution.contractId') = 'bluesky'
        where proof_executions.project_id = ?1
          and proof_executions.id = ?2
          and proof_executions.publication_id = ?3
          and proof_executions.delivery_mode = 'automatic'
    `)
    const loadCredentialStatement = client.query<CredentialRow, [string, string]>(`
        select id,
               provider_id as providerId,
               external_account_id as externalAccountId,
               state
        from publisher_credentials
        where project_id = ?1
          and id = ?2
    `)
    const loadConnectionStatement = client.query<ConnectionRow, [string, string]>(`
        select id,
               publisher_id as publisherId,
               credential_id as credentialId
        from publisher_connections
        where project_id = ?1
          and id = ?2
    `)
    const loadPublisherStatement = client.query<PublisherRow, [string, string]>(`
        select id,
               channel_id as channelId,
               kind
        from publishers
        where project_id = ?1
          and id = ?2
    `)
    const isNativeBlueskyChannelStatement = client.query<
        { readonly id: string },
        [string, string]
    >(`
        select channels.id
        from channels
        inner join channel_profile_versions
            on channel_profile_versions.project_id = channels.project_id
           and channel_profile_versions.id = channels.profile_version_id
        where channels.project_id = ?1
          and channels.id = ?2
          and channel_profile_versions.state <> 'disabled'
          and channel_profile_versions.origin = 'built_in'
          and json_extract(channel_profile_versions.profile_json, '$.execution.kind') = 'built_in'
          and json_extract(channel_profile_versions.profile_json, '$.execution.contractId') = 'bluesky'
    `)
    const nextEventStatement = client.query<{ readonly eventAt: number | null }, [number]>(`
        select min(event_at) as eventAt
        from (
            select due_at as event_at
            from publication_first_comments
            where state = 'pending'
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
        const receipt = loadPinnedReceiptStatement.get(
            rowValue.projectId,
            rowValue.executionRevisionId,
            rowValue.publicationId
        )
        if (receipt === null || receipt.publishedAt !== publication.publishedAt) {
            return 'The confirmed publication receipt is no longer available'
        }
        if (publication.externalId !== rowValue.rootUri) {
            return 'The confirmed parent publication changed'
        }
        const credential = loadCredentialStatement.get(rowValue.projectId, rowValue.credentialId)
        if (
            credential === null ||
            credential.providerId !== 'bluesky' ||
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
            publisher.kind !== 'bluesky' ||
            publisher.channelId !== publication.channelId
        ) {
            return 'The original connection is no longer available'
        }
        if (accountDidFromRootUri(rowValue.rootUri) !== rowValue.accountId) {
            return 'The confirmed publication does not belong to the connected account'
        }
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
                        and(eq(firstComments.state, 'pending'), lte(firstComments.dueAt, input.now))
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
         * A comment can be configured for a native automatic Bluesky
         * publication before delivery, or for a publication that already owns a
         * prepared comment. Terminal and claimed comments are frozen.
         */
        canConfigure(projectId: string, publicationId: string): boolean {
            const publication = loadPublicationStatement.get(projectId, publicationId)
            if (publication === null) return false
            const existing = row(projectId, publicationId)
            if (existing !== null) return isEditableState(existing.state)
            if (publication.deliveryMode !== 'automatic') return false
            if (publication.state !== 'draft' && publication.state !== 'scheduled') return false
            return isNativeBlueskyChannelStatement.get(projectId, publication.channelId) !== null
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
         */
        save(input: SavePublicationFirstCommentInput): PublicationFirstCommentMutation {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const text = normalizeText(input.text)
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
                if (existing === null) {
                    if (expectedRevision !== 0) return { kind: 'conflict' }
                    const publication = loadPublicationStatement.get(projectId, publicationId)
                    if (publication === null) return { kind: 'not_found' }
                    if (
                        publication.deliveryMode !== 'automatic' ||
                        (publication.state !== 'draft' && publication.state !== 'scheduled') ||
                        isNativeBlueskyChannelStatement.get(projectId, publication.channelId) ===
                            null
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
                const publication = loadPublicationStatement.get(projectId, publicationId)
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
                        const receipt = loadNativeReceiptStatement.get(
                            current.projectId,
                            current.publicationId
                        )
                        if (receipt === null) continue
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
                        const rootUri = receipt.externalId
                        if (rootUri === null || rootUri.trim().length === 0) {
                            failWaiting('The confirmed publication receipt is incomplete')
                            continue
                        }
                        const accountDid = accountDidFromRootUri(rootUri)
                        if (accountDid === null) {
                            failWaiting(
                                'The confirmed publication does not belong to the connected account'
                            )
                            continue
                        }
                        const identity = loadReceiptIdentityStatement.get(
                            current.projectId,
                            publication.channelId
                        )
                        if (identity === null) {
                            failWaiting('The original connection is no longer available')
                            continue
                        }
                        if (identity.credentialState !== 'active') {
                            failWaiting('The original account is no longer available')
                            continue
                        }
                        if (identity.accountId !== accountDid) {
                            failWaiting(
                                'The confirmed publication does not belong to the connected account'
                            )
                            continue
                        }
                        const bound = transition(
                            current,
                            {
                                state: 'pending',
                                dueAt: receipt.publishedAt + current.delaySeconds * 1_000,
                                rootUri,
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
                        if (bound === null) continue
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

function normalizeText(value: string): string {
    const text = requireNonBlank(value, 'first comment text')
    if (text.length > firstCommentMaximumTextLength) {
        throw new DomainInvariantError(
            'invalid_input',
            `first comment text must not exceed ${String(firstCommentMaximumTextLength)} UTF-16 code units`
        )
    }
    if (graphemeCount(text) > firstCommentMaximumGraphemes) {
        throw new DomainInvariantError(
            'invalid_input',
            `first comment text must not exceed ${String(firstCommentMaximumGraphemes)} graphemes`
        )
    }
    return text
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

function graphemeCount(value: string): number {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length
}

/**
 * Extracts the account identifier of an AT Protocol record URI so a prepared
 * comment can prove it belongs to the connected account.
 */
function accountDidFromRootUri(rootUri: string): string | null {
    if (!rootUri.startsWith('at://')) return null
    const remainder = rootUri.slice('at://'.length)
    const separator = remainder.indexOf('/')
    if (separator <= 0) return null
    return remainder.slice(0, separator)
}
