import type { ChannelProfileDefinition } from '@postdot/core'

import type { PostbotDatabase } from './client'
import { createWorkspaceActorStore } from './workspace-actor-store'

/** Test fixture: an idempotent workspace row so projects can be created under the required ownership boundary. */
export function seedTestWorkspace(database: PostbotDatabase, id = 'test-workspace'): string {
    database.$client
        .query('insert or ignore into organization(id,name,slug,created_at) values (?1,?1,?1,1)')
        .run(id)
    database.$client
        .query(
            'insert or ignore into workspaces(id,organization_id,name,slug,created_at,updated_at) values (?1,?1,?1,?1,1,1)'
        )
        .run(id)
    return id
}

/** Test fixture: the workspace that owns a project, for rows that are workspace-scoped. */
export function workspaceOf(database: PostbotDatabase, projectId: string): string {
    const row = database.$client
        .query<{ workspaceId: string | null }, [string]>(
            'select workspace_id as workspaceId from projects where id = ?'
        )
        .get(projectId)
    if (!row?.workspaceId) throw new Error(`Project ${projectId} has no workspace`)
    return row.workspaceId
}

/** Test fixture: a workspace-owned channel with its first attachment and managing project. */
export function seedWorkspaceChannel(
    database: PostbotDatabase,
    input: {
        readonly projectId: string
        readonly channelId: string
        readonly name: string
        readonly profileVersionId: string
        readonly profile: ChannelProfileDefinition
        /** Project actor recorded as the creator. */
        readonly createdByActorId: string
        readonly state?: 'active' | 'archived'
    }
): { readonly workspaceId: string; readonly workspaceActorId: string } {
    const client = database.$client
    const current = client
        .query<{ workspaceId: string | null }, [string]>(
            'select workspace_id as workspaceId from projects where id = ?'
        )
        .get(input.projectId)
    if (!current) throw new Error(`Project ${input.projectId} does not exist`)
    const workspaceId = current.workspaceId ?? seedTestWorkspace(database)
    if (current.workspaceId === null)
        client
            .query('update projects set workspace_id = ? where id = ?')
            .run(workspaceId, input.projectId)
    const actor = createWorkspaceActorStore(database).ensureFromProjectActor({
        workspaceId,
        projectActorId: input.createdByActorId,
    })
    if (!actor) throw new Error('The creator is not an actor of the project')
    const at = Date.now()
    const archived = input.state === 'archived'
    client
        .query(
            `insert into channels (id,workspace_id,name,profile_version_id,state,archived_at,created_at,updated_at) values (?,?,?,?,?,?,?,?)`
        )
        .run(
            input.channelId,
            workspaceId,
            input.name,
            input.profileVersionId,
            archived ? 'archived' : 'active',
            archived ? at : null,
            at,
            at
        )
    client
        .query(
            `insert into channel_profile_versions (id,workspace_id,channel_id,profile_id,version,origin,state,profile_json,profile_hash,schema_hash,created_by_actor_id,created_at,updated_at) values (?,?,?,?,?,?,'active',?,?,?,?,?,?)`
        )
        .run(
            input.profileVersionId,
            workspaceId,
            input.channelId,
            input.profile.id,
            input.profile.version,
            input.profile.origin,
            JSON.stringify(input.profile),
            input.profile.profileHash,
            input.profile.schemaHash,
            actor.id,
            at,
            at
        )
    client
        .query(
            `insert into project_channel_attachments (project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,?)`
        )
        .run(input.projectId, input.channelId, workspaceId, actor.id, at)
    client
        .query(`insert into channel_managers (channel_id,project_id,workspace_id) values (?,?,?)`)
        .run(input.channelId, input.projectId, workspaceId)
    return { workspaceId, workspaceActorId: actor.id }
}

/** Test fixture: workspace membership, required before project grants take effect for a workspace project. */
export function seedWorkspaceMember(
    database: PostbotDatabase,
    workspaceId: string,
    userId: string
): void {
    database.$client
        .query(
            `insert or ignore into member (id, organization_id, user_id, role, created_at)
             select ?1, organization_id, ?2, 'member', 1 from workspaces where id = ?3`
        )
        .run(`member:${workspaceId}:${userId}`, userId, workspaceId)
}
