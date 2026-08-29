import {
    DomainInvariantError,
    createActor,
    createChannel,
    createJob,
    createPost,
    createProject,
    createPublication,
    requireNonBlank,
    requireTimestamp,
    transitionPublication,
    type Actor,
    type Channel,
    type Post,
    type Project,
    type Publication,
    type Publisher,
    type Timestamp,
} from '@herald/core'

import type { HeraldDatabase } from './client'

export interface ManualStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
}

export interface CreateProjectInput {
    readonly name: string
    readonly subjectId: string
    readonly displayName: string
}

export interface CreateChannelInput {
    readonly projectId: string
    readonly subjectId: string
    readonly name: string
}

export interface CreatePostPublicationInput {
    readonly channelId: string
    readonly content?: string
    readonly scheduledAt?: Timestamp | null
}

export interface CreatePostInput {
    readonly projectId: string
    readonly subjectId: string
    readonly title?: string | null
    readonly content: string
    readonly publications: readonly CreatePostPublicationInput[]
}

export interface PublishManualPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly externalId?: string
    readonly externalUrl?: string
}

export interface ReconcileAmbiguousPublicationInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly resolution: 'published' | 'failed'
    readonly externalId?: string
    readonly externalUrl?: string
    readonly errorMessage?: string
}

export interface CreatedProject {
    readonly project: Project
    readonly actor: Actor
}

export interface CreatedPost {
    readonly post: Post
    readonly publications: readonly Publication[]
}

export type ReconcileAmbiguousPublicationResult =
    | { readonly kind: 'reconciled'; readonly publication: Publication }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'not_ambiguous' }

export interface DueManualPublication extends Publication {
    readonly postTitle: string | null
    readonly channelName: string
}

export interface AuditEvent {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: Timestamp
}

