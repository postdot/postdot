import {
    type CompleteExternalEffectInput,
    type ExternalEffectExecutorStore,
    requireNonBlank,
    requireTimestamp,
    type ProviderCommentPolicy,
} from '@postdot/core'
import { and, asc, desc, eq, gt, lt, lte, or, sql } from 'drizzle-orm'

import { createAccessStore } from './access-store'
import { defineTransaction, type PostdotDatabase, runSync } from './client'
import { actors, publicationCommentReplies as replies } from './domain-schema'
import { createEventJournalStore } from './event-journal-store'
import { mapSequential } from './sql/sequential'

export type PublicationReply = typeof replies.$inferSelect
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

export function createPublicationReplyStore(
    database: PostdotDatabase,
    options: { readonly policies: readonly ProviderCommentPolicy[] }
) {
    const access = createAccessStore(database)
    const journal = createEventJournalStore(database)
    const get = async (id: string) =>
        (await runSync(database, () =>
            database.select().from(replies).where(eq(replies.id, id)).get()
        )) ?? null
    async function actor(row: PublicationReply) {
        return (
            (await runSync(database, () =>
                database
                    .select()
                    .from(actors)
                    .where(and(eq(actors.projectId, row.projectId), eq(actors.id, row.actorId)))
                    .get()
            )) ?? null
        )
    }
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
            (await database.sql
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
              and (?8 is null or c.endpoint_url = ?8)
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
    async function updateClaim(id: string, token: string, values: Partial<PublicationReply>) {
        return (
            (await runSync(database, () =>
                database
                    .update(replies)
                    .set(values)
                    .where(
                        and(
                            eq(replies.id, id),
                            eq(replies.state, 'running'),
                            eq(replies.claimToken, token)
                        )
                    )
                    .returning()
                    .get()
            )) ?? null
        )
    }
    const deliveries: ExternalEffectExecutorStore<PublicationReplyWork> = {
        recoverExpiredClaims(now) {
            return defineTransaction(database, async () => {
                const expired = await runSync(database, () =>
                    database
                        .select()
                        .from(replies)
                        .where(
                            and(eq(replies.state, 'running'), lt(replies.leaseExpiresAt, now + 1))
                        )
                        .all()
                )
                const requeuedJobIds: string[] = [],
                    ambiguousJobIds: string[] = []
                for (const row of expired) {
                    const uncertain = row.effectStartedAt !== null
                    const updated = await updateClaim(row.id, row.claimToken!, {
                        state: uncertain ? 'ambiguous' : 'pending',
                        claimToken: null,
                        leaseExpiresAt: null,
                        updatedAt: now,
                        lastError: uncertain
                            ? 'The process stopped before the reply outcome was confirmed'
                            : null,
                    })
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
                const row = await runSync(database, () =>
                    database
                        .select()
                        .from(replies)
                        .where(
                            and(
                                eq(replies.state, 'pending'),
                                sql`not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = ${replies.projectId} and state <> 'active')`,
                                input.projectId === undefined
                                    ? undefined
                                    : eq(replies.projectId, input.projectId)
                            )
                        )
                        .orderBy(asc(replies.createdAt), asc(replies.id))
                        .get()
                )
                if (!row) return null
                return (
                    (await runSync(database, () =>
                        database
                            .update(replies)
                            .set({
                                state: 'running',
                                attempts: row.attempts + 1,
                                claimToken: input.claimToken,
                                leaseExpiresAt: input.leaseExpiresAt,
                                effectStartedAt: null,
                                updatedAt: input.now,
                            })
                            .where(and(eq(replies.id, row.id), eq(replies.state, 'pending')))
                            .returning()
                            .get()
                    )) ?? null
                )
            })()
        },
        async renewClaim(input) {
            const at = requireTimestamp(input.now, 'now')
            const expiry = requireTimestamp(input.leaseExpiresAt, 'leaseExpiresAt')
            if (expiry <= at) return false
            return (
                (await runSync(database, () =>
                    database
                        .update(replies)
                        .set({ leaseExpiresAt: expiry })
                        .where(
                            and(
                                eq(replies.id, requireNonBlank(input.jobId, 'jobId')),
                                eq(
                                    replies.claimToken,
                                    requireNonBlank(input.claimToken, 'claimToken')
                                ),
                                eq(replies.state, 'running'),
                                gt(replies.leaseExpiresAt, at),
                                lte(replies.leaseExpiresAt, expiry)
                            )
                        )
                        .returning({ id: replies.id })
                        .get()
                )) != null
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
                    const failed = await updateClaim(id, token, {
                        state: 'failed',
                        claimToken: null,
                        leaseExpiresAt: null,
                        updatedAt: now,
                        lastError: 'The original account or editor access is no longer available',
                    })
                    if (failed) await event(failed, 'publication_reply.failed', now)
                    return false
                }
                const updated = await updateClaim(id, token, {
                    effectStartedAt: now,
                    updatedAt: now,
                })
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
                const row = await updateClaim(input.jobId, input.claimToken, {
                    state,
                    claimToken: null,
                    leaseExpiresAt: null,
                    updatedAt: input.completedAt,
                    externalId: outcome.type === 'published' ? (outcome.externalId ?? null) : null,
                    externalUrl:
                        outcome.type === 'published' ? (outcome.externalUrl ?? null) : null,
                    lastError: outcome.type === 'published' ? null : outcome.errorMessage,
                })
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
            return database.sql.transaction(async () => {
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
            return database.sql.transaction(async () => {
                requireTimestamp(input.now, 'reply creation time')
                requireNonBlank(input.text, 'reply text')
                return defineTransaction(database, async () => {
                    if (
                        !(await access.canAccessProject(input.projectId, input.subjectId, 'editor'))
                    )
                        return null
                    const author = await runSync(database, () =>
                        database
                            .select()
                            .from(actors)
                            .where(
                                and(
                                    eq(actors.projectId, input.projectId),
                                    eq(actors.subjectId, input.subjectId)
                                )
                            )
                            .get()
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
                    await runSync(database, () => database.insert(replies).values(row).run())
                    await event(row, 'publication_reply.requested', input.now)
                    return row
                })()
            }, 'immediate')
        },
        async list(projectId: string, publicationId: string, subjectId: string, before?: string) {
            return database.sql.transaction(async () => {
                if (!(await access.canAccessProject(projectId, subjectId, 'viewer'))) return null
                const anchor = before ? await get(before) : null
                if (
                    before &&
                    (!anchor ||
                        anchor.projectId !== projectId ||
                        anchor.publicationId !== publicationId)
                )
                    return null
                const rows = await runSync(database, () =>
                    database
                        .select()
                        .from(replies)
                        .where(
                            and(
                                eq(replies.projectId, projectId),
                                eq(replies.publicationId, publicationId),
                                anchor
                                    ? or(
                                          lt(replies.createdAt, anchor.createdAt),
                                          and(
                                              eq(replies.createdAt, anchor.createdAt),
                                              lt(replies.id, anchor.id)
                                          )
                                      )
                                    : undefined
                            )
                        )
                        .orderBy(desc(replies.createdAt), desc(replies.id))
                        .limit(51)
                        .all()
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
            return (
                (
                    await runSync(database, () =>
                        database
                            .select({
                                at: sql<
                                    number | null
                                >`min(case when ${replies.state} = 'pending' then ${replies.createdAt} else ${replies.leaseExpiresAt} end)`,
                            })
                            .from(replies)
                            .where(
                                or(
                                    and(
                                        eq(replies.state, 'pending'),
                                        sql`not exists (select 1 from resource_lifecycles where kind = 'project' and resource_id = ${replies.projectId} and state <> 'active')`
                                    ),
                                    eq(replies.state, 'running')
                                )
                            )
                            .get()
                    )
                )?.at ?? null
            )
        },
    }
}
export type PublicationReplyStore = ReturnType<typeof createPublicationReplyStore>
