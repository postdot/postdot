import {
    ChannelProfileCompiler,
    createChannel,
    createManualChannelProfile,
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ChannelProfileDefinition,
} from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostbotDatabase,
} from './client'
import { createEventJournalStore } from './event-journal-store'
import { normalizeCreationProfile } from './manual-store/channel-profile-definition'
import { invalidProfileError } from './manual-store/content-codec'
import { toProject } from './manual-store/project-channel-mappers'
import type { ProjectRow } from './manual-store/rows'

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
export interface ChannelAccessPolicy {
    authorizeProject(projectId: string, action: ChannelProjectAction): boolean
    authorizeWorkspace(workspaceId: string, action: ChannelManagementIntent): boolean
    /** Includes the sharing capability and key scope for every affected/context project. */
    authorizeSharing(projectIds: readonly string[]): boolean
}

export interface WorkspaceChannelContext {
    readonly actorId: string
    readonly authorization: ChannelAccessPolicy
    readonly contextProjectId?: string
}

interface ChannelRecord {
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

type MutationResult =
    | { readonly kind: 'not_found' }
    | { readonly kind: 'stale'; readonly revision: number }
    | { readonly kind: 'unchanged'; readonly revision: number }
    | { readonly kind: 'changed'; readonly revision: number }
    | { readonly kind: 'retirement_required'; readonly revision: number }

/** Canonical workspace schema only. Wired into the runtime when its ownership migration is activated. */
export function createWorkspaceChannelStore(
    database: PostbotDatabase,
    options: { readonly now?: () => number; readonly createId?: () => string } = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())
    const journal = createEventJournalStore(database, { createId })
    const compiler = new ChannelProfileCompiler()
    const project = client.query<ProjectRow, [string]>(
        `select id,name,time_zone as timeZone,workspace_id as workspaceId,primary_category_id as primaryCategoryId,created_at as createdAt,updated_at as updatedAt from projects where id=?`
    )
    const channel = client.query<ChannelRecord, [string]>(
        `select c.id,c.workspace_id as workspaceId,c.name,c.profile_version_id as profileVersionId,p.profile_id as profileId,c.state,c.archived_at as archivedAt,c.revision,c.created_at as createdAt,c.updated_at as updatedAt from channels c join channel_profile_versions p on p.workspace_id=c.workspace_id and p.channel_id=c.id and p.id=c.profile_version_id where c.id=?`
    )
    const manager = client.query<{ projectId: string; name: string }, [string]>(
        `select m.project_id as projectId,p.name from channel_managers m join projects p on p.id=m.project_id where m.channel_id=?`
    )
    const attachment = client.query<
        { state: 'active' | 'detached'; revision: number },
        [string, string]
    >(`select state,revision from project_channel_attachments where project_id=? and channel_id=?`)
    const validActor = client.query<{ id: string }, [string, string]>(
        `select id from actors where workspace_id=? and id=?`
    )
    const lifecycle = client.query<{ state: string }, [string, string]>(
        `select state from resource_lifecycles where kind=? and resource_id=?`
    )
    const isActive = (kind: 'workspace' | 'project', id: string) => {
        const value = lifecycle.get(kind, id)
        return value === null || value.state === 'active'
    }
    const manages = (
        ctx: WorkspaceChannelContext,
        row: ChannelRecord,
        intent: ChannelManagementIntent
    ) => {
        if (!isActive('workspace', row.workspaceId)) return false
        if (ctx.authorization.authorizeWorkspace(row.workspaceId, intent) === true) return true
        const managing = manager.get(row.id)
        return (
            managing !== null &&
            isActive('project', managing.projectId) &&
            ctx.authorization.authorizeProject(managing.projectId, intent) === true
        )
    }
    const affected = (ctx: WorkspaceChannelContext, row: ChannelRecord, target: string) => {
        const source = manager.get(row.id)?.projectId
        return [
            ...new Set(
                [ctx.contextProjectId, source, target].filter(
                    (id): id is string => id !== undefined
                )
            ),
        ].sort()
    }
    const allowedActor = (ctx: WorkspaceChannelContext, row: ChannelRecord) =>
        validActor.get(row.workspaceId, requireNonBlank(ctx.actorId, 'actorId')) !== null
    const validateRevision = (revision: number) => {
        if (!Number.isSafeInteger(revision) || revision < 1)
            throw new DomainInvariantError(
                'invalid_input',
                'Expected channel revision must be a positive safe integer'
            )
    }
    const record = (
        ctx: WorkspaceChannelContext,
        row: ChannelRecord,
        name: string,
        projectId: string,
        timestamp: number,
        payload: Readonly<Record<string, unknown>> = {}
    ) => {
        journal.appendWorkspace({
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
    const bump = (row: ChannelRecord, timestamp: number) => {
        const result = client
            .query('update channels set revision=revision+1,updated_at=? where id=? and revision=?')
            .run(timestamp, row.id, row.revision)
        if (result.changes !== 1)
            throw new Error('Channel revision changed inside its write transaction')
        return row.revision + 1
    }

    const create = createDatabaseTransaction(
        database,
        (
            ctx: WorkspaceChannelContext,
            input: { projectId: string; name: string; profile?: ChannelProfileDefinition }
        ) => {
            const target = project.get(input.projectId)
            if (
                !target?.workspaceId ||
                ctx.authorization.authorizeProject(target.id, 'create_channels') !== true ||
                !isActive('project', target.id) ||
                !isActive('workspace', target.workspaceId) ||
                !validActor.get(target.workspaceId, ctx.actorId)
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
            client
                .query(
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
            client
                .query(
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
            client
                .query(
                    `insert into project_channel_attachments (project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,?)`
                )
                .run(target.id, value.id, target.workspaceId, ctx.actorId, timestamp)
            client
                .query(
                    `insert into channel_managers (channel_id,project_id,workspace_id) values (?,?,?)`
                )
                .run(value.id, target.id, target.workspaceId)
            const saved = channel.get(value.id)!
            record(ctx, saved, 'channel.created', target.id, timestamp)
            return { kind: 'created', channel: saved } as const
        }
    )

    const attach = createDatabaseTransaction(
        database,
        (
            ctx: WorkspaceChannelContext,
            input: { channelId: string; projectId: string; expectedRevision: number }
        ): MutationResult => {
            const row = channel.get(input.channelId),
                target = project.get(input.projectId)
            if (
                !row ||
                row.state !== 'active' ||
                target?.workspaceId !== row.workspaceId ||
                !isActive('project', target.id) ||
                !isActive('workspace', row.workspaceId) ||
                !allowedActor(ctx, row) ||
                !manages(ctx, row, 'share_channels') ||
                ctx.authorization.authorizeProject(target.id, 'attach_channels') !== true ||
                ctx.authorization.authorizeSharing(affected(ctx, row, target.id)) !== true
            )
                return { kind: 'not_found' }
            validateRevision(input.expectedRevision)
            if (input.expectedRevision !== row.revision)
                return { kind: 'stale', revision: row.revision }
            const existing = attachment.get(target.id, row.id)
            if (existing?.state === 'active') return { kind: 'unchanged', revision: row.revision }
            const timestamp = requireTimestamp(now(), 'now')
            if (existing)
                client
                    .query(
                        `update project_channel_attachments set state='active',detached_at=NULL,revision=revision+1 where project_id=? and channel_id=?`
                    )
                    .run(target.id, row.id)
            else
                client
                    .query(
                        `insert into project_channel_attachments(project_id,channel_id,workspace_id,origin,attached_by_actor_id,attached_at) values (?,?,?,'explicit',?,?)`
                    )
                    .run(target.id, row.id, row.workspaceId, ctx.actorId, timestamp)
            const revision = bump(row, timestamp)
            record(ctx, row, 'channel.project_attached', target.id, timestamp)
            return { kind: 'changed', revision }
        }
    )

    const detach = createDatabaseTransaction(
        database,
        (
            ctx: WorkspaceChannelContext,
            input: {
                channelId: string
                projectId: string
                expectedRevision: number
                lastAttachment?: 'archive'
            }
        ): MutationResult => {
            const row = channel.get(input.channelId),
                target = project.get(input.projectId)
            if (
                !row ||
                target?.workspaceId !== row.workspaceId ||
                !isActive('project', target.id) ||
                !isActive('workspace', row.workspaceId) ||
                !allowedActor(ctx, row) ||
                !(
                    ctx.authorization.authorizeProject(target.id, 'withdraw_channels') === true ||
                    manages(ctx, row, 'share_channels')
                ) ||
                ctx.authorization.authorizeSharing(
                    ctx.authorization.authorizeProject(target.id, 'withdraw_channels') === true
                        ? [
                              ...new Set(
                                  [ctx.contextProjectId, target.id].filter(
                                      (id): id is string => id !== undefined
                                  )
                              ),
                          ].sort()
                        : affected(ctx, row, target.id)
                ) !== true
            )
                return { kind: 'not_found' }
            const existing = attachment.get(target.id, row.id)
            if (!existing) return { kind: 'not_found' }
            validateRevision(input.expectedRevision)
            if (input.expectedRevision !== row.revision)
                return { kind: 'stale', revision: row.revision }
            if (existing.state === 'detached') return { kind: 'unchanged', revision: row.revision }
            const last =
                client
                    .query<{ present: number }, [string, string]>(
                        "select exists(select 1 from project_channel_attachments where channel_id=? and project_id<>? and state='active') as present"
                    )
                    .get(row.id, target.id)?.present !== 1
            const archive = last && row.state === 'active'
            if (archive && input.lastAttachment !== 'archive')
                return { kind: 'retirement_required', revision: row.revision }
            const timestamp = requireTimestamp(now(), 'now')
            client
                .query(
                    `update project_channel_attachments set state='detached',detached_at=?,revision=revision+1 where project_id=? and channel_id=?`
                )
                .run(timestamp, target.id, row.id)
            if (archive)
                client
                    .query("update channels set state='archived',archived_at=? where id=?")
                    .run(timestamp, row.id)
            const revision = bump(row, timestamp)
            record(ctx, row, 'channel.project_detached', target.id, timestamp)
            if (archive) record(ctx, row, 'channel.archived', target.id, timestamp)
            return { kind: 'changed', revision }
        }
    )

    const transfer = createDatabaseTransaction(
        database,
        (
            ctx: WorkspaceChannelContext,
            input: { channelId: string; projectId: string; expectedRevision: number }
        ): MutationResult => {
            const row = channel.get(input.channelId),
                target = project.get(input.projectId)
            if (
                !row ||
                target?.workspaceId !== row.workspaceId ||
                !isActive('workspace', row.workspaceId) ||
                !isActive('project', target.id) ||
                !allowedActor(ctx, row) ||
                !manages(ctx, row, 'share_channels') ||
                ctx.authorization.authorizeProject(target.id, 'accept_channel_management') !==
                    true ||
                ctx.authorization.authorizeSharing(affected(ctx, row, target.id)) !== true ||
                attachment.get(target.id, row.id)?.state !== 'active'
            )
                return { kind: 'not_found' }
            validateRevision(input.expectedRevision)
            if (input.expectedRevision !== row.revision)
                return { kind: 'stale', revision: row.revision }
            const previousManager = manager.get(row.id)
            if (previousManager?.projectId === target.id)
                return { kind: 'unchanged', revision: row.revision }
            const timestamp = requireTimestamp(now(), 'now')
            client
                .query(
                    `insert into channel_managers(channel_id,project_id,workspace_id) values (?,?,?) on conflict(channel_id) do update set project_id=excluded.project_id,workspace_id=excluded.workspace_id`
                )
                .run(row.id, target.id, row.workspaceId)
            const revision = bump(row, timestamp)
            record(ctx, row, 'channel.management_transferred', target.id, timestamp, {
                fromProjectId: previousManager?.projectId ?? null,
                toProjectId: target.id,
            })
            return { kind: 'changed', revision }
        }
    )

    const readable = (ctx: WorkspaceChannelContext, row: ChannelRecord) =>
        ctx.authorization.authorizeWorkspace(row.workspaceId, 'manage_channels') === true ||
        ctx.authorization.authorizeWorkspace(row.workspaceId, 'share_channels') === true ||
        manages(ctx, row, 'manage_channels') ||
        manages(ctx, row, 'share_channels') ||
        client
            .query<{ projectId: string }, [string]>(
                "select project_id as projectId from project_channel_attachments where channel_id=? and state='active'"
            )
            .all(row.id)
            .some(
                value =>
                    ctx.authorization.authorizeProject(value.projectId, 'read_channels') === true
            )

    const describe = (
        ctx: WorkspaceChannelContext,
        row: ChannelRecord,
        shared: boolean,
        contextProjectId?: string
    ): WorkspaceChannelView => {
        const managing = manager.get(row.id)
        const projects =
            contextProjectId === undefined
                ? [
                      ...new Set(
                          [ctx.contextProjectId, managing?.projectId].filter(
                              (id): id is string => id !== undefined
                          )
                      ),
                  ].sort()
                : affected(ctx, row, contextProjectId)
        return {
            ...row,
            shared,
            canManage: manages(ctx, row, 'manage_channels'),
            canShare:
                manages(ctx, row, 'share_channels') &&
                ctx.authorization.authorizeSharing(projects) === true,
            management:
                managing === null
                    ? { kind: 'workspace' }
                    : {
                          kind: 'project',
                          project:
                              ctx.authorization.authorizeProject(
                                  managing.projectId,
                                  'read_channels'
                              ) === true
                                  ? { id: managing.projectId, name: managing.name }
                                  : null,
                      },
        }
    }

    return {
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
        listProject(
            ctx: WorkspaceChannelContext,
            projectId: string,
            includeDetached = false
        ): readonly ProjectChannelView[] | null {
            const id = requireNonBlank(projectId, 'projectId')
            if (ctx.authorization.authorizeProject(id, 'read_channels') !== true) return null
            const target = project.get(id)
            if (!target?.workspaceId) return null
            const rows = client
                .query<
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
            return rows.map(value => {
                const row = channel.get(value.id)!
                return {
                    ...describe(ctx, row, value.shared === 1, id),
                    projectId: id,
                    attachmentState: value.attachmentState,
                    attachmentRevision: value.attachmentRevision,
                    canWithdraw:
                        value.attachmentState === 'active' &&
                        isActive('workspace', row.workspaceId) &&
                        isActive('project', id) &&
                        (ctx.authorization.authorizeProject(id, 'withdraw_channels') === true
                            ? ctx.authorization.authorizeSharing(
                                  [
                                      ...new Set(
                                          [ctx.contextProjectId, id].filter(
                                              (value): value is string => value !== undefined
                                          )
                                      ),
                                  ].sort()
                              ) === true
                            : manages(ctx, row, 'share_channels') &&
                              ctx.authorization.authorizeSharing(affected(ctx, row, id)) === true),
                }
            })
        },
        listWorkspace(
            ctx: WorkspaceChannelContext,
            workspaceId: string,
            includeArchived = false
        ): readonly WorkspaceChannelView[] {
            const id = requireNonBlank(workspaceId, 'workspaceId')
            const values = client
                .query<{ id: string; shared: number }, [string, number]>(
                    `select c.id,exists(select 1 from project_channel_attachments a where a.channel_id=c.id and a.state='active' limit 1 offset 1) as shared from channels c where c.workspace_id=? and (?=1 or c.state='active') order by c.created_at,c.id`
                )
                .all(id, includeArchived ? 1 : 0)
            return values.flatMap(value => {
                const row = channel.get(value.id)
                if (!row) return []
                return readable(ctx, row) ? [describe(ctx, row, value.shared === 1)] : []
            })
        },
        listProjectUsages(
            ctx: WorkspaceChannelContext,
            channelId: string,
            includeDetached = false
        ):
            | readonly {
                  readonly projectId: string
                  readonly name: string
                  readonly state: 'active' | 'detached'
                  readonly revision: number
              }[]
            | null {
            const row = channel.get(requireNonBlank(channelId, 'channelId'))
            if (!row || !readable(ctx, row)) return null
            return client
                .query<
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
                .filter(
                    value =>
                        ctx.authorization.authorizeProject(value.projectId, 'read_channels') ===
                        true
                )
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
