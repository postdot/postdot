import { createHash } from 'node:crypto'

import {
    ChannelProfileCompiler,
    createActor,
    createChannel,
    createManualChannelProfile,
    createProject,
    fingerprintChannelProfile,
    requireNonBlank,
    requireProjectTimeZone,
    requireTimestamp,
    type Actor,
    type Channel,
    type ChannelProfileDefinition,
    type Project,
} from '@herald/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type HeraldDatabase,
} from '../client'
import { invalidProfileError } from './content-codec'
import { toChannel, toProject } from './project-channel-mappers'
import type { ActorRow, ChannelRow, ProjectRow } from './rows'

export interface CreateProjectInput {
    readonly name: string
    readonly subjectId: string
    readonly displayName: string
    /** The workspace is the user-facing access boundary. */
    readonly workspaceId?: string | null
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
    database: HeraldDatabase,
    options: ProjectChannelStoreOptions
) {
    const client = database.$client
    const profileCompiler = new ChannelProfileCompiler()

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
    const listChannelsStatement = client.query<ChannelRow, [projectId: string]>(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channel_profiles.profile_id as profileId,
               channels.profile_version_id as profileVersionId,
               channels.state,
               channels.archived_at as archivedAt,
               channels.revision,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt
        from channels
        inner join channel_profile_versions as channel_profiles
            on channel_profiles.project_id = channels.project_id
           and channel_profiles.channel_id = channels.id
           and channel_profiles.id = channels.profile_version_id
        where channels.project_id = ?1
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
    const insertChannelStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            name: string,
            profileVersionId: string,
            state: Channel['state'],
            archivedAt: number | null,
            revision: number,
            now: number,
        ]
    >(`
        insert into channels (
            id,
            project_id,
            name,
            profile_version_id,
            state,
            archived_at,
            revision,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
    `)
    const insertProfileStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            channelId: string,
            profileId: string,
            version: number,
            origin: ChannelProfileDefinition['origin'],
            state: 'active',
            revision: number,
            profileJson: string,
            profileHash: string,
            schemaHash: string,
            actorId: string,
            now: number,
        ]
    >(`
        insert into channel_profile_versions (
            id,
            project_id,
            channel_id,
            profile_id,
            version,
            origin,
            state,
            revision,
            profile_json,
            profile_hash,
            schema_hash,
            created_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
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
                displayName: 'Herald Worker',
                now: timestamp,
            })

            insertProjectStatement.run(
                project.id,
                project.name,
                project.timeZone,
                input.workspaceId ?? null,
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

    const createChannelTransaction = createDatabaseTransaction(
        database,
        (input: CreateChannelInput): Channel | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actor === null || projectRow === null) return null

            const timestamp = requireTimestamp(options.now(), 'now')
            const project = toProject(projectRow)
            const profileResult = profileCompiler.compile(
                normalizeCreationProfile(input.profile ?? createManualChannelProfile())
            )
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)
            const profile = profileResult.value.profile
            const profileVersionId = options.createId()
            const channel = createChannel({
                id: options.createId(),
                project,
                name: input.name,
                profileId: profile.id,
                profileVersionId,
                now: timestamp,
            })

            insertChannelStatement.run(
                channel.id,
                project.id,
                channel.name,
                channel.profileVersionId,
                channel.state,
                channel.archivedAt,
                channel.revision,
                timestamp
            )
            insertProfileStatement.run(
                profileVersionId,
                project.id,
                channel.id,
                profile.id,
                profile.version,
                profile.origin,
                'active',
                1,
                JSON.stringify(profile),
                profile.profileHash,
                profile.schemaHash,
                actor.id,
                timestamp
            )
            recordDatabaseCommitProject(database, project.id)
            insertAuditEventStatement.run(
                options.createId(),
                project.id,
                actor.id,
                'channel.created',
                'channel',
                channel.id,
                JSON.stringify({
                    name: channel.name,
                    profileId: profile.id,
                    profileVersion: profile.version,
                }),
                timestamp
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

        listChannels(projectId: string, subjectId: string): Channel[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            return listChannelsStatement.all(normalizedProjectId).map(toChannel)
        },
    }
}

/**
 * Derive server-owned fingerprints for a newly created custom profile while
 * preserving the declared identity, origin and version. Built-in profiles and
 * already stored definitions are untouched; supplied fingerprints (including
 * legacy symbolic or arbitrary values, or none at all) are always replaced.
 * Runs before compilation and persistence so both observe derived values.
 */
function normalizeCreationProfile(profile: ChannelProfileDefinition): ChannelProfileDefinition {
    if (profile.origin !== 'custom') return profile

    try {
        return fingerprintChannelProfile(
            {
                ...profile,
                profileHash: '',
                schemaHash: '',
            },
            value => `sha256:${createHash('sha256').update(value).digest('hex')}`
        )
    } catch {
        throw invalidProfileError([
            {
                path: '',
                code: 'profile.invalid_json_value',
                message: 'Channel profile must contain only JSON values',
                severity: 'error',
                source: 'domain',
            },
        ])
    }
}
