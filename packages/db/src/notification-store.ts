import {
    createProjectNotification,
    DomainInvariantError,
    notificationKinds,
    projectNotificationTemplate,
    requireNonBlank,
    requireTimestamp,
    type NotificationKind,
    type ProjectNotification,
} from '@herald/core'

import type { HeraldDatabase } from './client'
import { createEventJournalStore, parseEventJournalCursor } from './event-journal-store'

const projectionName = 'in-app-notifications-v1'
const defaultListLimit = 50
const maximumListLimit = 100
const defaultProjectionLimit = 100
const maximumProjectionLimit = 500

interface HumanActorRow {
    readonly id: string
}

interface PreferenceRow {
    readonly enabled: number
}

interface CursorRow {
    readonly cursor: string | null
}

interface NotificationRow {
    readonly id: string
    readonly projectId: string
    readonly recipientActorId: string
    readonly sourceEventId: string
    readonly kind: NotificationKind
    readonly severity: ProjectNotification['severity']
    readonly subjectType: string
    readonly subjectId: string
    readonly title: string
    readonly body: string
    readonly readAt: number | null
    readonly archivedAt: number | null
    readonly createdAt: number
}

export interface NotificationPreference {
    readonly kind: NotificationKind
    readonly inAppEnabled: boolean
}

export interface ProjectNotificationsResult {
    readonly scanned: number
    readonly created: number
    readonly hasMore: boolean
}

export interface ListNotificationsInput {
    readonly projectId: string
    readonly subjectId: string
    readonly includeArchived?: boolean
    readonly limit?: number
}

export interface UpdateNotificationPreferenceInput {
    readonly projectId: string
    readonly subjectId: string
    readonly kind: NotificationKind
    readonly inAppEnabled: boolean
}

export interface NotificationStoreOptions {
    readonly createId?: () => string
    readonly now?: () => number
}

