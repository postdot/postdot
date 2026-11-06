import { createHash } from 'node:crypto'

import type { MediaStore } from '@postdot/media'

import { defineTransaction, recordDatabaseCommitProject, type PostdotDatabase } from './client'
import { createEventJournalStore } from './event-journal-store'
import { deferForeignKeysSql } from './sql/dialect'
import { everySequential, mapSequential } from './sql/sequential'

export type ResourceKind = 'project' | 'workspace'
export type ResourceState = 'active' | 'archiving' | 'archived' | 'deleting' | 'deleted'
export class ResourceLifecycleError extends Error {
    constructor(
        readonly code: string,
        message: string
    ) {
        super(message)
    }
}
type Binding = string | number | null
type LifecycleRow = {
    kind: ResourceKind
    resource_id: string
    name: string
    state: ResourceState
    revision: number
    actor_id: string
    impact_json: string
    updated_at: number
}
const activity = new WeakMap<object, { requests: Map<string, number>; writes: number }>()

export function createResourceLifecycleStore(database: PostdotDatabase) {
    const sql = database.sql
    const live = activity.get(database) ?? { requests: new Map<string, number>(), writes: 0 }
    activity.set(database, live)
    const rows = <T>(text: string, ...params: Binding[]): Promise<T[]> =>
        sql.statement<T, Binding[]>(text).all(...params)
    const run = (text: string, ...params: Binding[]) => sql.statement(text).run(...params)
    const count = async (text: string, ...params: Binding[]) =>
        (await rows<{ n: number }>(text, ...params))[0]?.n ?? 0
    const record = async (kind: ResourceKind, id: string) =>
        (
            await rows<LifecycleRow>(
                'select * from resource_lifecycles where kind = ? and resource_id = ?',
                kind,
                id
            )
        )[0]
    const state = async (kind: ResourceKind, id: string): Promise<ResourceState> =>
        (await record(kind, id))?.state ?? 'active'
    async function projects(kind: ResourceKind, id: string) {
        return await rows<{
            id: string
            name: string
            updated_at: number
            workspace_id: string | null
        }>(
            `select id, name, updated_at, workspace_id from projects where ${kind === 'project' ? 'id' : 'workspace_id'} = ? order by id`,
            id
        )
    }
    async function impact(kind: ResourceKind, id: string) {
        const resource = (
            await rows<{ name: string; is_default?: number }>(
                `select name${kind === 'workspace' ? ', is_default' : ''} from ${kind === 'project' ? 'projects' : 'workspaces'} where id = ?`,
                id
            )
        )[0]
        const receipt = await record(kind, id)
        if (!resource && !receipt) return null
        const items = await projects(kind, id)
        const totals: Record<string, number> = {}
        const states: Record<string, number> = {}
        let changedAt = 0
        for (const project of items) {
            for (const table of [
                'posts',
                'publication_composer_drafts',
                'publications',
                'media_assets',
                'audit_events',
                'project_user_grants',
                'project_team_grants',
            ]) {
                totals[table] =
                    (totals[table] ?? 0) +
                    (await count(
                        `select count(*) as n from ${table} where project_id = ?`,
                        project.id
                    ))
            }
            // Channel resources are workspace-owned; a project uses them through active attachments.
            totals.channels =
                (totals.channels ?? 0) +
                (await count(
                    "select count(*) as n from project_channel_attachments where project_id = ? and state = 'active'",
                    project.id
                ))
            totals.publishers =
                (totals.publishers ?? 0) +
                (await count(
                    'select count(*) as n from project_channel_publishers where project_id = ?',
                    project.id
                ))
            totals.mediaBytes =
                (totals.mediaBytes ?? 0) +
                (await count(
                    'select coalesce(sum(byte_size), 0) as n from media_representations where project_id = ?',
                    project.id
                ))
            for (const row of await rows<{ state: string; n: number }>(
                'select state, count(*) as n from publications where project_id = ? group by state',
                project.id
            ))
                states[row.state] = (states[row.state] ?? 0) + row.n
            changedAt +=
                project.updated_at +
                (await count(
                    'select coalesce(max(updated_at), 0) as n from publications where project_id = ?',
                    project.id
                ))
        }
        let pending = 0
        let uncertain = 0
        let active = 0
        for (const project of items) {
            pending += await pendingCount(project.id)
            uncertain +=
                (await count(
                    "select count(*) as n from publications where project_id = ? and state = 'ambiguous'",
                    project.id
                )) +
                (await count(
                    "select count(*) as n from publication_comment_replies where project_id = ? and state = 'ambiguous'",
                    project.id
                )) +
                (await count(
                    "select count(*) as n from publication_first_comments where project_id = ? and state = 'ambiguous'",
                    project.id
                ))
            active += await running(project.id)
        }
        const members =
            kind === 'workspace'
                ? await count(
                      'select count(*) as n from member where organization_id = (select organization_id from workspaces where id = ?)',
                      id
                  )
                : 0
        if (kind === 'workspace') {
            // Shared channels are one resource, not one per attached project.
            totals.channels = await count(
                'select count(*) as n from channels where workspace_id = ?',
                id
            )
            totals.publishers = await count(
                'select count(*) as n from publishers where workspace_id = ?',
                id
            )
            totals.workspaceMembers = members
            totals.workspaceGroups = await count(
                'select count(*) as n from team where organization_id = (select organization_id from workspaces where id = ?)',
                id
            )
        }
        const snapshot = {
            kind,
            id,
            name: resource?.name ?? receipt!.name,
            state: await state(kind, id),
            revision: receipt?.revision ?? 0,
            isDefault: resource?.is_default === 1,
            projects: await mapSequential(items, async item => ({
                id: item.id,
                name: item.name,
                state: await state('project', item.id),
            })),
            counts: totals,
            publications: states,
            pending,
            uncertain,
            active,
            members,
            changedAt,
        }
        return {
            ...snapshot,
            fingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
            cleanupPending: await count(
                'select count(*) as n from resource_cleanup_objects where workspace_id = ? or project_id = ?',
                id,
                kind === 'project' ? id : ''
            ),
        }
    }
    async function pendingCount(id: string) {
        return (
            (await count(
                "select count(*) as n from publications where project_id = ? and state in ('scheduled', 'ready')",
                id
            )) +
            (await count(
                "select count(*) as n from publication_comment_replies where project_id = ? and (state = 'pending' or (state = 'running' and effect_started_at is null))",
                id
            )) +
            (await count(
                "select count(*) as n from publication_first_comments where project_id = ? and state in ('waiting', 'pending')",
                id
            ))
        )
    }
    async function running(id: string) {
        let total = 0
        for (const table of [
            'jobs',
            'notification_deliveries',
            'publication_comment_replies',
            'publication_first_comments',
        ]) {
            total += await count(
                `select count(*) as n from ${table} where project_id = ? and state = 'running'`,
                id
            )
        }
        return (
            total +
            (await count(
                "select count(*) as n from publications where project_id = ? and state = 'publishing'",
                id
            )) +
            (live.requests.get(id) ?? 0) +
            live.writes
        )
    }
    async function cancel(id: string, now: number) {
        await run(
            "update jobs set state = 'cancelled', claim_token = null, lease_expires_at = null, completed_at = ?, updated_at = ? where project_id = ? and state = 'running' and effect_started_at is null",
            now,
            now,
            id
        )
        await run(
            "update publication_comment_replies set state = 'failed', claim_token = null, lease_expires_at = null, last_error = 'Cancelled by resource retirement', updated_at = ? where project_id = ? and state = 'running' and effect_started_at is null",
            now,
            id
        )
        await run(
            "update publication_first_comments set state = 'cancelled', claim_token = null, lease_expires_at = null, updated_at = ? where project_id = ? and state = 'running' and effect_started_at is null",
            now,
            id
        )
        await run(
            "update notification_deliveries set state = 'failed', lease_token = null, lease_expires_at = null, failed_at = ?, last_error = 'Cancelled by resource retirement', updated_at = ? where project_id = ? and state = 'running' and effect_started_at is null",
            now,
            now,
            id
        )

        await run(
            "update jobs set state = 'cancelled', completed_at = ?, updated_at = ? where project_id = ? and state = 'pending'",
            now,
            now,
            id
        )
        await run(
            "update publications set state = 'cancelled', error_message = null, updated_at = ? where project_id = ? and state in ('scheduled', 'ready') and not exists (select 1 from jobs where jobs.project_id = publications.project_id and jobs.publication_id = publications.id and jobs.state = 'running')",
            now,
            id
        )
        await run(
            "update publication_first_comments set state = 'cancelled', claim_token = null, lease_expires_at = null, updated_at = ? where project_id = ? and state in ('waiting', 'pending', 'suspended')",
            now,
            id
        )
        // Replies have no cancelled state: failed, never claimed, is an explicit local cancellation.
        await run(
            "update publication_comment_replies set state = 'failed', last_error = 'Cancelled by resource retirement', updated_at = ? where project_id = ? and state = 'pending'",
            now,
            id
        )
        await run(
            "update notification_deliveries set state = 'failed', failed_at = ?, last_error = 'Cancelled by resource retirement', updated_at = ? where project_id = ? and state = 'pending'",
            now,
            now,
            id
        )
        await run(
            "update oauth_authorization_attempts set status = 'expired', completed_at = ?, updated_at = ? where project_id = ? and status = 'pending'",
            now,
            now,
            id
        )
    }
    async function writeState(
        kind: ResourceKind,
        id: string,
        name: string,
        next: ResourceState,
        actor: string,
        snapshot: unknown
    ) {
        await run(
            `insert into resource_lifecycles (kind, resource_id, name, state, revision, actor_id, impact_json, updated_at) values (?, ?, ?, ?, 1, ?, ?, ?) on conflict(kind, resource_id) do update set state = excluded.state, revision = resource_lifecycles.revision + 1, actor_id = excluded.actor_id, impact_json = excluded.impact_json, updated_at = excluded.updated_at`,
            kind,
            id,
            name,
            next,
            actor,
            JSON.stringify(snapshot),
            Date.now()
        )
        await run(
            'insert into resource_lifecycle_events (id, kind, resource_id, action, actor_id, impact_json, created_at) values (?, ?, ?, ?, ?, ?, ?)',
            crypto.randomUUID(),
            kind,
            id,
            next,
            actor,
            JSON.stringify(snapshot),
            Date.now()
        )
        if (kind === 'project') {
            const existing = (
                await rows<{ id: string }>(
                    "select id from actors where project_id = ? and subject_id = ? and kind = 'human' limit 1",
                    id,
                    actor
                )
            )[0]
            const actorId = existing?.id ?? crypto.randomUUID()
            if (!existing)
                await run(
                    "insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at) values (?, ?, 'human', ?, ?, ?, ?)",
                    actorId,
                    id,
                    actor,
                    (await rows<{ name: string }>('select name from "user" where id = ?', actor))[0]
                        ?.name ?? actor,
                    Date.now(),
                    Date.now()
                )
            await createEventJournalStore(database).append({
                projectId: id,
                actorId,
                name: 'project.lifecycle_updated',
                version: 1,
                subject: { type: 'project', id },
                payload: { state: next },
                occurredAt: Date.now(),
            })
            recordDatabaseCommitProject(database, id)
        }
    }
    const mutate = defineTransaction(
        database,
        async (input: {
            kind: ResourceKind
            id: string
            action: 'archive' | 'restore' | 'delete'
            actorId: string
            fingerprint: string
            confirmName?: string
            cancelPending?: boolean
            acknowledgeUncertain?: boolean
            replacementWorkspaceId?: string
            authorize: () => Promise<boolean>
        }) => {
            if (!(await input.authorize()))
                throw new ResourceLifecycleError(
                    'forbidden',
                    'Resource management permission required'
                )
            const current = await impact(input.kind, input.id)
            if (!current) throw new ResourceLifecycleError('not_found', 'Resource not found')
            if (current.fingerprint !== input.fingerprint)
                throw new ResourceLifecycleError(
                    'stale_impact',
                    'Resource changed; review its current impact'
                )
            if (current.state === 'deleted' || current.state === 'deleting')
                throw new ResourceLifecycleError(
                    'retirement_started',
                    'Deletion has already started'
                )
            if (input.action === 'archive' && current.state !== 'active')
                throw new ResourceLifecycleError(
                    'invalid_transition',
                    'Only an active resource can be archived'
                )
            if (input.action === 'restore') {
                if (current.state !== 'archived')
                    throw new ResourceLifecycleError(
                        'invalid_transition',
                        'Only an archived resource can be restored'
                    )
                if (input.kind === 'project') {
                    const workspace = (await projects('project', input.id))[0]?.workspace_id
                    if (workspace && (await state('workspace', workspace)) !== 'active')
                        throw new ResourceLifecycleError(
                            'workspace_archived',
                            'Restore the workspace first'
                        )
                }
                await writeState(
                    input.kind,
                    input.id,
                    current.name,
                    'active',
                    input.actorId,
                    current
                )
                return (await impact(input.kind, input.id))!
            }
            if (current.pending && !input.cancelPending)
                throw new ResourceLifecycleError(
                    'cancellation_required',
                    'Confirm cancellation of pending publication work'
                )
            if (input.action === 'delete' && input.confirmName !== current.name)
                throw new ResourceLifecycleError(
                    'name_required',
                    'Type the resource name to confirm permanent deletion'
                )
            if (input.action === 'delete' && current.uncertain && !input.acknowledgeUncertain)
                throw new ResourceLifecycleError(
                    'uncertain_outcomes',
                    'Acknowledge unresolved external publication outcomes'
                )
            if (current.isDefault) {
                if (
                    !input.replacementWorkspaceId ||
                    input.replacementWorkspaceId === input.id ||
                    (await state('workspace', input.replacementWorkspaceId)) !== 'active'
                )
                    throw new ResourceLifecycleError(
                        'replacement_required',
                        'Choose an active replacement default workspace'
                    )
                if (
                    !(
                        await rows(
                            'select id from workspaces where id = ?',
                            input.replacementWorkspaceId
                        )
                    ).length
                )
                    throw new ResourceLifecycleError(
                        'replacement_required',
                        'Replacement workspace not found'
                    )
                await run('update workspaces set is_default = 0 where id = ?', input.id)
                await run(
                    'update workspaces set is_default = 1 where id = ?',
                    input.replacementWorkspaceId
                )
                await run(
                    'update instance_state set default_workspace_id = ?, updated_at = ? where default_workspace_id = ?',
                    input.replacementWorkspaceId,
                    Date.now(),
                    input.id
                )
            }
            const next = input.action === 'delete' ? 'deleting' : 'archiving'
            for (const project of current.projects) {
                if ((await state('project', project.id)) === 'deleted') continue
                await cancel(project.id, Date.now())
                if (input.action === 'delete' || (await state('project', project.id)) === 'active')
                    await writeState(
                        'project',
                        project.id,
                        project.name,
                        next,
                        input.actorId,
                        await impact('project', project.id)
                    )
            }
            if (input.kind === 'workspace')
                await writeState(input.kind, input.id, current.name, next, input.actorId, current)
            await finalize()
            return (await impact(input.kind, input.id))!
        }
    )
    async function finalize() {
        for (const item of await rows<LifecycleRow>(
            "select * from resource_lifecycles where kind = 'project' and state in ('archiving', 'deleting')"
        )) {
            if (await running(item.resource_id)) continue
            await cancel(item.resource_id, Date.now())
            if (item.state === 'archiving')
                await writeState(
                    'project',
                    item.resource_id,
                    item.name,
                    'archived',
                    item.actor_id,
                    JSON.parse(item.impact_json)
                )
            else {
                const objects = await rows<{ store_id: string; object_key: string }>(
                    'select distinct store_id, object_key from media_representations where project_id = ?',
                    item.resource_id
                )
                for (const object of objects)
                    await run(
                        'insert into resource_cleanup_objects (id, project_id, workspace_id, store_id, object_key, attempts, updated_at) values (?, ?, ?, ?, ?, 0, ?) on conflict do nothing',
                        createHash('sha256')
                            .update(
                                JSON.stringify([
                                    item.resource_id,
                                    object.store_id,
                                    object.object_key,
                                ])
                            )
                            .digest('hex'),
                        item.resource_id,
                        (await projects('project', item.resource_id))[0]?.workspace_id ?? null,
                        object.store_id,
                        object.object_key,
                        Date.now()
                    )
                // Original/derived media can cascade in either order. Keep FK enforcement
                // enabled, but validate the complete graph at the outer transaction commit.
                await run(deferForeignKeysSql(sql.dialect))
                await run('delete from projects where id = ?', item.resource_id)
                if (
                    !(await count(
                        'select count(*) as n from resource_cleanup_objects where project_id = ?',
                        item.resource_id
                    ))
                )
                    await run(
                        "update resource_lifecycles set state = 'deleted' where kind = 'project' and resource_id = ?",
                        item.resource_id
                    )
            }
        }
        for (const item of await rows<LifecycleRow>(
            "select * from resource_lifecycles where kind = 'workspace' and state in ('archiving', 'deleting')"
        )) {
            if (item.state === 'archiving') {
                if (
                    await everySequential(
                        await projects('workspace', item.resource_id),
                        async project => (await state('project', project.id)) === 'archived'
                    )
                )
                    await run(
                        "update resource_lifecycles set state = 'archived' where kind = 'workspace' and resource_id = ?",
                        item.resource_id
                    )
            } else if (
                !(await projects('workspace', item.resource_id)).length &&
                !(await count(
                    'select count(*) as n from resource_cleanup_objects where workspace_id = ?',
                    item.resource_id
                ))
            ) {
                const workspace = (
                    await rows<{ organization_id: string }>(
                        'select organization_id from workspaces where id = ?',
                        item.resource_id
                    )
                )[0]
                await run(deferForeignKeysSql(sql.dialect))
                await run('delete from workspaces where id = ?', item.resource_id)
                if (workspace)
                    await run('delete from organization where id = ?', workspace.organization_id)
                await run(
                    "update resource_lifecycles set state = 'deleted' where kind = 'workspace' and resource_id = ?",
                    item.resource_id
                )
            }
        }
    }
    return {
        state,
        impact,
        async retired() {
            return (
                await rows<LifecycleRow>(
                    "select * from resource_lifecycles where state in ('archived', 'archiving', 'deleting') order by updated_at desc"
                )
            ).map(item => ({ kind: item.kind, id: item.resource_id }))
        },
        async canReadReceipt(kind: ResourceKind, id: string, actorId: string) {
            return database.sql.transaction(async () => {
                return (
                    (await record(kind, id))?.actor_id === actorId &&
                    !(
                        await rows(
                            `select id from ${kind === 'project' ? 'projects' : 'workspaces'} where id = ?`,
                            id
                        )
                    ).length
                )
            }, 'deferred')
        },
        async projectState(id: string): Promise<ResourceState> {
            return database.sql.transaction(async () => {
                const workspace = (await projects('project', id))[0]?.workspace_id
                const own = await state('project', id)
                return own !== 'active' ? own : workspace ? state('workspace', workspace) : own
            }, 'deferred')
        },
        async isInitiator(kind: ResourceKind, id: string, actorId: string) {
            return (await record(kind, id))?.actor_id === actorId
        },
        mutate: (input: Parameters<typeof mutate>[0]) => mutate.immediate(input),
        beginRequest(projectId: string) {
            live.requests.set(projectId, (live.requests.get(projectId) ?? 0) + 1)
            return () =>
                live.requests.set(projectId, Math.max(0, (live.requests.get(projectId) ?? 1) - 1))
        },
        wrapMedia(store: MediaStore): MediaStore {
            return {
                storeId: store.storeId,
                maxObjectBytes: store.maxObjectBytes,
                stat: store.stat.bind(store),
                open: store.open.bind(store),
                delete: store.delete.bind(store),
                async put(...args) {
                    const owner = (
                        await rows<{ project_id: string }>(
                            'select project_id from media_representations where object_key = ?',
                            args[0]
                        )
                    )[0]
                    if (owner && (await state('project', owner.project_id)) !== 'active')
                        throw new ResourceLifecycleError(
                            'resource_read_only',
                            'Resource retirement prevents new object writes'
                        )
                    live.writes++
                    try {
                        return await store.put(...args)
                    } finally {
                        live.writes--
                    }
                },
            }
        },
        async reconcile(store: MediaStore) {
            await database.sql.transaction(finalize, 'immediate')
            if (
                live.writes ||
                (await count(
                    'select count(*) as n from media_backup_fences where expires_at > ?',
                    Date.now()
                ))
            )
                return
            for (const object of await rows<{
                id: string
                store_id: string
                object_key: string
                project_id: string
            }>('select * from resource_cleanup_objects order by updated_at limit 50')) {
                if (
                    live.writes ||
                    (await count(
                        'select count(*) as n from media_backup_fences where expires_at > ?',
                        Date.now()
                    ))
                )
                    break
                if (object.store_id !== store.storeId) continue
                try {
                    await store.delete(object.object_key)
                    await run('delete from resource_cleanup_objects where id = ?', object.id)
                } catch {
                    await run(
                        'update resource_cleanup_objects set attempts = attempts + 1, updated_at = ? where id = ?',
                        Date.now(),
                        object.id
                    )
                }
            }
            await run(
                "update resource_lifecycles set state = 'deleted' where kind = 'project' and state = 'deleting' and not exists (select 1 from projects where id = resource_lifecycles.resource_id) and not exists (select 1 from resource_cleanup_objects where project_id = resource_lifecycles.resource_id)"
            )
        },
    }
}
export type ResourceLifecycleStore = ReturnType<typeof createResourceLifecycleStore>
