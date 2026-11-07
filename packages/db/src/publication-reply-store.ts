import {
    type CompleteExternalEffectInput,
    type ExternalEffectExecutorStore,
    requireNonBlank,
    requireTimestamp,
    type ProviderCommentPolicy,
} from '@postdot/core'

import { createAccessStore } from './access-store'
import { defineTransaction, type DatabaseHandle } from './client'
import { createEventJournalStore } from './event-journal-store'
import { mapSequential } from './sql/sequential'

/** A `publication_comment_replies` row. */
export interface PublicationReply {
    id: string
    projectId: string
    publicationId: string
    actorId: string
    rootUri: string
    parentUri: string
    text: string
    connectionId: string
    credentialId: string
    providerId: string
    accountId: string
    instanceOrigin: string | null
    recordKey: string
    state: 'pending' | 'running' | 'sent' | 'failed' | 'ambiguous'
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
export type PublicationReplyWork = PublicationReply
export type CreatePublicationReply = Pick<
    PublicationReply,
    | 'id'
    | 'projectId'
    | 'publicationId'
    | 'rootUri'
    | 'parentUri'
    | 'text'
    | 'connectionId'
    | 'credentialId'
    | 'accountId'
    | 'providerId'
    | 'instanceOrigin'
    | 'recordKey'
> & { subjectId: string; now: number }

const replyColumns = `
    id,
    project_id as "projectId",
    publication_id as "publicationId",
    actor_id as "actorId",
    root_uri as "rootUri",
    parent_uri as "parentUri",
    text,
    connection_id as "connectionId",
    credential_id as "credentialId",
    provider_id as "providerId",
    account_id as "accountId",
    instance_origin as "instanceOrigin",
    record_key as "recordKey",
    state,
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

interface ReplyActorRow {
    readonly id: string
    readonly subjectId: string | null
    readonly displayName: string
}

export function createPublicationReplyStore(
    database: DatabaseHandle,
    options: { readonly policies: readonly ProviderCommentPolicy[] }
) {
    const sql = database.sql
    const access = createAccessStore(database)
    const journal = createEventJournalStore(database)

    const getReplyStatement = sql.statement<PublicationReply, [id: string]>(`
        select ${replyColumns}
        from publication_comment_replies
        where id = ?1
    `)
    const loadActorStatement = sql.statement<ReplyActorRow, [projectId: string, actorId: string]>(`
        select id,
               subject_id as "subjectId",
               display_name as "displayName"
        from actors
        where project_id = ?1
          and id = ?2
    `)
    const loadActorBySubjectStatement = sql.statement<
        { readonly id: string },
        [projectId: string, subjectId: string]
    >(`
        select id
        from actors
        where project_id = ?1
          and subject_id = ?2
        limit 1
    `)
    const listExpiredClaimsStatement = sql.statement<PublicationReply, [cutoff: number]>(`
        select ${replyColumns}
        from publication_comment_replies
        where state = 'running'
          and lease_expires_at < ?1
    `)
    const selectNextDueReplyStatement = sql.statement<
        PublicationReply,
        [projectId: string | null]
    >(`
        select ${replyColumns}
        from publication_comment_replies
        where state = 'pending'
          and not exists (
              select 1
              from resource_lifecycles
              where kind = 'project'
                and resource_id = publication_comment_replies.project_id
                and state <> 'active'
          )
          and (cast(?1 as text) is null or project_id = ?1)
        order by created_at asc, id asc
        limit 1
    `)
    const claimPendingReplyStatement = sql.statement<
        PublicationReply,
        [
            attempts: number,
            claimToken: string,
            leaseExpiresAt: number,
            updatedAt: number,
            id: string,
        ]
    >(`
        update publication_comment_replies
        set state = 'running',
            attempts = ?1,
            claim_token = ?2,
            lease_expires_at = ?3,
            effect_started_at = null,
            updated_at = ?4
        where id = ?5
          and state = 'pending'
        returning ${replyColumns}
    `)
    const renewClaimStatement = sql.statement<
        { readonly id: string },
        [leaseExpiresAt: number, id: string, claimToken: string, now: number]
    >(`
        update publication_comment_replies
        set lease_expires_at = ?1
        where id = ?2
          and claim_token = ?3
          and state = 'running'
          and lease_expires_at > ?4
          and lease_expires_at <= ?1
        returning id
    `)
    const markClaimStartedStatement = sql.statement<
        PublicationReply,
        [effectStartedAt: number, updatedAt: number, id: string, claimToken: string]
    >(`
        update publication_comment_replies
        set effect_started_at = ?1,
            updated_at = ?2
        where id = ?3
          and state = 'running'
          and claim_token = ?4
        returning ${replyColumns}
    `)
    const finishClaimStatement = sql.statement<
        PublicationReply,
        [
            state: PublicationReply['state'],
            updatedAt: number,
            externalId: string | null,
            externalUrl: string | null,
            lastError: string | null,
            id: string,
            claimToken: string,
        ]
    >(`
        update publication_comment_replies
        set state = ?1,
            claim_token = null,
            lease_expires_at = null,
            updated_at = ?2,
            external_id = ?3,
            external_url = ?4,
            last_error = ?5
        where id = ?6
          and state = 'running'
          and claim_token = ?7
        returning ${replyColumns}
    `)
    const insertReplyStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            publicationId: string,
            actorId: string,
            rootUri: string,
            parentUri: string,
            text: string,
            connectionId: string,
            credentialId: string,
            providerId: string,
            accountId: string,
            instanceOrigin: string | null,
            recordKey: string,
            state: PublicationReply['state'],
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
        insert into publication_comment_replies (
            id,
            project_id,
            publication_id,
            actor_id,
            root_uri,
            parent_uri,
            text,
            connection_id,
            credential_id,
            provider_id,
            account_id,
            instance_origin,
            record_key,
            state,
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
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
        )
    `)
    const listRepliesStatement = sql.statement<
        PublicationReply,
        [
            projectId: string,
            publicationId: string,
            anchorCreatedAt: number | null,
            anchorId: string | null,
        ]
    >(`
        select ${replyColumns}
        from publication_comment_replies
        where project_id = ?1
          and publication_id = ?2
          and (
              cast(?3 as bigint) is null
              or created_at < ?3
              or (created_at = ?3 and id < ?4)
          )
        order by created_at desc, id desc
        limit 51
    `)
    const nextEventAtStatement = sql.statement<{ readonly at: number | null }, []>(`
        select min(case when state = 'pending' then created_at else lease_expires_at end) as "at"
        from publication_comment_replies
        where (
            state = 'pending'
            and not exists (
                select 1
                from resource_lifecycles
                where kind = 'project'
                  and resource_id = publication_comment_replies.project_id
                  and state <> 'active'
            )
        ) or state = 'running'
    `)

    const get = (id: string) => getReplyStatement.get(id)
    const actor = (row: PublicationReply) => loadActorStatement.get(row.projectId, row.actorId)

    async function event(row: PublicationReply, name: string, at: number) {
        await journal.append({
            projectId: row.projectId,
            actorId: row.actorId,
            name,
            version: 1,
            subject: { type: 'publication_reply', id: row.id },
            payload: {
                publicationId: row.publicationId,
                parentUri: row.parentUri,
                state: row.state,
            },
            occurredAt: at,
        })
    }
    async function eligible(row: PublicationReply): Promise<boolean> {
        const subjectId = (await actor(row))?.subjectId
        if (!subjectId || !(await access.canAccessProject(row.projectId, subjectId, 'editor')))
            return false
        const policy = options.policies.find(candidate => candidate.id === row.providerId)
        if (!policy || (policy.requiresInstanceOrigin && row.instanceOrigin === null)) return false
        const externalId = policy.publicationId(row.rootUri)
        if (externalId === null) return false
        return (
            (await sql
                .statement<
                    { id: string },
                    [string, string, string, string, string, string, string, string | null]
                >(`
            select p.id from publications p
            inner join project_publisher_contexts b on b.project_id = p.project_id and b.channel_id = p.channel_id
            inner join project_publisher_connection_contexts c on c.project_id = b.project_id and c.publisher_id = b.id
            inner join project_publisher_credential_contexts k on k.project_id = c.project_id and k.id = c.credential_id
            where p.project_id = ?1 and p.id = ?2 and p.state = 'published' and p.external_id = ?3
              and c.id = ?4 and c.credential_id = ?5 and b.kind = ?7 and k.provider_id = ?7
              and k.external_account_id = ?6 and k.state = 'active'
              and (cast(?8 as text) is null or c.endpoint_url = ?8)
        `)
                .get(
                    row.projectId,
                    row.publicationId,
                    externalId,
                    row.connectionId,
                    row.credentialId,
                    row.accountId,
                    row.providerId,
                    policy.requiresInstanceOrigin ? row.instanceOrigin : null
                )) !== null
        )
    }

    const deliveries: ExternalEffectExecutorStore<PublicationReplyWork> = {
        recoverExpiredClaims(now) {
            return defineTransaction(database, async () => {
                const expired = await listExpiredClaimsStatement.all(now + 1)
                const requeuedJobIds: string[] = [],
                    ambiguousJobIds: string[] = []
                for (const row of expired) {
                    const uncertain = row.effectStartedAt !== null
                    const updated = await finishClaimStatement.get(
                        uncertain ? 'ambiguous' : 'pending',
                        now,
                        row.externalId,
                        row.externalUrl,
                        uncertain
                            ? 'The process stopped before the reply outcome was confirmed'
                            : null,
                        row.id,
                        row.claimToken!
                    )
                    if (!updated) continue
                    ;(uncertain ? ambiguousJobIds : requeuedJobIds).push(row.id)
                    await event(
                        updated,
                        uncertain ? 'publication_reply.ambiguous' : 'publication_reply.recovered',
                        now
                    )
                }
                return { requeuedJobIds, ambiguousJobIds }
            })()
        },
        claimNextDueJob(input) {
            return defineTransaction(database, async () => {
                const row = await selectNextDueReplyStatement.get(input.projectId ?? null)
                if (!row) return null
                return claimPendingReplyStatement.get(
                    row.attempts + 1,
                    input.claimToken,
                    input.leaseExpiresAt,
                    input.now,
                    row.id
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
        startExternalEffect(id, token, now) {
            return defineTransaction(database, async () => {
                const row = await get(id)
                if (
                    !row ||
                    row.state !== 'running' ||
                    row.claimToken !== token ||
                    row.leaseExpiresAt! <= now
                )
                    return false
                if (!(await eligible(row))) {
                    const failed = await finishClaimStatement.get(
                        'failed',
                        now,
                        row.externalId,
                        row.externalUrl,
                        'The original account or editor access is no longer available',
                        id,
                        token
                    )
                    if (failed) await event(failed, 'publication_reply.failed', now)
                    return false
                }
                const updated = await markClaimStartedStatement.get(now, now, id, token)
                if (updated) await event(updated, 'publication_reply.started', now)
                return updated !== null
            })()
        },
        completeExternalEffect(input: CompleteExternalEffectInput) {
            return defineTransaction(database, async () => {
                const { outcome } = input
                // First release has one attempt. Known failures can be composed again explicitly.
                const state =
                    outcome.type === 'published'
                        ? 'sent'
                        : outcome.type === 'ambiguous' || outcome.type === 'deferred'
                          ? 'ambiguous'
                          : 'failed'
                const row = await finishClaimStatement.get(
                    state,
                    input.completedAt,
                    outcome.type === 'published' ? (outcome.externalId ?? null) : null,
                    outcome.type === 'published' ? (outcome.externalUrl ?? null) : null,
                    outcome.type === 'published' ? null : outcome.errorMessage,
                    input.jobId,
                    input.claimToken
                )
                if (!row) return null
                await event(row, `publication_reply.${state}`, input.completedAt)
                return state === 'sent' ? 'published' : state
            })()
        },
    }
    return {
        deliveries,
        get,
        eligible,
        async claimCurrent(row: PublicationReply, now = Date.now()): Promise<boolean> {
            return sql.transaction(async () => {
                const current = await get(row.id)
                return (
                    current !== null &&
                    current.state === 'running' &&
                    current.claimToken === row.claimToken &&
                    current.leaseExpiresAt! > now &&
                    (await eligible(current))
                )
            }, 'immediate')
        },
        async create(input: CreatePublicationReply): Promise<PublicationReply | null> {
            return sql.transaction(async () => {
                requireTimestamp(input.now, 'reply creation time')
                requireNonBlank(input.text, 'reply text')
                return defineTransaction(database, async () => {
                    if (
                        !(await access.canAccessProject(input.projectId, input.subjectId, 'editor'))
                    )
                        return null
                    const author = await loadActorBySubjectStatement.get(
                        input.projectId,
                        input.subjectId
                    )
                    if (!author) return null
                    const existing = await get(input.id)
                    if (existing)
                        return existing.projectId === input.projectId &&
                            existing.publicationId === input.publicationId &&
                            existing.actorId === author.id &&
                            existing.parentUri === input.parentUri &&
                            existing.text === input.text
                            ? existing
                            : null
                    const { subjectId: _subjectId, now: _now, ...identity } = input
                    const row: PublicationReply = {
                        ...identity,
                        actorId: author.id,
                        state: 'pending',
                        attempts: 0,
                        claimToken: null,
                        leaseExpiresAt: null,
                        effectStartedAt: null,
                        externalId: null,
                        externalUrl: null,
                        lastError: null,
                        createdAt: input.now,
                        updatedAt: input.now,
                    }
                    if (!(await eligible(row))) return null
                    await insertReplyStatement.run(
                        row.id,
                        row.projectId,
                        row.publicationId,
                        row.actorId,
                        row.rootUri,
                        row.parentUri,
                        row.text,
                        row.connectionId,
                        row.credentialId,
                        row.providerId,
                        row.accountId,
                        row.instanceOrigin,
                        row.recordKey,
                        row.state,
                        row.attempts,
                        row.claimToken,
                        row.leaseExpiresAt,
                        row.effectStartedAt,
                        row.externalId,
                        row.externalUrl,
                        row.lastError,
                        row.createdAt,
                        row.updatedAt
                    )
                    await event(row, 'publication_reply.requested', input.now)
                    return row
                })()
            }, 'immediate')
        },
        async list(projectId: string, publicationId: string, subjectId: string, before?: string) {
            return sql.transaction(async () => {
                if (!(await access.canAccessProject(projectId, subjectId, 'viewer'))) return null
                const anchor = before ? await get(before) : null
                if (
                    before &&
                    (!anchor ||
                        anchor.projectId !== projectId ||
                        anchor.publicationId !== publicationId)
                )
                    return null
                const rows = await listRepliesStatement.all(
                    projectId,
                    publicationId,
                    anchor?.createdAt ?? null,
                    anchor?.id ?? null
                )
                const page = rows.slice(0, 50)
                return {
                    replies: await mapSequential(page, async row => ({
                        id: row.id,
                        parentUri: row.parentUri,
                        text: row.text,
                        state: row.state,
                        authorName: (await actor(row))?.displayName ?? '',
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt,
                        externalUrl: row.externalUrl,
                        lastError: row.lastError,
                    })),
                    nextBefore: rows.length > 50 ? page.at(-1)!.id : null,
                }
            }, 'deferred')
        },
        async getNextEventAt(): Promise<number | null> {
            return (await nextEventAtStatement.get())?.at ?? null
        },
    }
}
export type PublicationReplyStore = ReturnType<typeof createPublicationReplyStore>
