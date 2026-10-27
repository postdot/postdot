import { requireNonBlank, requireTimestamp, type WorkspaceActor } from '@postdot/core'

import { createDatabaseTransaction, type PostbotDatabase } from './client'

interface WorkspaceActorStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
}

/** Internal attribution only. An actor record is never an authorization grant. */
export function createWorkspaceActorStore(
    database: PostbotDatabase,
    options: WorkspaceActorStoreOptions = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const fields = `id, workspace_id as workspaceId, origin_actor_id as originActorId,
        kind, subject_id as subjectId, display_name as displayName,
        created_at as createdAt, updated_at as updatedAt`
    const load = client.query<WorkspaceActor, [string, string]>(
        `select ${fields} from actors where workspace_id = ?1 and id = ?2`
    )
    const source = client.query<
        Pick<WorkspaceActor, 'id' | 'kind' | 'subjectId' | 'displayName'>,
        [string, string]
    >(`select a.id, a.kind, a.subject_id as subjectId, a.display_name as displayName
        from actors a join projects p on p.id = a.project_id
        where a.id = ?1 and p.workspace_id = ?2`)
    const existing = client.query<WorkspaceActor, [string, string]>(
        `select ${fields} from actors where workspace_id = ?1 and origin_actor_id = ?2`
    )
    const insert = client.query(`insert into actors
        (id, workspace_id, origin_actor_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`)
    const ensure = createDatabaseTransaction(
        database,
        (workspaceId: string, projectActorId: string): WorkspaceActor | null => {
            // Resolve the real project/workspace relation before returning an old
            // snapshot too. Do not infer membership from an arbitrary subject ID.
            const actor = source.get(projectActorId, workspaceId)
            if (!actor) return null
            const previous = existing.get(workspaceId, projectActorId)
            if (previous) return previous
            const timestamp = requireTimestamp(now(), 'now')
            const id = requireNonBlank(createId(), 'actor id')
            insert.run(
                id,
                workspaceId,
                actor.id,
                actor.kind,
                actor.subjectId,
                actor.displayName,
                timestamp
            )
            return load.get(workspaceId, id)
        }
    )
    return {
        /** Snapshot attribution without backdating or tying its lifetime to the source project. */
        ensureFromProjectActor(input: {
            readonly workspaceId: string
            readonly projectActorId: string
        }): WorkspaceActor | null {
            return ensure.immediate(
                requireNonBlank(input.workspaceId, 'workspaceId'),
                requireNonBlank(input.projectActorId, 'projectActorId')
            )
        },
        get(workspaceId: string, actorId: string): WorkspaceActor | null {
            return load.get(
                requireNonBlank(workspaceId, 'workspaceId'),
                requireNonBlank(actorId, 'actorId')
            )
        },
    }
}
