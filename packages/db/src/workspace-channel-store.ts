import {
    ChannelProfileCompiler,
    createChannel,
    createManualChannelProfile,
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ChannelProfileDefinition,
} from '@postdot/core'

import { createChannelCadenceStore, validateCadence, type ChannelCadence } from './channel-cadence'
import { defineTransaction, recordDatabaseCommitProject, type DatabaseHandle } from './client'
import { createEventJournalStore } from './event-journal-store'
import { normalizeCreationProfile } from './manual-store/channel-profile-definition'
import { invalidProfileError } from './manual-store/content-codec'
import { toProject } from './manual-store/project-channel-mappers'
import type { ProjectRow } from './manual-store/rows'
import { scalarMaxSql } from './sql/dialect'
import { filterSequential, mapSequential, someSequential } from './sql/sequential'
import { createWorkspaceActorStore } from './workspace-actor-store'

export type ChannelProjectAction =
    | 'read_channels'
    | 'create_channels'
    | 'manage_channels'
    | 'share_channels'
    | 'attach_channels'
    | 'withdraw_channels'
    | 'accept_channel_management'
export type ChannelManagementIntent = 'manage_channels' | 'share_channels'

/** Request-bound adapter to the common live authorization path; never an actor-derived grant. */
/** Request-bound authorization port; decisions may read persistence (ADR-097). */
export interface ChannelAccessPolicy {
    authorizeProject(projectId: string, action: ChannelProjectAction): Promise<boolean>
    authorizeWorkspace(workspaceId: string, action: ChannelManagementIntent): Promise<boolean>
    /** Includes the sharing capability and key scope for every affected/context project. */
    authorizeSharing(projectIds: readonly string[]): Promise<boolean>
}

export interface WorkspaceChannelContext {
    readonly actorId: string
    readonly authorization: ChannelAccessPolicy
    readonly contextProjectId?: string
}