interface ProjectRow {
    readonly id: string
    readonly name: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface ActorRow {
    readonly id: string
    readonly projectId: string
    readonly kind: Actor['kind']
    readonly subjectId: string | null
    readonly displayName: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface ChannelRow {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly createdAt: number
    readonly updatedAt: number
}

interface PublicationChannelRow extends ChannelRow {
    readonly publisherId: string | null
    readonly publisherKind: string | null
    readonly publisherCreatedAt: number | null
    readonly publisherUpdatedAt: number | null
}

interface PublicationRow {
    readonly id: string
    readonly projectId: string
    readonly postId: string
    readonly channelId: string
    readonly content: string
    readonly state: Publication['state']
    readonly scheduledAt: number | null
    readonly publishedAt: number | null
    readonly externalId: string | null
    readonly externalUrl: string | null
    readonly errorMessage: string | null
    readonly createdByActorId: string
    readonly scheduledByActorId: string | null
    readonly stateChangedByActorId: string
    readonly publishedByActorId: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface DuePublicationRow extends PublicationRow {
    readonly postTitle: string | null
    readonly channelName: string
}

interface AuditEventRow {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: number
}

const publicationColumns = `
    publications.id,
    publications.project_id as projectId,
    publications.post_id as postId,
    publications.channel_id as channelId,
    publications.content,
    publications.state,
    publications.scheduled_at as scheduledAt,
    publications.published_at as publishedAt,
    publications.external_id as externalId,
    publications.external_url as externalUrl,
    publications.error_message as errorMessage,
    publications.created_by_actor_id as createdByActorId,
    publications.scheduled_by_actor_id as scheduledByActorId,
    publications.state_changed_by_actor_id as stateChangedByActorId,
    publications.published_by_actor_id as publishedByActorId,
    publications.created_at as createdAt,
    publications.updated_at as updatedAt
`

export function createManualStore(database: HeraldDatabase, options: ManualStoreOptions = {}) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())

    const loadProjectStatement = client.query<ProjectRow, [projectId: string]>(`
        select id, name, created_at as createdAt, updated_at as updatedAt
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
          and kind = 'human'
        order by created_at, id
        limit 1
    `)
    const loadChannelStatement = client.query<
        PublicationChannelRow,
        [projectId: string, channelId: string]
    >(`
        select channels.id,
               channels.project_id as projectId,
               channels.name,
               channels.created_at as createdAt,
               channels.updated_at as updatedAt,
               publishers.id as publisherId,
               publishers.kind as publisherKind,
               publishers.created_at as publisherCreatedAt,
               publishers.updated_at as publisherUpdatedAt
        from channels
        left join publishers
            on publishers.project_id = channels.project_id
           and publishers.channel_id = channels.id
        where channels.project_id = ?1
          and channels.id = ?2
    `)
    const loadPublicationStatement = client.query<
        PublicationRow,
        [projectId: string, publicationId: string, now: number]
    >(`
        select ${publicationColumns}
        from publications
        where project_id = ?1
          and id = ?2
          and state = 'scheduled'
          and scheduled_at <= ?3
          and not exists (
              select 1
              from publishers
              where publishers.project_id = publications.project_id
                and publishers.channel_id = publications.channel_id
        )
    `)
    const loadPublicationByIdStatement = client.query<
        PublicationRow,
        [projectId: string, publicationId: string]
    >(`
        select ${publicationColumns}
        from publications
        where project_id = ?1
          and id = ?2
    `)

    const insertProjectStatement = client.query<void, [id: string, name: string, now: number]>(`
        insert into projects (id, name, created_at, updated_at)
        values (?1, ?2, ?3, ?3)
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
        [id: string, projectId: string, name: string, now: number]
    >(`
        insert into channels (id, project_id, name, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?4)
    `)
    const insertPostStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            title: string | null,
            content: string,
            actorId: string,
            now: number,
        ]
    >(`
        insert into posts (id, project_id, title, content, created_by_actor_id, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `)
    const insertPublicationStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            postId: string,
            channelId: string,
            content: string,
            state: Publication['state'],
            scheduledAt: number | null,
            createdByActorId: string,
            scheduledByActorId: string | null,
            stateChangedByActorId: string,
            now: number,
        ]
    >(`
        insert into publications (
            id,
            project_id,
            post_id,
            channel_id,
            content,
            state,
            scheduled_at,
            created_by_actor_id,
            scheduled_by_actor_id,
            state_changed_by_actor_id,
            created_at,
            updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
    `)
    const insertJobStatement = client.query<
        void,
        [id: string, projectId: string, publicationId: string, runAt: number, now: number]
    >(`
        insert into jobs (
            id,
            project_id,
            publication_id,
            state,
            run_at,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, 'pending', ?4, ?5, ?5)
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
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)
    const publishPublicationStatement = client.query<
        void,
        [
            publicationId: string,
            projectId: string,
            publishedAt: number,
            actorId: string,
            externalId: string | null,
            externalUrl: string | null,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?3,
            published_by_actor_id = ?4,
            external_id = ?5,
            external_url = ?6,
            error_message = null,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'scheduled'
    `)
    const reconcilePublishedPublicationStatement = client.query<
        { changes: number },
        [
            publicationId: string,
            projectId: string,
            publishedAt: number,
            actorId: string,
            externalId: string,
            externalUrl: string | null,
        ]
    >(`
        update publications
        set state = 'published',
            published_at = ?3,
            published_by_actor_id = ?4,
            external_id = ?5,
            external_url = ?6,
            error_message = null,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'ambiguous'
    `)
    const reconcileFailedPublicationStatement = client.query<
        { changes: number },
        [
            publicationId: string,
            projectId: string,
            updatedAt: number,
            actorId: string,
            errorMessage: string,
        ]
    >(`
        update publications
        set state = 'failed',
            error_message = ?5,
            state_changed_by_actor_id = ?4,
            updated_at = ?3
        where id = ?1
          and project_id = ?2
          and state = 'ambiguous'
    `)
    const listProjectsStatement = client.query<ProjectRow, [subjectId: string]>(`
        select distinct projects.id,
               projects.name,
               projects.created_at as createdAt,
               projects.updated_at as updatedAt
        from projects
        inner join actors
            on actors.project_id = projects.id
           and actors.kind = 'human'
           and actors.subject_id = ?1
        order by projects.created_at, projects.id
    `)
    const listChannelsStatement = client.query<ChannelRow, [projectId: string]>(`
        select id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt
        from channels
        where project_id = ?1
        order by created_at, id
    `)
    const listDuePublicationsStatement = client.query<
        DuePublicationRow,
        [projectId: string, now: number]
    >(`
        select ${publicationColumns},
               posts.title as postTitle,
               channels.name as channelName
        from publications
        inner join posts
            on posts.project_id = publications.project_id
           and posts.id = publications.post_id
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        where publications.project_id = ?1
          and publications.state = 'scheduled'
          and publications.scheduled_at <= ?2
          and not exists (
              select 1
              from publishers
              where publishers.project_id = publications.project_id
                and publishers.channel_id = publications.channel_id
          )
        order by publications.scheduled_at, publications.id
    `)
    const listAuditEventsStatement = client.query<
        AuditEventRow,
        [projectId: string, limit: number]
    >(`
        select id,
               project_id as projectId,
               actor_id as actorId,
               action,
               entity_type as entityType,
               entity_id as entityId,
               metadata_json as metadataJson,
               created_at as createdAt
        from audit_events
        where project_id = ?1
        order by created_at desc, id desc
        limit ?2
    `)

    const createProjectTransaction = client.transaction(
        (input: CreateProjectInput): CreatedProject => {
            const timestamp = requireTimestamp(now(), 'now')
            const project = createProject({
                id: createId(),
                name: input.name,
                now: timestamp,
            })
            const actor = createActor({
                id: createId(),
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

            insertProjectStatement.run(project.id, project.name, timestamp)
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
            insertAuditEventStatement.run(
                createId(),
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

    const createChannelTransaction = client.transaction(
        (input: CreateChannelInput): Channel | null => {
            const actor = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actor === null || projectRow === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const project = toProject(projectRow)
            const channel = createChannel({
                id: createId(),
                project,
                name: input.name,
                now: timestamp,
            })

            insertChannelStatement.run(channel.id, project.id, channel.name, timestamp)
            insertAuditEventStatement.run(
                createId(),
                project.id,
                actor.id,
                'channel.created',
                'channel',
                channel.id,
                JSON.stringify({ name: channel.name }),
                timestamp
            )

            return channel
        }
    )

    const createPostTransaction = client.transaction(
        (input: CreatePostInput): CreatedPost | null => {
            if (input.publications.length === 0) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'At least one publication is required'
                )
            }

            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const projectRow = loadProjectStatement.get(input.projectId)
            if (actorRow === null || projectRow === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const project = toProject(projectRow)
            const actor = toActor(actorRow)
            const post = createPost({
                id: createId(),
                project,
                createdBy: actor,
                title: input.title,
                content: input.content,
                now: timestamp,
            })

            const publicationEntries = input.publications.map(publicationInput => {
                const channelRow = loadChannelStatement.get(project.id, publicationInput.channelId)
                if (channelRow === null) {
                    throw new DomainInvariantError(
                        'project_mismatch',
                        `Channel ${publicationInput.channelId} does not belong to project`
                    )
                }
                return {
                    publication: createPublication({
                        id: createId(),
                        project,
                        post,
                        channel: toChannel(channelRow),
                        createdBy: actor,
                        content: publicationInput.content ?? post.content,
                        scheduledAt: publicationInput.scheduledAt,
                        now: timestamp,
                    }),
                    publisher: channelRow.publisherId === null ? null : toPublisher(channelRow),
                }
            })
            const publications = publicationEntries.map(entry => entry.publication)

            insertPostStatement.run(
                post.id,
                project.id,
                post.title,
                post.content,
                actor.id,
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                project.id,
                actor.id,
                'post.created',
                'post',
                post.id,
                JSON.stringify({ title: post.title }),
                timestamp
            )

            for (const entry of publicationEntries) {
                const { publication } = entry
                insertPublicationStatement.run(
                    publication.id,
                    project.id,
                    post.id,
                    publication.channelId,
                    publication.content,
                    publication.state,
                    publication.scheduledAt,
                    publication.createdByActorId,
                    publication.scheduledByActorId,
                    publication.stateChangedByActorId,
                    timestamp
                )
                insertAuditEventStatement.run(
                    createId(),
                    project.id,
                    actor.id,
                    'publication.created',
                    'publication',
                    publication.id,
                    JSON.stringify({
                        channelId: publication.channelId,
                        scheduledAt: publication.scheduledAt,
                        state: publication.state,
                    }),
                    timestamp
                )

                if (entry.publisher !== null && publication.scheduledAt !== null) {
                    const job = createJob({
                        id: createId(),
                        publication,
                        publisher: entry.publisher,
                        runAt: publication.scheduledAt,
                        now: timestamp,
                    })
                    insertJobStatement.run(
                        job.id,
                        job.projectId,
                        job.publicationId,
                        job.runAt,
                        timestamp
                    )
                }
            }

            return { post, publications }
        }
    )

    const publishManualPublicationTransaction = client.transaction(
        (input: PublishManualPublicationInput): Publication | null => {
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            if (actorRow === null) return null

            const timestamp = requireTimestamp(now(), 'now')
            const row = loadPublicationStatement.get(
                input.projectId,
                input.publicationId,
                timestamp
            )
            if (row === null) return null

            const publication = toPublication(row)
            const actor = toActor(actorRow)
            const ready = transitionPublication({
                publication,
                to: 'ready',
                actor,
                now: timestamp,
            })
            const published = transitionPublication({
                publication: ready,
                to: 'published',
                actor,
                now: timestamp,
                externalId: input.externalId,
                externalUrl: input.externalUrl,
            })

            const result = publishPublicationStatement.run(
                published.id,
                published.projectId,
                published.publishedAt as number,
                published.publishedByActorId as string,
                published.externalId,
                published.externalUrl
            )
            if (result.changes !== 1) return null

            insertAuditEventStatement.run(
                createId(),
                published.projectId,
                actor.id,
                'publication.ready',
                'publication',
                published.id,
                JSON.stringify({ fromState: publication.state, toState: ready.state }),
                timestamp
            )
            insertAuditEventStatement.run(
                createId(),
                published.projectId,
                actor.id,
                'publication.published',
                'publication',
                published.id,
                JSON.stringify({
                    fromState: ready.state,
                    toState: published.state,
                    externalId: published.externalId,
                    externalUrl: published.externalUrl,
                }),
                timestamp
            )

            return published
        }
    )
    const reconcileAmbiguousPublicationTransaction = client.transaction(
        (input: ReconcileAmbiguousPublicationInput): ReconcileAmbiguousPublicationResult => {
            const actorRow = loadActorStatement.get(input.projectId, input.subjectId)
            const row = loadPublicationByIdStatement.get(input.projectId, input.publicationId)
            if (actorRow === null || row === null) return { kind: 'not_found' }
            if (row.state !== 'ambiguous') return { kind: 'not_ambiguous' }

            const timestamp = requireTimestamp(now(), 'now')
            const publication = toPublication(row)
            const actor = toActor(actorRow)
            const reconciled =
                input.resolution === 'published'
                    ? transitionPublication({
                          publication,
                          to: 'published',
                          actor,
                          now: timestamp,
                          externalId: requireNonBlank(input.externalId ?? '', 'externalId'),
                          externalUrl:
                              input.externalUrl === undefined
                                  ? undefined
                                  : requireNonBlank(input.externalUrl, 'externalUrl'),
                      })
                    : transitionPublication({
                          publication,
                          to: 'failed',
                          actor,
                          now: timestamp,
                          errorMessage: requireNonBlank(input.errorMessage ?? '', 'errorMessage'),
                      })

            const result =
                reconciled.state === 'published'
                    ? reconcilePublishedPublicationStatement.run(
                          reconciled.id,
                          reconciled.projectId,
                          reconciled.publishedAt as number,
                          reconciled.publishedByActorId as string,
                          reconciled.externalId as string,
                          reconciled.externalUrl
                      )
                    : reconcileFailedPublicationStatement.run(
                          reconciled.id,
                          reconciled.projectId,
                          reconciled.updatedAt,
                          reconciled.stateChangedByActorId,
                          reconciled.errorMessage as string
                      )

            if (result.changes !== 1) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not reconcile publication ${reconciled.id}`
                )
            }

            insertAuditEventStatement.run(
                createId(),
                reconciled.projectId,
                actor.id,
                'publication.reconciled',
                'publication',
                reconciled.id,
                JSON.stringify({
                    fromState: publication.state,
                    toState: reconciled.state,
                    externalId: reconciled.externalId,
                    externalUrl: reconciled.externalUrl,
                    errorMessage: reconciled.errorMessage,
                }),
                timestamp
            )

            return { kind: 'reconciled', publication: reconciled }
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

        createPost(input: CreatePostInput): CreatedPost | null {
            return createPostTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        listDueManualPublications(
            projectId: string,
            subjectId: string,
            at?: number
        ): DueManualPublication[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            const timestamp = requireTimestamp(at ?? now(), 'now')
            return listDuePublicationsStatement.all(normalizedProjectId, timestamp).map(row => ({
                ...toPublication(row),
                postTitle: row.postTitle,
                channelName: row.channelName,
            }))
        },

        publishManualPublication(input: PublishManualPublicationInput): Publication | null {
            return publishManualPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                externalId:
                    input.externalId === undefined
                        ? undefined
                        : requireNonBlank(input.externalId, 'externalId'),
                externalUrl:
                    input.externalUrl === undefined
                        ? undefined
                        : requireNonBlank(input.externalUrl, 'externalUrl'),
            })
        },

        reconcileAmbiguousPublication(
            input: ReconcileAmbiguousPublicationInput
        ): ReconcileAmbiguousPublicationResult {
            return reconcileAmbiguousPublicationTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                externalId:
                    input.externalId === undefined
                        ? undefined
                        : requireNonBlank(input.externalId, 'externalId'),
                externalUrl:
                    input.externalUrl === undefined
                        ? undefined
                        : requireNonBlank(input.externalUrl, 'externalUrl'),
                errorMessage:
                    input.errorMessage === undefined
                        ? undefined
                        : requireNonBlank(input.errorMessage, 'errorMessage'),
            })
        },

        listAuditEvents(projectId: string, subjectId: string, limit = 100): AuditEvent[] | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const actor = loadActorStatement.get(
                normalizedProjectId,
                requireNonBlank(subjectId, 'subjectId')
            )
            if (actor === null) return null

            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
                throw new DomainInvariantError('invalid_input', 'limit must be between 1 and 100')
            }

            return listAuditEventsStatement.all(normalizedProjectId, limit).map(toAuditEvent)
        },
    }
}

function toProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toActor(row: ActorRow): Actor {
    return {
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
        subjectId: row.subjectId,
        displayName: row.displayName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toChannel(row: ChannelRow): Channel {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toPublisher(row: PublicationChannelRow): Publisher {
    if (
        row.publisherId === null ||
        row.publisherKind === null ||
        row.publisherCreatedAt === null ||
        row.publisherUpdatedAt === null
    ) {
        throw new DomainInvariantError(
            'invalid_input',
            'A publisher row is incomplete for an automated publication'
        )
    }

    return {
        id: row.publisherId,
        projectId: row.projectId,
        channelId: row.id,
        kind: row.publisherKind,
        createdAt: row.publisherCreatedAt,
        updatedAt: row.publisherUpdatedAt,
    }
}

function toPublication(row: PublicationRow): Publication {
    return {
        id: row.id,
        projectId: row.projectId,
        postId: row.postId,
        channelId: row.channelId,
        content: row.content,
        state: row.state,
        scheduledAt: row.scheduledAt,
        publishedAt: row.publishedAt,
        externalId: row.externalId,
        externalUrl: row.externalUrl,
        errorMessage: row.errorMessage,
        createdByActorId: row.createdByActorId,
        scheduledByActorId: row.scheduledByActorId,
        stateChangedByActorId: row.stateChangedByActorId,
        publishedByActorId: row.publishedByActorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
    return {
        id: row.id,
        projectId: row.projectId,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadataJson: row.metadataJson,
        createdAt: row.createdAt,
    }
}
