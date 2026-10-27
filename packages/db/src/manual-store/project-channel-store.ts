import {
    createActor,
    createProject,
    requireNonBlank,
    requireProjectTimeZone,
    requireTimestamp,
    type Actor,
    type Channel,
    type ChannelProfileDefinition,
    type Project,
} from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostdotDatabase,
} from '../client'
import { createWorkspaceActorStore } from '../workspace-actor-store'
import { createWorkspaceChannelStore } from '../workspace-channel-store'
import { parseProfile } from './content-codec'
import { toChannel, toProject } from './project-channel-mappers'
import type { ActorRow, ChannelRow, ProjectRow } from './rows'

/** Active-version metadata for channel list readers, without execution configuration. */
export interface ChannelListItem extends Channel {
    /** More than one project actively uses the channel. The number of projects is never exposed. */
    readonly shared: boolean
    readonly execution:
        | { readonly kind: 'manual' }
        | { readonly kind: 'declarative_http' }
        | { readonly kind: 'built_in'; readonly contractId: string }
}

export interface CreateProjectInput {
    readonly name: string
    readonly subjectId: string
    readonly displayName: string
    /** The workspace is the user-facing access boundary and owns attached channel resources. */
    readonly workspaceId: string
    readonly timeZone?: string
}

export interface UpdateProjectTimeZoneInput {
    readonly projectId: string
    readonly subjectId: string
    readonly timeZone: string
}

export interface CreateChannelInput {
    readonly projectId: string
    readonly subjectId: string
    readonly name: string
    readonly profile?: ChannelProfileDefinition
}

export interface CreatedProject {
    readonly project: Project
    readonly actor: Actor
}

export interface ProjectChannelStoreOptions {
    readonly now: () => number
    readonly createId: () => string
}

