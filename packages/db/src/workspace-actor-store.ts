import { requireNonBlank, requireTimestamp, type WorkspaceActor } from '@postdot/core'

import { defineTransaction, type PostdotDatabase } from './client'

interface WorkspaceActorStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
}

/** Internal attribution only. An actor record is never an authorization grant. */
export function createWorkspaceActorStore(
    database: PostdotDatabase,
    options: WorkspaceActorStoreOptions = {}
) {
    const sql = database.sql
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const fields = `id, workspace_id as workspaceId, origin_actor_id as originActorId,
        kind, subject_id as subjectId, display_name as displayName,
        created_at as createdAt, updated_at as updatedAt`
    const load = sql.statement<WorkspaceActor, [string, string]>(
        `select ${fields} from actors where workspace_id = ?1 and id = ?2`
    )
    const source = sql.statement<
        Pick<WorkspaceActor, 'id' | 'kind' | 'subjectId' | 'displayName'>,
        [string, string]
    >(`select a.id, a.kind, a.subject_id as subjectId, a.display_name as displayName
        from actors a join projects p on p.id = a.project_id
        where a.id = ?1 and p.workspace_id = ?2`)
    const existing = sql.statement<WorkspaceActor, [string, string]>(
        `select ${fields} from actors where workspace_id = ?1 and origin_actor_id = ?2`
    )
    const insert = sql.statement(`insert into actors
        (id, workspace_id, origin_actor_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
    const ensure = defineTransaction(
        database,
        async (workspaceId: string, projectActorId: string): Promise<WorkspaceActor | null> => {
            // Resolve the real project/workspace relation before returning an old
            // snapshot too. Do not infer membership from an arbitrary subject ID.
            const actor = await source.get(projectActorId, workspaceId)
            if (!actor) return null
            const previous = await existing.get(workspaceId, projectActorId)
            if (previous) return previous
            const timestamp = requireTimestamp(now(), 'now')
            const id = requireNonBlank(createId(), 'actor id')
            await insert.run(
                id,
                workspaceId,
                actor.id,
                actor.kind,
                actor.subjectId,
                actor.displayName,
                timestamp
            )
            return await load.get(workspaceId, id)
        }
    )
    return {
        /** Attribution for an authenticated workspace request; the caller supplies live authorization. */
        async ensureForSubject(input: {
            workspaceId: string
            subjectId: string
            displayName: string
        }): Promise<WorkspaceActor> {
            return database.sql.transaction(async () => {
                return defineTransaction(database, async () => {
                    const previous = await sql
                        .statement<WorkspaceActor, [string, string]>(`select ${fields} from actors
                    where workspace_id=? and subject_id=? and kind='human' and origin_actor_id is null order by created_at,id limit 1`)
                        .get(input.workspaceId, input.subjectId)
                    if (previous) return previous
                    const timestamp = requireTimestamp(now(), 'now')
                    const id = requireNonBlank(createId(), 'actorId')
                    await insert.run(
                        id,
                        requireNonBlank(input.workspaceId, 'workspaceId'),
                        null,
                        'human',
                        requireNonBlank(input.subjectId, 'subjectId'),
                        requireNonBlank(input.displayName, 'displayName'),
                        timestamp
                    )
                    return await (await load.get(input.workspaceId, id))!
                }).immediate()
            }, 'immediate')
        },
        /** Snapshot attribution without backdating or tying its lifetime to the source project. */
        async ensureFromProjectActor(input: {
            readonly workspaceId: string
            readonly projectActorId: string
        }): Promise<WorkspaceActor | null> {
            return ensure.immediate(
                requireNonBlank(input.workspaceId, 'workspaceId'),
                requireNonBlank(input.projectActorId, 'projectActorId')
            )
        },
        async get(workspaceId: string, actorId: string): Promise<WorkspaceActor | null> {
            return await load.get(
                requireNonBlank(workspaceId, 'workspaceId'),
                requireNonBlank(actorId, 'actorId')
            )
        },
    }
}