export function createNotificationStore(
    database: HeraldDatabase,
    options: NotificationStoreOptions = {}
) {
    const client = database.$client
    const journal = createEventJournalStore(database)
    const createId = options.createId ?? (() => crypto.randomUUID())
    const now = options.now ?? Date.now

    const listProjectIdsStatement = client.query<{ readonly id: string }, []>(`
        select id from projects order by created_at, id
    `)
    const loadHumanActorStatement = client.query<
        HumanActorRow,
        [projectId: string, subjectId: string]
    >(`
        select id from actors
        where project_id = ?1 and subject_id = ?2 and kind = 'human'
        order by created_at, id limit 1
    `)
    const listHumanActorsStatement = client.query<HumanActorRow, [projectId: string]>(`
        select id from actors
        where project_id = ?1 and kind = 'human' and subject_id is not null
        order by created_at, id
    `)
    const loadPreferenceStatement = client.query<
        PreferenceRow,
        [projectId: string, actorId: string, kind: NotificationKind]
    >(`
        select in_app_enabled as enabled from notification_preferences
        where project_id = ?1 and recipient_actor_id = ?2 and kind = ?3
    `)
    const loadCursorStatement = client.query<CursorRow, [projectId: string, projection: string]>(`
        select cursor from notification_projection_cursors
        where project_id = ?1 and projection = ?2
    `)
    const insertNotificationStatement = client.query<
        { readonly changes: number },
        [
            id: string,
            projectId: string,
            recipientActorId: string,
            sourceEventId: string,
            kind: NotificationKind,
            severity: ProjectNotification['severity'],
            subjectType: string,
            subjectId: string,
            title: string,
            body: string,
            createdAt: number,
        ]
    >(`
        insert into notifications (
            id, project_id, recipient_actor_id, source_event_id, kind, severity,
            subject_type, subject_id, title, body, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        on conflict(project_id, recipient_actor_id, source_event_id) do nothing
    `)
    const upsertCursorStatement = client.query<
        void,
        [id: string, projectId: string, projection: string, cursor: string, timestamp: number]
    >(`
        insert into notification_projection_cursors (
            id, project_id, projection, cursor, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?5)
        on conflict(project_id, projection) do update set
            cursor = excluded.cursor, updated_at = excluded.updated_at
    `)
    const notificationColumns = `
        id, project_id as projectId, recipient_actor_id as recipientActorId,
        source_event_id as sourceEventId, kind, severity, subject_type as subjectType,
        subject_id as subjectId, title, body, read_at as readAt,
        archived_at as archivedAt, created_at as createdAt
    `
    const listNotificationsStatement = client.query<
        NotificationRow,
        [projectId: string, actorId: string, includeArchived: number, limit: number]
    >(`
        select ${notificationColumns} from notifications
        where project_id = ?1 and recipient_actor_id = ?2
          and (?3 = 1 or archived_at is null)
        order by created_at desc, id desc limit ?4
    `)
    const countUnreadStatement = client.query<
        { readonly count: number },
        [projectId: string, actorId: string]
    >(`
        select count(*) as count from notifications
        where project_id = ?1 and recipient_actor_id = ?2
          and read_at is null and archived_at is null
    `)
    const loadNotificationStatement = client.query<
        NotificationRow,
        [id: string, projectId: string, actorId: string]
    >(`
        select ${notificationColumns} from notifications
        where id = ?1 and project_id = ?2 and recipient_actor_id = ?3
    `)
    const markReadStatement = client.query<
        void,
        [readAt: number, id: string, projectId: string, actorId: string]
    >(`
        update notifications set read_at = coalesce(read_at, ?1)
        where id = ?2 and project_id = ?3 and recipient_actor_id = ?4
    `)
    const archiveStatement = client.query<
        void,
        [archivedAt: number, id: string, projectId: string, actorId: string]
    >(`
        update notifications set archived_at = coalesce(archived_at, ?1)
        where id = ?2 and project_id = ?3 and recipient_actor_id = ?4
    `)
    const listPreferencesStatement = client.query<
        { readonly kind: NotificationKind; readonly enabled: number },
        [projectId: string, actorId: string]
    >(`
        select kind, in_app_enabled as enabled from notification_preferences
        where project_id = ?1 and recipient_actor_id = ?2
    `)
    const upsertPreferenceStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            kind: NotificationKind,
            enabled: number,
            timestamp: number,
        ]
    >(`
        insert into notification_preferences (
            id, project_id, recipient_actor_id, kind, in_app_enabled, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        on conflict(project_id, recipient_actor_id, kind) do update set
            in_app_enabled = excluded.in_app_enabled, updated_at = excluded.updated_at
    `)

    const projectTransaction = client.transaction(
        (projectId: string, limit: number): ProjectNotificationsResult => {
            const storedCursor = loadCursorStatement.get(projectId, projectionName)?.cursor ?? null
            const after = storedCursor === null ? null : parseEventJournalCursor(storedCursor)
            const events = journal.readAfter({ projectId, after, limit })
            if (events.length === 0) return { scanned: 0, created: 0, hasMore: false }

            const recipients = listHumanActorsStatement.all(projectId)
            let created = 0
            for (const event of events) {
                const template = projectNotificationTemplate(event)
                if (template === null) continue

                for (const recipient of recipients) {
                    const preference = loadPreferenceStatement.get(
                        projectId,
                        recipient.id,
                        template.kind
                    )
                    if (preference?.enabled === 0) continue

                    const notification = createProjectNotification({
                        id: createId(),
                        projectId,
                        recipientActorId: recipient.id,
                        sourceEventId: event.id,
                        kind: template.kind,
                        severity: template.severity,
                        subject: event.subject,
                        title: template.title,
                        body: template.body,
                        createdAt: event.occurredAt,
                    })
                    created += insertNotificationStatement.run(
                        notification.id,
                        notification.projectId,
                        notification.recipientActorId,
                        notification.sourceEventId,
                        notification.kind,
                        notification.severity,
                        notification.subject.type,
                        notification.subject.id,
                        notification.title,
                        notification.body,
                        notification.createdAt
                    ).changes
                }
            }

            const cursor = events.at(-1)?.cursor
            if (cursor === undefined) {
                throw new DomainInvariantError('invalid_input', 'notification cursor is missing')
            }
            upsertCursorStatement.run(
                createId(),
                projectId,
                projectionName,
                cursor,
                requireTimestamp(now(), 'now')
            )
            return { scanned: events.length, created, hasMore: events.length === limit }
        }
    )

    function resolveHumanActor(projectId: string, subjectId: string): HumanActorRow | null {
        return loadHumanActorStatement.get(
            requireNonBlank(projectId, 'projectId'),
            requireNonBlank(subjectId, 'subjectId')
        )
    }

    return {
        listProjectIds(): readonly string[] {
            return listProjectIdsStatement.all().map(row => row.id)
        },

        project(projectId: string, limit = defaultProjectionLimit): ProjectNotificationsResult {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumProjectionLimit) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `notification projection limit must be between 1 and ${maximumProjectionLimit}`
                )
            }
            return projectTransaction.immediate(normalizedProjectId, limit)
        },

        list(input: ListNotificationsInput): readonly ProjectNotification[] | null {
            const actor = resolveHumanActor(input.projectId, input.subjectId)
            if (actor === null) return null
            const limit = input.limit ?? defaultListLimit
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumListLimit) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `notification list limit must be between 1 and ${maximumListLimit}`
                )
            }
            return listNotificationsStatement
                .all(input.projectId, actor.id, input.includeArchived === true ? 1 : 0, limit)
                .map(toNotification)
        },

        countUnread(projectId: string, subjectId: string): number | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            return countUnreadStatement.get(projectId, actor.id)?.count ?? 0
        },

        markRead(
            projectId: string,
            notificationId: string,
            subjectId: string
        ): ProjectNotification | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            const id = requireNonBlank(notificationId, 'notificationId')
            markReadStatement.run(requireTimestamp(now(), 'now'), id, projectId, actor.id)
            const row = loadNotificationStatement.get(id, projectId, actor.id)
            return row === null ? null : toNotification(row)
        },

        archive(
            projectId: string,
            notificationId: string,
            subjectId: string
        ): ProjectNotification | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            const id = requireNonBlank(notificationId, 'notificationId')
            archiveStatement.run(requireTimestamp(now(), 'now'), id, projectId, actor.id)
            const row = loadNotificationStatement.get(id, projectId, actor.id)
            return row === null ? null : toNotification(row)
        },

        listPreferences(
            projectId: string,
            subjectId: string
        ): readonly NotificationPreference[] | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            const explicit = new Map(
                listPreferencesStatement
                    .all(projectId, actor.id)
                    .map(row => [row.kind, row.enabled === 1] as const)
            )
            return notificationKinds.map(kind => ({
                kind,
                inAppEnabled: explicit.get(kind) ?? true,
            }))
        },

        updatePreference(input: UpdateNotificationPreferenceInput): NotificationPreference | null {
            const actor = resolveHumanActor(input.projectId, input.subjectId)
            if (actor === null) return null
            if (!notificationKinds.includes(input.kind)) {
                throw new DomainInvariantError('invalid_input', 'notification kind is invalid')
            }
            upsertPreferenceStatement.run(
                createId(),
                input.projectId,
                actor.id,
                input.kind,
                input.inAppEnabled ? 1 : 0,
                requireTimestamp(now(), 'now')
            )
            return { kind: input.kind, inAppEnabled: input.inAppEnabled }
        },
    }
}

export type NotificationStore = ReturnType<typeof createNotificationStore>

function toNotification(row: NotificationRow): ProjectNotification {
    return createProjectNotification({
        id: row.id,
        projectId: row.projectId,
        recipientActorId: row.recipientActorId,
        sourceEventId: row.sourceEventId,
        kind: row.kind,
        severity: row.severity,
        subject: { type: row.subjectType, id: row.subjectId },
        title: row.title,
        body: row.body,
        readAt: row.readAt,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
    })
}