export interface ChannelRecord {
    readonly id: string
    readonly workspaceId: string
    readonly name: string
    readonly profileVersionId: string
    readonly profileId: string
    readonly state: 'active' | 'archived'
    readonly archivedAt: number | null
    readonly revision: number
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ProjectChannelView extends ChannelRecord {
    /** An attachment context, not ownership. */
    readonly projectId: string
    readonly attachmentState: 'active' | 'detached'
    readonly attachmentRevision: number
    readonly profileId: string
    readonly shared: boolean
    readonly canManage: boolean
    readonly canShare: boolean
    readonly canWithdraw: boolean
    readonly management:
        | { readonly kind: 'workspace' }
        | {
              readonly kind: 'project'
              readonly project: { readonly id: string; readonly name: string } | null
          }
}

export type WorkspaceChannelView = Omit<
    ProjectChannelView,
    'projectId' | 'attachmentState' | 'attachmentRevision' | 'canWithdraw'
>

export interface ChannelOccupancyItem {
    readonly channelId: string
    /** Scheduled time, or the recorded publication time once published. */
    readonly at: number
    readonly state: 'scheduled' | 'ready' | 'publishing' | 'published' | 'ambiguous'
    /**
     * Present only for a project the caller can read. Otherwise the item is anonymous:
     * no name, content, publication identity or project count.
     */
    readonly project: {
        readonly id: string
        readonly name: string
        readonly publicationId: string
        readonly title: string | null
    } | null
}

export type MutationResult =
    | { readonly kind: 'not_found' }
    | { readonly kind: 'stale'; readonly revision: number }
    | { readonly kind: 'unchanged'; readonly revision: number }
    | { readonly kind: 'changed'; readonly revision: number }
    | { readonly kind: 'retirement_required'; readonly revision: number }

/** Canonical workspace schema only. Wired into the runtime when its ownership migration is activated. */
export function createWorkspaceChannelStore(
    database: DatabaseHandle,
    options: { readonly now?: () => number; readonly createId?: () => string } = {}
) {
    const sql = database.sql
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const journal = createEventJournalStore(database, { createId })
    const compiler = new ChannelProfileCompiler()
    const project = sql.statement<ProjectRow, [string]>(
        `select id,name,time_zone as timeZone,workspace_id as workspaceId,primary_category_id as primaryCategoryId,created_at as createdAt,updated_at as updatedAt from projects where id=?`
    )
    const channel = sql.statement<ChannelRecord, [string]>(
        `select c.id,c.workspace_id as workspaceId,c.name,c.profile_version_id as profileVersionId,p.profile_id as profileId,c.state,c.archived_at as archivedAt,c.revision,c.created_at as createdAt,c.updated_at as updatedAt from channels c join channel_profile_versions p on p.workspace_id=c.workspace_id and p.channel_id=c.id and p.id=c.profile_version_id where c.id=?`
    )
    const manager = sql.statement<{ projectId: string; name: string }, [string]>(
        `select m.project_id as projectId,p.name from channel_managers m join projects p on p.id=m.project_id where m.channel_id=?`
    )
    const attachment = sql.statement<
        { state: 'active' | 'detached'; revision: number },
        [string, string]
    >(`select state,revision from project_channel_attachments where project_id=? and channel_id=?`)
    const validActor = sql.statement<{ id: string }, [string, string]>(
        `select id from actors where workspace_id=? and id=?`
    )
    const lifecycle = sql.statement<{ state: string }, [string, string]>(
        `select state from resource_lifecycles where kind=? and resource_id=?`
    )
    const isActive = async (kind: 'workspace' | 'project', id: string) => {
        const value = await lifecycle.get(kind, id)
        return value === null || value.state === 'active'
    }
    const manages = async (
        ctx: WorkspaceChannelContext,
        row: ChannelRecord,
        intent: ChannelManagementIntent
    ) => {
        if (!(await isActive('workspace', row.workspaceId))) return false
        if ((await ctx.authorization.authorizeWorkspace(row.workspaceId, intent)) === true)
            return true
        const managing = await manager.get(row.id)
        return (
            managing !== null &&
            (await isActive('project', managing.projectId)) &&
            (await ctx.authorization.authorizeProject(managing.projectId, intent)) === true
        )
    }
    const affected = async (ctx: WorkspaceChannelContext, row: ChannelRecord, target: string) => {
        const source = (await manager.get(row.id))?.projectId
        return [
            ...new Set(
                [ctx.contextProjectId, source, target].filter(
                    (id): id is string => id !== undefined
                )
            ),
        ].sort()
    }
    const allowedActor = async (ctx: WorkspaceChannelContext, row: ChannelRecord) =>
        (await validActor.get(row.workspaceId, requireNonBlank(ctx.actorId, 'actorId'))) !== null
    const validateRevision = (revision: number) => {
        if (!Number.isSafeInteger(revision) || revision < 1)
            throw new DomainInvariantError(
                'invalid_input',
                'Expected channel revision must be a positive safe integer'
            )
    }
    const record = async (
        ctx: WorkspaceChannelContext,
        row: ChannelRecord,
        name: string,
        projectId: string,
        timestamp: number,
        payload: Readonly<Record<string, unknown>> = {}
    ) => {
        await journal.appendWorkspace({
            workspaceId: row.workspaceId,
            actorId: ctx.actorId,
            name,
            version: 1,
            subject: { type: 'channel', id: row.id },
            payload: { projectId, ...payload },
            occurredAt: timestamp,
        })
        recordDatabaseCommitProject(database, projectId)
    }
    const bump = async (row: ChannelRecord, timestamp: number) => {
        const result = await sql
            .statement(
                'update channels set revision=revision+1,updated_at=? where id=? and revision=?'
            )
            .run(timestamp, row.id, row.revision)
        if (result.changes !== 1)
            throw new Error('Channel revision changed inside its write transaction')
        return row.revision + 1
    }

    const create = defineTransaction(
        database,
        async (
            ctx: WorkspaceChannelContext,
            input: { projectId: string; name: string; profile?: ChannelProfileDefinition }
        ) => {
            const target = await project.get(input.projectId)
            if (
                !target?.workspaceId ||
                (await ctx.authorization.authorizeProject(target.id, 'create_channels')) !== true ||
                !(await isActive('project', target.id)) ||
                !(await isActive('workspace', target.workspaceId)) ||
                !(await validActor.get(target.workspaceId, ctx.actorId))
            )
                return { kind: 'not_found' } as const
            const compiled = compiler.compile(
                normalizeCreationProfile(input.profile ?? createManualChannelProfile())
            )
            if (!compiled.ok) throw invalidProfileError(compiled.issues)
            const profile = compiled.value.profile
            const timestamp = requireTimestamp(now(), 'now')
            const value = createChannel({
                id: createId(),
                project: toProject(target),
                name: input.name,
                profileId: profile.id,
                profileVersionId: createId(),
                now: timestamp,
            })
            await sql
                .statement(
                    `insert into channels (id,workspace_id,name,profile_version_id,created_at,updated_at) values (?,?,?,?,?,?)`
                )
                .run(
                    value.id,
                    target.workspaceId,
                    value.name,
                    value.profileVersionId,
                    timestamp,
                    timestamp
                )
            await sql
                .statement(
                    `insert into channel_profile_versions (id,workspace_id,channel_id,profile_id,version,origin,state,profile_json,profile_hash,schema_hash,created_by_actor_id,created_at,updated_at) values (?,?,?,?,?,?,'active',?,?,?,?,?,?)`
                )
                .run(
                    value.profileVersionId,
                    target.workspaceId,
                    value.id,
                    profile.id,
                    profile.version,
                    profile.origin,
                    JSON.stringify(profile),
                    profile.profileHash,
                    profile.schemaHash,
                    ctx.actorId,
                    timestamp,
                    timestamp
                )
            await sql
                .statement(
                    `insert into project_channel_attachments (project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,?)`
                )
                .run(target.id, value.id, target.workspaceId, ctx.actorId, timestamp)
            await sql
                .statement(
                    `insert into channel_managers (channel_id,project_id,workspace_id) values (?,?,?)`
                )
                .run(value.id, target.id, target.workspaceId)
            const saved = (await channel.get(value.id))!
            await record(ctx, saved, 'channel.created', target.id, timestamp)
            return { kind: 'created', channel: saved } as const
        }
    )

    const attach = defineTransaction(
        database,
        async (
            ctx: WorkspaceChannelContext,
            input: { channelId: string; projectId: string; expectedRevision: number }
        ): Promise<MutationResult> => {
            const row = await channel.get(input.channelId),
                target = await project.get(input.projectId)
            if (
                !row ||
                row.state !== 'active' ||
                target?.workspaceId !== row.workspaceId ||
                !(await isActive('project', target.id)) ||
                !(await isActive('workspace', row.workspaceId)) ||
                !(await allowedActor(ctx, row)) ||
                !(await manages(ctx, row, 'share_channels')) ||
                (await ctx.authorization.authorizeProject(target.id, 'attach_channels')) !== true ||
                (await ctx.authorization.authorizeSharing(await affected(ctx, row, target.id))) !==
                    true
            )
                return { kind: 'not_found' }
            validateRevision(input.expectedRevision)
            if (input.expectedRevision !== row.revision)
                return { kind: 'stale', revision: row.revision }
            const existing = await attachment.get(target.id, row.id)
            if (existing?.state === 'active') return { kind: 'unchanged', revision: row.revision }
            const timestamp = requireTimestamp(now(), 'now')
            if (existing)
                await sql
                    .statement(
                        `update project_channel_attachments set state='active',detached_at=NULL,revision=revision+1 where project_id=? and channel_id=?`
                    )
                    .run(target.id, row.id)
            else
                await sql
                    .statement(
                        `insert into project_channel_attachments(project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,?)`
                    )
                    .run(target.id, row.id, row.workspaceId, ctx.actorId, timestamp)
            const revision = await bump(row, timestamp)
            await record(ctx, row, 'channel.project_attached', target.id, timestamp)
            return { kind: 'changed', revision }
        }
    )

    const detach = defineTransaction(
        database,
        async (
            ctx: WorkspaceChannelContext,
            input: {
                channelId: string
                projectId: string
                expectedRevision: number
                lastAttachment?: 'archive'
            }
        ): Promise<MutationResult> => {
            const row = await channel.get(input.channelId),
                target = await project.get(input.projectId)
            if (
                !row ||
                target?.workspaceId !== row.workspaceId ||
                !(await isActive('project', target.id)) ||
                !(await isActive('workspace', row.workspaceId)) ||
                !(await allowedActor(ctx, row)) ||
                !(
                    (await ctx.authorization.authorizeProject(target.id, 'withdraw_channels')) ===
                        true || (await manages(ctx, row, 'share_channels'))
                ) ||
                (await ctx.authorization.authorizeSharing(
                    (await ctx.authorization.authorizeProject(target.id, 'withdraw_channels')) ===
                        true
                        ? [
                              ...new Set(
                                  [ctx.contextProjectId, target.id].filter(
                                      (id): id is string => id !== undefined
                                  )
                              ),
                          ].sort()
                        : await affected(ctx, row, target.id)
                )) !== true
            )
                return { kind: 'not_found' }
            const existing = await attachment.get(target.id, row.id)
            if (!existing) return { kind: 'not_found' }
            validateRevision(input.expectedRevision)
            if (input.expectedRevision !== row.revision)
                return { kind: 'stale', revision: row.revision }
            if (existing.state === 'detached') return { kind: 'unchanged', revision: row.revision }
            const last =
                (
                    await sql
                        .statement<{ present: number }, [string, string]>(
                            "select exists(select 1 from project_channel_attachments where channel_id=? and project_id<>? and state='active') as present"
                        )
                        .get(row.id, target.id)
                )?.present !== 1
            const archive = last && row.state === 'active'
            if (archive && input.lastAttachment !== 'archive')
                return { kind: 'retirement_required', revision: row.revision }
            const timestamp = requireTimestamp(now(), 'now')
            await sql
                .statement(
                    `update project_channel_attachments set state='detached',detached_at=?,revision=revision+1 where project_id=? and channel_id=?`
                )
                .run(timestamp, target.id, row.id)
            if (archive)
                await sql
                    .statement("update channels set state='archived',archived_at=? where id=?")
                    .run(timestamp, row.id)
            const revision = await bump(row, timestamp)
            await record(ctx, row, 'channel.project_detached', target.id, timestamp)
            if (archive) await record(ctx, row, 'channel.archived', target.id, timestamp)
            return { kind: 'changed', revision }
        }
    )

    const transfer = defineTransaction(
        database,
        async (
            ctx: WorkspaceChannelContext,
            input: { channelId: string; projectId: string; expectedRevision: number }
        ): Promise<MutationResult> => {
            const row = await channel.get(input.channelId),
                target = await project.get(input.projectId)
            if (
                !row ||
                target?.workspaceId !== row.workspaceId ||
                !(await isActive('workspace', row.workspaceId)) ||
                !(await isActive('project', target.id)) ||
                !(await allowedActor(ctx, row)) ||
                !(await manages(ctx, row, 'share_channels')) ||
                (await ctx.authorization.authorizeProject(
                    target.id,
                    'accept_channel_management'
                )) !== true ||
                (await ctx.authorization.authorizeSharing(await affected(ctx, row, target.id))) !==
                    true ||
                (await attachment.get(target.id, row.id))?.state !== 'active'
            )
                return { kind: 'not_found' }
            validateRevision(input.expectedRevision)
            if (input.expectedRevision !== row.revision)
                return { kind: 'stale', revision: row.revision }
            const previousManager = await manager.get(row.id)
            if (previousManager?.projectId === target.id)
                return { kind: 'unchanged', revision: row.revision }
            const timestamp = requireTimestamp(now(), 'now')
            await sql
                .statement(
                    `insert into channel_managers(channel_id,project_id,workspace_id) values (?,?,?) on conflict(channel_id) do update set project_id=excluded.project_id,workspace_id=excluded.workspace_id`
                )
                .run(row.id, target.id, row.workspaceId)
            const revision = await bump(row, timestamp)
            await record(ctx, row, 'channel.management_transferred', target.id, timestamp, {
                fromProjectId: previousManager?.projectId ?? null,
                toProjectId: target.id,
            })
            return { kind: 'changed', revision }
        }
    )

    const readable = async (ctx: WorkspaceChannelContext, row: ChannelRecord) =>
        (await ctx.authorization.authorizeWorkspace(row.workspaceId, 'manage_channels')) === true ||
        (await ctx.authorization.authorizeWorkspace(row.workspaceId, 'share_channels')) === true ||
        (await manages(ctx, row, 'manage_channels')) ||
        (await manages(ctx, row, 'share_channels')) ||
        (await someSequential(
            await sql
                .statement<{ projectId: string }, [string]>(
                    "select project_id as projectId from project_channel_attachments where channel_id=? and state='active'"
                )
                .all(row.id),
            async value =>
                (await ctx.authorization.authorizeProject(value.projectId, 'read_channels')) ===
                true
        ))

    const describe = async (
        ctx: WorkspaceChannelContext,
        row: ChannelRecord,
        shared: boolean,
        contextProjectId?: string
    ): Promise<WorkspaceChannelView> => {
        const managing = await manager.get(row.id)
        const projects =
            contextProjectId === undefined
                ? [
                      ...new Set(
                          [ctx.contextProjectId, managing?.projectId].filter(
                              (id): id is string => id !== undefined
                          )
                      ),
                  ].sort()
                : await affected(ctx, row, contextProjectId)
        return {
            ...row,
            shared,
            canManage: await manages(ctx, row, 'manage_channels'),
            canShare:
                (await manages(ctx, row, 'share_channels')) &&
                (await ctx.authorization.authorizeSharing(projects)) === true,
            management:
                managing === null
                    ? { kind: 'workspace' }
                    : {
                          kind: 'project',
                          project:
                              (await ctx.authorization.authorizeProject(
                                  managing.projectId,
                                  'read_channels'
                              )) === true
                                  ? { id: managing.projectId, name: managing.name }
                                  : null,
                      },
        }
    }

    const cadence = createChannelCadenceStore(database)
    const configureCadence = defineTransaction(
        database,
        async (
            ctx: WorkspaceChannelContext,
            input: {
                channelId: string
                expectedRevision: number
                timeZone?: string
                dailyMax: number | null
                weeklyMax: number | null
                minimumIntervalMs: number | null
            }
        ) => {
            const row = await channel.get(input.channelId)
            if (
                !row ||
                !(await allowedActor(ctx, row)) ||
                !(await manages(ctx, row, 'manage_channels')) ||
                row.state !== 'active'
            )
                return null
            const current = await cadence.get(row.id)
            if ((current?.revision ?? 0) !== input.expectedRevision)
                throw new DomainInvariantError(
                    'write_conflict',
                    'The cadence changed; reload it and retry'
                )
            const defaults = await manager.get(row.id)
            const timeZone =
                input.timeZone ??
                current?.timeZone ??
                (defaults ? (await project.get(defaults.projectId))?.timeZone : undefined) ??
                'UTC'
            const value = {
                timeZone,
                dailyMax: input.dailyMax,
                weeklyMax: input.weeklyMax,
                minimumIntervalMs: input.minimumIntervalMs,
            }
            validateCadence(value)
            await sql
                .statement(`insert into channel_cadence (channel_id,revision,time_zone,daily_max,weekly_max,minimum_interval_ms,updated_by_actor_id,updated_at)
            values (?,1,?,?,?,?,?,?) on conflict(channel_id) do update set revision=channel_cadence.revision+1,time_zone=excluded.time_zone,
            daily_max=excluded.daily_max,weekly_max=excluded.weekly_max,minimum_interval_ms=excluded.minimum_interval_ms,
            updated_by_actor_id=excluded.updated_by_actor_id,updated_at=excluded.updated_at`)
                .run(
                    row.id,
                    timeZone,
                    input.dailyMax,
                    input.weeklyMax,
                    input.minimumIntervalMs,
                    ctx.actorId,
                    now()
                )
            await sql
                .statement(
                    `update channel_cadence set last_effect_at=nullif(${scalarMaxSql(sql.dialect, 'coalesce(last_effect_at,0)', 'coalesce((select max(j.effect_started_at) from jobs j join publications p on p.id=j.publication_id where p.channel_id=?1),0)')},0) where channel_id=?1`
                )
                .run(row.id)
            await sql
                .statement(
                    'delete from publication_cadence_overrides where publication_id in (select id from publications where channel_id=?)'
                )
                .run(row.id)
            await record(
                ctx,
                row,
                'channel.cadence_updated',
                ctx.contextProjectId ?? defaults?.projectId ?? '',
                now(),
                value
            )
            for (const item of await sql
                .statement<{ projectId: string }, [string]>(
                    "select project_id as projectId from project_channel_attachments where channel_id=? and state='active'"
                )
                .all(row.id))
                recordDatabaseCommitProject(database, item.projectId)
            return (await cadence.get(row.id))!
        }
    )

    const projectActor = sql.statement<{ id: string }, [string, string]>(
        `select id from actors where project_id=? and subject_id=? and kind in ('human','agent','api_token') order by created_at,id limit 1`
    )
    const workspaceActors = createWorkspaceActorStore(database, { now, createId })

    return {
        /** Workspace binding only; each mutation still checks its own live authority. */
        async isWorkspaceChannel(
            ctx: WorkspaceChannelContext,
            workspaceId: string,
            channelId: string
        ): Promise<boolean> {
            return database.sql.transaction(async () => {
                const row = await channel.get(channelId)
                return (
                    row !== null &&
                    row.workspaceId === workspaceId &&
                    (await allowedActor(ctx, row))
                )
            }, 'deferred')
        },
        async workspaceContextFor(input: {
            workspaceId: string
            subjectId: string
            displayName: string
            authorization: ChannelAccessPolicy
        }): Promise<WorkspaceChannelContext | null> {
            return database.sql.transaction(async () => {
                const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId')
                const rows = await sql
                    .statement<{ id: string }, [string]>(
                        'select id from projects where workspace_id=?'
                    )
                    .all(workspaceId)
                if (
                    !(await input.authorization.authorizeWorkspace(
                        workspaceId,
                        'manage_channels'
                    )) &&
                    !(await input.authorization.authorizeWorkspace(
                        workspaceId,
                        'share_channels'
                    )) &&
                    !(await someSequential(rows, row =>
                        someSequential(
                            [
                                'read_channels',
                                'manage_channels',
                                'share_channels',
                                'withdraw_channels',
                            ],
                            action =>
                                input.authorization.authorizeProject(
                                    row.id,
                                    action as ChannelProjectAction
                                )
                        )
                    ))
                )
                    return null
                const actor = await workspaceActors.ensureForSubject(input)
                return { actorId: actor.id, authorization: input.authorization }
            }, 'immediate')
        },
        async getCadence(
            ctx: WorkspaceChannelContext,
            channelId: string
        ): Promise<{ rules: ChannelCadence | null; canManage: boolean } | null> {
            return database.sql.transaction(async () => {
                const row = await channel.get(channelId)
                if (!row || !(await allowedActor(ctx, row)) || !(await readable(ctx, row)))
                    return null
                return {
                    rules: await cadence.get(channelId),
                    canManage: await manages(ctx, row, 'manage_channels'),
                }
            }, 'deferred')
        },
        configureCadence(
            ctx: WorkspaceChannelContext,
            input: Parameters<typeof configureCadence>[1]
        ) {
            return configureCadence.immediate(ctx, input)
        },
        /**
         * Resolve the request's attribution actor from a live project actor. The result carries no grant:
         * every operation still asks the supplied policy port.
         */
        async contextFor(input: {
            readonly subjectId: string
            readonly contextProjectId: string
            readonly authorization: ChannelAccessPolicy
        }): Promise<WorkspaceChannelContext | null> {
            return database.sql.transaction(async () => {
                const contextProject = await project.get(
                    requireNonBlank(input.contextProjectId, 'projectId')
                )
                if (!contextProject?.workspaceId) return null
                const actor = await projectActor.get(
                    contextProject.id,
                    requireNonBlank(input.subjectId, 'subjectId')
                )
                if (!actor) return null
                const attribution = await workspaceActors.ensureFromProjectActor({
                    workspaceId: contextProject.workspaceId,
                    projectActorId: actor.id,
                })
                return attribution
                    ? {
                          actorId: attribution.id,
                          contextProjectId: contextProject.id,
                          authorization: input.authorization,
                      }
                    : null
            }, 'immediate')
        },
        create(
            ctx: WorkspaceChannelContext,
            input: { projectId: string; name: string; profile?: ChannelProfileDefinition }
        ) {
            return create.immediate(ctx, {
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },
        async listProject(
            ctx: WorkspaceChannelContext,
            projectId: string,
            includeDetached = false
        ): Promise<readonly ProjectChannelView[] | null> {
            return database.sql.transaction(async () => {
                const id = requireNonBlank(projectId, 'projectId')
                if ((await ctx.authorization.authorizeProject(id, 'read_channels')) !== true)
                    return null
                const target = await project.get(id)
                if (!target?.workspaceId) return null
                const rows = await sql
                    .statement<
                        {
                            id: string
                            attachmentState: 'active' | 'detached'
                            attachmentRevision: number
                            profileId: string
                            shared: number
                        },
                        [string, number]
                    >(`select c.id,a.state as attachmentState,a.revision as attachmentRevision,p.profile_id as profileId,
                exists(select 1 from project_channel_attachments other where other.channel_id=c.id and other.state='active' limit 1 offset 1) as shared
                from project_channel_attachments a join channels c on c.workspace_id=a.workspace_id and c.id=a.channel_id join channel_profile_versions p on p.workspace_id=c.workspace_id and p.channel_id=c.id and p.id=c.profile_version_id
                where a.project_id=?1 and (?2=1 or a.state='active') order by c.created_at,c.id`)
                    .all(id, includeDetached ? 1 : 0)
                return mapSequential(rows, async value => {
                    const row = (await channel.get(value.id))!
                    return {
                        ...(await describe(ctx, row, value.shared === 1, id)),
                        projectId: id,
                        attachmentState: value.attachmentState,
                        attachmentRevision: value.attachmentRevision,
                        canWithdraw:
                            value.attachmentState === 'active' &&
                            (await isActive('workspace', row.workspaceId)) &&
                            (await isActive('project', id)) &&
                            ((await ctx.authorization.authorizeProject(id, 'withdraw_channels')) ===
                            true
                                ? (await ctx.authorization.authorizeSharing(
                                      [
                                          ...new Set(
                                              [ctx.contextProjectId, id].filter(
                                                  (value): value is string => value !== undefined
                                              )
                                          ),
                                      ].sort()
                                  )) === true
                                : (await manages(ctx, row, 'share_channels')) &&
                                  (await ctx.authorization.authorizeSharing(
                                      await affected(ctx, row, id)
                                  )) === true),
                    }
                })
            }, 'deferred')
        },
        /**
         * Time already taken on the channels this project uses by OTHER attached projects.
         * Drafts, cancelled and definitely failed work occupy nothing and are never reported.
         */
        async occupancy(
            ctx: WorkspaceChannelContext,
            projectId: string,
            range: { readonly from: number; readonly to: number }
        ): Promise<readonly ChannelOccupancyItem[] | null> {
            return database.sql.transaction(async () => {
                const id = requireNonBlank(projectId, 'projectId')
                if ((await ctx.authorization.authorizeProject(id, 'read_channels')) !== true)
                    return null
                if (
                    !Number.isSafeInteger(range.from) ||
                    !Number.isSafeInteger(range.to) ||
                    range.to <= range.from
                )
                    throw new DomainInvariantError(
                        'invalid_input',
                        'The occupancy range is invalid'
                    )
                const rows = await sql
                    .statement<
                        {
                            publicationId: string
                            projectId: string
                            projectName: string
                            channelId: string
                            state: ChannelOccupancyItem['state']
                            at: number
                            title: string | null
                        },
                        [string, number, number]
                    >(`select p.id as publicationId,p.project_id as projectId,pr.name as projectName,p.channel_id as channelId,p.state,
                    case when p.state='published' then coalesce(p.published_at,p.scheduled_at) else p.scheduled_at end as at,
                    post.title as title
                    from publications p
                    join project_channel_attachments mine on mine.project_id=?1 and mine.channel_id=p.channel_id and mine.state='active'
                    join projects pr on pr.id=p.project_id
                    left join posts post on post.project_id=p.project_id and post.id=p.post_id
                    left join project_channel_attachments theirs on theirs.project_id=p.project_id and theirs.channel_id=p.channel_id
                    where p.project_id<>?1
                      and p.state in ('scheduled','ready','publishing','published','ambiguous')
                      and (theirs.state='active' or p.state in ('published','ambiguous'))
                      and (case when p.state='published' then coalesce(p.published_at,p.scheduled_at) else p.scheduled_at end) >= ?2
                      and (case when p.state='published' then coalesce(p.published_at,p.scheduled_at) else p.scheduled_at end) < ?3
                    order by at,p.id limit 500`)
                    .all(id, range.from, range.to)
                const visible = await filterSequential(rows, row =>
                    isActive('project', row.projectId)
                )
                return mapSequential(visible, async row => ({
                    channelId: row.channelId,
                    at: row.at,
                    state: row.state,
                    project:
                        (await ctx.authorization.authorizeProject(
                            row.projectId,
                            'read_channels'
                        )) === true
                            ? {
                                  id: row.projectId,
                                  name: row.projectName,
                                  publicationId: row.publicationId,
                                  title: row.title,
                              }
                            : null,
                }))
            }, 'immediate')
        },
        async listWorkspace(
            ctx: WorkspaceChannelContext,
            workspaceId: string,
            includeArchived = false
        ): Promise<readonly WorkspaceChannelView[]> {
            return database.sql.transaction(async () => {
                const id = requireNonBlank(workspaceId, 'workspaceId')
                const values = await sql
                    .statement<{ id: string; shared: number }, [string, number]>(
                        `select c.id,exists(select 1 from project_channel_attachments a where a.channel_id=c.id and a.state='active' limit 1 offset 1) as shared from channels c where c.workspace_id=? and (?=1 or c.state='active') order by c.created_at,c.id`
                    )
                    .all(id, includeArchived ? 1 : 0)
                const views = await mapSequential(values, async value => {
                    const row = await channel.get(value.id)
                    if (!row) return []
                    return (await readable(ctx, row))
                        ? [await describe(ctx, row, value.shared === 1)]
                        : []
                })
                return views.flat()
            }, 'deferred')
        },
        async listProjectUsages(
            ctx: WorkspaceChannelContext,
            channelId: string,
            includeDetached = false
        ): Promise<
            | readonly {
                  readonly projectId: string
                  readonly name: string
                  readonly state: 'active' | 'detached'
                  readonly revision: number
              }[]
            | null
        > {
            return database.sql.transaction(async () => {
                const row = await channel.get(requireNonBlank(channelId, 'channelId'))
                if (!row || !(await readable(ctx, row))) return null
                const usages = await sql
                    .statement<
                        {
                            projectId: string
                            name: string
                            state: 'active' | 'detached'
                            revision: number
                        },
                        [string, number]
                    >(
                        `select a.project_id as projectId,p.name,a.state,a.revision from project_channel_attachments a join projects p on p.workspace_id=a.workspace_id and p.id=a.project_id where a.channel_id=? and (?=1 or a.state='active') order by p.name,p.id`
                    )
                    .all(row.id, includeDetached ? 1 : 0)
                return filterSequential(
                    usages,
                    async value =>
                        (await ctx.authorization.authorizeProject(
                            value.projectId,
                            'read_channels'
                        )) === true
                )
            }, 'deferred')
        },
        attach(
            ctx: WorkspaceChannelContext,
            input: { channelId: string; projectId: string; expectedRevision: number }
        ) {
            return attach.immediate(ctx, input)
        },
        detach(
            ctx: WorkspaceChannelContext,
            input: {
                channelId: string
                projectId: string
                expectedRevision: number
                lastAttachment?: 'archive'
            }
        ) {
            return detach.immediate(ctx, input)
        },
        transferManagement(
            ctx: WorkspaceChannelContext,
            input: { channelId: string; projectId: string; expectedRevision: number }
        ) {
            return transfer.immediate(ctx, input)
        },
    }
}