export function createProjectChannelStore(
    database: PostdotDatabase,
    options: ProjectChannelStoreOptions
) {
    const client = database.$client

    const loadProjectStatement = client.query<ProjectRow, [projectId: string]>(`
        select id,
               name,
               time_zone as timeZone,
               workspace_id as workspaceId,
               primary_category_id as primaryCategoryId,
               created_at as createdAt,
               updated_at as updatedAt
        from projects
        where id = ?1
    `)
    const loadActorStatement = client.query<ActorRow, [projectId: string, subjectId: string]>(`
        select id,
               project_id as projectId,
               kind,
               subject_id as subjectId,
               display_name as displayName,
               created_at as createdAt,
               updated_at as updatedAt
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind in ('human', 'agent', 'api_token')
        order by created_at, id
        limit 1
    `)
    const listProjectsStatement = client.query<ProjectRow, [subjectId: string]>(`
        select distinct projects.id,
               projects.name,
               projects.time_zone as timeZone,
               projects.workspace_id as workspaceId,
               projects.primary_category_id as primaryCategoryId,
               projects.created_at as createdAt,
               projects.updated_at as updatedAt
        from projects
        inner join actors
            on actors.project_id = projects.id
           and actors.kind in ('human', 'agent', 'api_token')
           and actors.subject_id = ?1
        order by projects.created_at, projects.id
    `)
    const listWorkspaceProjectsStatement = client.query<ProjectRow, [workspaceId: string]>(`
        select projects.id,
               projects.name,
               projects.time_zone as timeZone,
               projects.workspace_id as workspaceId,
               projects.primary_category_id as primaryCategoryId,
               projects.created_at as createdAt,
               projects.updated_at as updatedAt
        from projects
        where projects.workspace_id = ?1
        order by projects.created_at, projects.id
    `)
    const listChannelsStatement = client.query<
        ChannelRow & { readonly profileJson: string; readonly shared: number },
        [projectId: string]
    >(`
        select exists (
                   select 1
                   from project_channel_attachments as other
                   where other.channel_id = channels.id
                     and other.state = 'active'
                     and other.project_id <> channels.project_id
               ) as shared,
               channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profiles.profile_id as profileId,
               channel_profiles.profile_json as profileJson,
               channels.profile_version_id as profileVersionId,
               channels.state,
               channels.archived_at as archivedAt,
               channels.revision,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt
        from project_channel_contexts as channels
        inner join project_channel_profile_contexts as channel_profiles
            on channel_profiles.project_id = channels.project_id
           and channel_profiles.channel_id = channels.id
           and channel_profiles.id = channels.profile_version_id
        where channels.project_id = ?1
          and channels.attachment_state = 'active'
        order by channels.created_at, channels.id
    `)
    const insertProjectStatement = client.query<
        void,
        [id: string, name: string, timeZone: string, workspaceId: string | null, now: number]
    >(`
        insert into projects (
            id,
            name,
            time_zone,
            workspace_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?5)
    `)
    const updateProjectTimeZoneStatement = client.query<
        { readonly changes: number },
        [timeZone: string, updatedAt: number, projectId: string]
    >(`
        update projects
        set time_zone = ?1,
            updated_at = ?2
        where id = ?3
    `)
    const insertActorStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            kind: Actor['kind'],
            subjectId: string | null,
            displayName: string,
            now: number,
        ]
    >(`
        insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `)
    const insertAuditEventStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: string,
            entityType: string,
            entityId: string,
            metadataJson: string | null,
            createdAt: number,
        ]
    >(`
        insert into audit_events (
            id,
            project_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata_json,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)

    const createProjectTransaction = createDatabaseTransaction(
        database,
        (input: CreateProjectInput): CreatedProject => {
            const timestamp = requireTimestamp(options.now(), 'now')
            const project = createProject({
                id: options.createId(),
                name: input.name,
                timeZone: input.timeZone,
                workspaceId: input.workspaceId,
                now: timestamp,
            })
            const actor = createActor({
                id: options.createId(),
                project,
                kind: 'human',
                subjectId: input.subjectId,
                displayName: input.displayName,
                now: timestamp,
            })
            const systemActor = createActor({
                id: `system:${project.id}`,
                project,
                kind: 'system',
                subjectId: null,
                displayName: 'Postdot Worker',
                now: timestamp,
            })

            insertProjectStatement.run(
                project.id,
                project.name,
                project.timeZone,
                input.workspaceId,
                timestamp
            )
            insertActorStatement.run(
                actor.id,
                project.id,
                actor.kind,
                actor.subjectId,
                actor.displayName,
                timestamp
            )
            insertActorStatement.run(
                systemActor.id,
                project.id,
                systemActor.kind,
                systemActor.subjectId,
                systemActor.displayName,
                timestamp
            )
            recordDatabaseCommitProject(database, project.id)
            insertAuditEventStatement.run(
                options.createId(),
                project.id,
                actor.id,
                'project.created',
                'project',
                project.id,
                JSON.stringify({ name: project.name }),
                timestamp
            )

            return { project, actor }
        }
    )

    const updateProjectTimeZoneTransaction = createDatabaseTransaction(
        database,
        (input: UpdateProjectTimeZoneInput): Project | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actor === null || projectRow === null) return null

            const timeZone = requireProjectTimeZone(input.timeZone)
            const project = toProject(projectRow)
            if (project.timeZone === timeZone) return project

            const timestamp = requireTimestamp(options.now(), 'now')
            const update = updateProjectTimeZoneStatement.run(timeZone, timestamp, project.id)
            if (update.changes !== 1) return null

            recordDatabaseCommitProject(database, project.id)
            insertAuditEventStatement.run(
                options.createId(),
                project.id,
                actor.id,
                'project.timezone_updated',
                'project',
                project.id,
                JSON.stringify({ from: project.timeZone, to: timeZone }),
                timestamp
            )

            return { ...project, timeZone, updatedAt: timestamp }
        }
    )

    const workspaceActors = createWorkspaceActorStore(database, options)
    const workspaceChannels = createWorkspaceChannelStore(database, options)
    const createChannelTransaction = createDatabaseTransaction(
        database,
        (input: CreateChannelInput): Channel | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actor === null || projectRow === null || projectRow.workspaceId === null)
                return null
            const attribution = workspaceActors.ensureFromProjectActor({
                workspaceId: projectRow.workspaceId,
                projectActorId: actor.id,
            })
            if (attribution === null) return null

            // The caller already authenticated the project actor; this port only admits that project.
            const created = workspaceChannels.create(
                {
                    actorId: attribution.id,
                    contextProjectId: projectRow.id,
                    authorization: {
                        authorizeProject: (projectId, action) =>
                            projectId === projectRow.id && action === 'create_channels',
                        authorizeWorkspace: () => false,
                        authorizeSharing: () => false,
                    },
                },
                { projectId: input.projectId, name: input.name, profile: input.profile }
            )
            if (created.kind !== 'created') return null

            const channel = toChannel({ ...created.channel, projectId: projectRow.id })
            insertAuditEventStatement.run(
                options.createId(),
                projectRow.id,
                actor.id,
                'channel.created',
                'channel',
                channel.id,
                JSON.stringify({
                    name: channel.name,
                    profileId: channel.profileId,
                }),
                channel.createdAt
            )
            return channel
        }
    )

    return {
        createProject(input: CreateProjectInput): CreatedProject {
            return createProjectTransaction.immediate({
                ...input,
                name: requireNonBlank(input.name, 'name'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                displayName: requireNonBlank(input.displayName, 'displayName'),
            })
        },

        listProjects(subjectId: string): Project[] {
            return listProjectsStatement.all(requireNonBlank(subjectId, 'subjectId')).map(toProject)
        },

        listProjectsForWorkspace(workspaceId: string): Project[] {
            return listWorkspaceProjectsStatement
                .all(requireNonBlank(workspaceId, 'workspaceId'))
                .map(toProject)
        },

        updateProjectTimeZone(input: UpdateProjectTimeZoneInput): Project | null {
            return updateProjectTimeZoneTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                timeZone: requireProjectTimeZone(input.timeZone),
            })
        },

        createChannel(input: CreateChannelInput): Channel | null {
            return createChannelTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },

        listChannels(projectId: string, subjectId: string): ChannelListItem[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            return listChannelsStatement.all(normalizedProjectId).map(row => {
                const execution = parseProfile(row.profileJson).execution
                return {
                    ...toChannel(row),
                    shared: row.shared === 1,
                    execution:
                        execution.kind === 'built_in'
                            ? { kind: execution.kind, contractId: execution.contractId }
                            : { kind: execution.kind },
                }
            })
        },
    }
}
