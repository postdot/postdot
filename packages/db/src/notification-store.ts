import {
    createUserNotification,
    DomainInvariantError,
    notificationKinds,
    projectNotificationTemplate,
    requireNonBlank,
    requireTimestamp,
    type NotificationKind,
    type UserNotification,
} from '@postdot/core'

import type { PostbotDatabase } from './client'
import { createEventJournalStore, parseEventJournalCursor } from './event-journal-store'

const projectionName = 'in-app-notifications-v1'
const defaultListLimit = 50
const maximumListLimit = 100
const defaultProjectionLimit = 100
const maximumProjectionLimit = 500
const notificationCursorPrefix = 'notification:'

interface HumanActorRow {
    readonly id: string
    readonly userId: string
}

interface PreferenceRow {
    readonly enabled: number
}

interface CursorRow {
    readonly cursor: string | null
}

interface NotificationRow {
    readonly id: string
    readonly projectId: string | null
    readonly recipientUserId: string
    readonly recipientActorId: string | null
    readonly sourceEventId: string
    readonly kind: NotificationKind
    readonly severity: UserNotification['severity']
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
    readonly before?: string | null
}

export interface NotificationInboxPage {
    readonly items: readonly UserNotification[]
    readonly nextCursor: string | null
}

export interface UpdateNotificationPreferenceInput {
    readonly projectId: string
    readonly subjectId: string
    readonly kind: NotificationKind
    readonly inAppEnabled: boolean
}

export interface ListUserNotificationsInput {
    readonly userId: string
    readonly projectId?: string | null
    readonly includeArchived?: boolean
    readonly limit?: number
    readonly before?: string | null
}

export interface UpdateUserNotificationPreferenceInput {
    readonly userId: string
    readonly kind: NotificationKind
    readonly inAppEnabled: boolean
}

export interface NotificationStoreOptions {
    readonly createId?: () => string
    readonly now?: () => number
}

export function createNotificationStore(
    database: PostbotDatabase,
    options: NotificationStoreOptions = {}
) {
    const client = database.$client
    const journal = createEventJournalStore(database)
    const createId = options.createId ?? (() => crypto.randomUUID())
    const now = options.now ?? Date.now

    const listProjectIdsStatement = client.query<{ readonly id: string }, []>(`
        select id from projects order by created_at, id
    `)
    const listUserProjectIdsStatement = client.query<{ readonly id: string }, [userId: string]>(`
        select distinct project_id as id from actors
        where subject_id = ?1
          and project_id is not null
          and kind in ('human', 'agent', 'api_token')
        order by project_id
    `)
    const listProjectUserIdsStatement = client.query<
        { readonly userId: string },
        [projectId: string]
    >(`
        select distinct subject_id as userId from actors
        where project_id = ?1
          and kind in ('human', 'agent', 'api_token')
          and subject_id is not null
        order by subject_id
    `)
    const loadHumanActorStatement = client.query<
        HumanActorRow,
        [projectId: string, subjectId: string]
    >(`
        select id, subject_id as userId from actors
        where project_id = ?1 and subject_id = ?2 and kind = 'human'
        order by created_at, id limit 1
    `)
    const listHumanActorsStatement = client.query<HumanActorRow, [projectId: string]>(`
        select id, subject_id as userId from actors
        where project_id = ?1 and kind = 'human' and subject_id is not null
        order by created_at, id
    `)
    const loadUserPreferenceStatement = client.query<
        PreferenceRow,
        [userId: string, kind: NotificationKind]
    >(`
        select in_app_enabled as enabled from notification_user_preferences
        where user_id = ?1 and kind = ?2
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
            recipientUserId: string,
            recipientActorId: string,
            sourceEventId: string,
            kind: NotificationKind,
            severity: UserNotification['severity'],
            subjectType: string,
            subjectId: string,
            title: string,
            body: string,
            createdAt: number,
        ]
    >(`
        insert into notifications (
            id, project_id, recipient_user_id, recipient_actor_id, source_event_id,
            kind, severity, subject_type, subject_id, title, body, created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        on conflict(recipient_user_id, project_id, source_event_id) do nothing
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
        id, project_id as projectId, recipient_user_id as recipientUserId,
        recipient_actor_id as recipientActorId,
        source_event_id as sourceEventId, kind, severity, subject_type as subjectType,
        subject_id as subjectId, title, body, read_at as readAt,
        archived_at as archivedAt, created_at as createdAt
    `
    const listNotificationsStatement = client.query<
        NotificationRow,
        [
            projectId: string,
            actorId: string,
            includeArchived: number,
            beforeCreatedAt: number | null,
            beforeId: string | null,
            limit: number,
        ]
    >(`
        select ${notificationColumns} from notifications
        where project_id = ?1 and recipient_actor_id = ?2
          and (?3 = 1 or archived_at is null)
          and (
              ?4 is null
              or created_at < ?4
              or (created_at = ?4 and id < ?5)
          )
        order by created_at desc, id desc limit ?6
    `)
    const listUserNotificationsStatement = client.query<
        NotificationRow,
        [
            userId: string,
            projectId: string | null,
            includeArchived: number,
            beforeCreatedAt: number | null,
            beforeId: string | null,
            limit: number,
        ]
    >(`
        select ${notificationColumns} from notifications
        where recipient_user_id = ?1
          and (?2 is null or project_id = ?2)
          and (?3 = 1 or archived_at is null)
          and (
              ?4 is null
              or created_at < ?4
              or (created_at = ?4 and id < ?5)
          )
        order by created_at desc, id desc limit ?6
    `)
    const countUnreadStatement = client.query<
        { readonly count: number },
        [projectId: string, actorId: string]
    >(`
        select count(*) as count from notifications
        where project_id = ?1 and recipient_actor_id = ?2
          and read_at is null and archived_at is null
    `)
    const countUnreadForUserStatement = client.query<
        { readonly count: number },
        [userId: string, projectId: string | null]
    >(`
        select count(*) as count from notifications
        where recipient_user_id = ?1 and (?2 is null or project_id = ?2)
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
    const loadUserNotificationStatement = client.query<
        NotificationRow,
        [id: string, userId: string]
    >(`
        select ${notificationColumns} from notifications
        where id = ?1 and recipient_user_id = ?2
    `)
    const markUserNotificationReadStatement = client.query<
        void,
        [readAt: number, id: string, userId: string]
    >(`
        update notifications set read_at = coalesce(read_at, ?1)
        where id = ?2 and recipient_user_id = ?3
    `)
    const archiveUserNotificationStatement = client.query<
        void,
        [archivedAt: number, id: string, userId: string]
    >(`
        update notifications set archived_at = coalesce(archived_at, ?1)
        where id = ?2 and recipient_user_id = ?3
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
    const listUserPreferencesStatement = client.query<
        { readonly kind: NotificationKind; readonly enabled: number },
        [userId: string]
    >(`
        select kind, in_app_enabled as enabled from notification_user_preferences
        where user_id = ?1
    `)
    const upsertUserPreferenceStatement = client.query<
        void,
        [id: string, userId: string, kind: NotificationKind, enabled: number, timestamp: number]
    >(`
        insert into notification_user_preferences (
            id, user_id, kind, in_app_enabled, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?5)
        on conflict(user_id, kind) do update set
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
                    const preference =
                        loadUserPreferenceStatement.get(recipient.userId, template.kind) ??
                        loadPreferenceStatement.get(projectId, recipient.id, template.kind)
                    if (preference?.enabled === 0) continue

                    const notification = createUserNotification({
                        id: createId(),
                        projectId,
                        recipientUserId: recipient.userId,
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
                        projectId,
                        notification.recipientUserId,
                        recipient.id,
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

        listProjectIdsForUser(userId: string): readonly string[] {
            return listUserProjectIdsStatement
                .all(requireNonBlank(userId, 'userId'))
                .map(row => row.id)
        },

        listUserIdsForProjects(projectIds: readonly string[]): readonly string[] {
            const users = new Set<string>()
            for (const projectId of projectIds) {
                for (const row of listProjectUserIdsStatement.all(
                    requireNonBlank(projectId, 'projectId')
                )) {
                    users.add(row.userId)
                }
            }
            return [...users].sort()
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

        listForUser(input: ListUserNotificationsInput): NotificationInboxPage {
            const userId = requireNonBlank(input.userId, 'userId')
            const projectId =
                input.projectId === undefined || input.projectId === null
                    ? null
                    : requireNonBlank(input.projectId, 'projectId')
            const limit = input.limit ?? defaultListLimit
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumListLimit) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `notification list limit must be between 1 and ${maximumListLimit}`
                )
            }
            const before = parseNotificationCursor(input.before)
            const rows = listUserNotificationsStatement.all(
                userId,
                projectId,
                input.includeArchived === true ? 1 : 0,
                before?.createdAt ?? null,
                before?.id ?? null,
                limit + 1
            )
            const hasMore = rows.length > limit
            const items = rows.slice(0, limit).map(toNotification)
            const last = hasMore ? items.at(-1) : undefined
            return {
                items,
                nextCursor:
                    last === undefined ? null : encodeNotificationCursor(last.createdAt, last.id),
            }
        },

        list(input: ListNotificationsInput): NotificationInboxPage | null {
            const actor = resolveHumanActor(input.projectId, input.subjectId)
            if (actor === null) return null
            const limit = input.limit ?? defaultListLimit
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumListLimit) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `notification list limit must be between 1 and ${maximumListLimit}`
                )
            }
            const before = parseNotificationCursor(input.before)
            const rows = listNotificationsStatement.all(
                input.projectId,
                actor.id,
                input.includeArchived === true ? 1 : 0,
                before?.createdAt ?? null,
                before?.id ?? null,
                limit + 1
            )
            const hasMore = rows.length > limit
            const items = rows.slice(0, limit).map(toNotification)
            const last = hasMore ? items.at(-1) : undefined
            return {
                items,
                nextCursor:
                    last === undefined ? null : encodeNotificationCursor(last.createdAt, last.id),
            }
        },

        countUnread(projectId: string, subjectId: string): number | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            return countUnreadStatement.get(projectId, actor.id)?.count ?? 0
        },

        countUnreadForUser(userId: string, projectId?: string | null): number {
            const normalizedUserId = requireNonBlank(userId, 'userId')
            const normalizedProjectId =
                projectId === undefined || projectId === null
                    ? null
                    : requireNonBlank(projectId, 'projectId')
            return (
                countUnreadForUserStatement.get(normalizedUserId, normalizedProjectId)?.count ?? 0
            )
        },

        markRead(
            projectId: string,
            notificationId: string,
            subjectId: string
        ): UserNotification | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            const id = requireNonBlank(notificationId, 'notificationId')
            const existing = loadNotificationStatement.get(id, projectId, actor.id)
            if (existing === null) return null
            markReadStatement.run(
                Math.max(requireTimestamp(now(), 'now'), existing.createdAt),
                id,
                projectId,
                actor.id
            )
            const row = loadNotificationStatement.get(id, projectId, actor.id)
            return row === null ? null : toNotification(row)
        },

        archive(
            projectId: string,
            notificationId: string,
            subjectId: string
        ): UserNotification | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            const id = requireNonBlank(notificationId, 'notificationId')
            const existing = loadNotificationStatement.get(id, projectId, actor.id)
            if (existing === null) return null
            archiveStatement.run(
                Math.max(requireTimestamp(now(), 'now'), existing.createdAt),
                id,
                projectId,
                actor.id
            )
            const row = loadNotificationStatement.get(id, projectId, actor.id)
            return row === null ? null : toNotification(row)
        },

        markReadForUser(notificationId: string, userId: string): UserNotification | null {
            const normalizedUserId = requireNonBlank(userId, 'userId')
            const id = requireNonBlank(notificationId, 'notificationId')
            const existing = loadUserNotificationStatement.get(id, normalizedUserId)
            if (existing === null) return null
            markUserNotificationReadStatement.run(
                Math.max(requireTimestamp(now(), 'now'), existing.createdAt),
                id,
                normalizedUserId
            )
            const row = loadUserNotificationStatement.get(id, normalizedUserId)
            return row === null ? null : toNotification(row)
        },

        archiveForUser(notificationId: string, userId: string): UserNotification | null {
            const normalizedUserId = requireNonBlank(userId, 'userId')
            const id = requireNonBlank(notificationId, 'notificationId')
            const existing = loadUserNotificationStatement.get(id, normalizedUserId)
            if (existing === null) return null
            archiveUserNotificationStatement.run(
                Math.max(requireTimestamp(now(), 'now'), existing.createdAt),
                id,
                normalizedUserId
            )
            const row = loadUserNotificationStatement.get(id, normalizedUserId)
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

        listUserPreferences(userId: string): readonly NotificationPreference[] {
            const normalizedUserId = requireNonBlank(userId, 'userId')
            const explicit = new Map(
                listUserPreferencesStatement
                    .all(normalizedUserId)
                    .map(row => [row.kind, row.enabled === 1] as const)
            )
            return notificationKinds.map(kind => ({
                kind,
                inAppEnabled: explicit.get(kind) ?? true,
            }))
        },

        updateUserPreference(input: UpdateUserNotificationPreferenceInput): NotificationPreference {
            const userId = requireNonBlank(input.userId, 'userId')
            if (!notificationKinds.includes(input.kind)) {
                throw new DomainInvariantError('invalid_input', 'notification kind is invalid')
            }
            upsertUserPreferenceStatement.run(
                createId(),
                userId,
                input.kind,
                input.inAppEnabled ? 1 : 0,
                requireTimestamp(now(), 'now')
            )
            return { kind: input.kind, inAppEnabled: input.inAppEnabled }
        },
    }
}

export type NotificationStore = ReturnType<typeof createNotificationStore>

function encodeNotificationCursor(createdAt: number, id: string): string {
    return `${notificationCursorPrefix}${createdAt}:${encodeURIComponent(id)}`
}

function parseNotificationCursor(
    cursor: string | null | undefined
): { readonly createdAt: number; readonly id: string } | null {
    if (cursor === null || cursor === undefined) return null
    if (!cursor.startsWith(notificationCursorPrefix)) {
        throw new DomainInvariantError('invalid_input', 'notification cursor is invalid')
    }
    const separator = cursor.indexOf(':', notificationCursorPrefix.length)
    if (separator < 0) {
        throw new DomainInvariantError('invalid_input', 'notification cursor is invalid')
    }
    const createdAt = Number(cursor.slice(notificationCursorPrefix.length, separator))
    let id: string
    try {
        id = decodeURIComponent(cursor.slice(separator + 1))
    } catch {
        throw new DomainInvariantError('invalid_input', 'notification cursor is invalid')
    }
    if (
        !Number.isSafeInteger(createdAt) ||
        createdAt < 0 ||
        id.length === 0 ||
        encodeNotificationCursor(createdAt, id) !== cursor
    ) {
        throw new DomainInvariantError('invalid_input', 'notification cursor is invalid')
    }
    return { createdAt, id }
}

function toNotification(row: NotificationRow): UserNotification {
    return createUserNotification({
        id: row.id,
        projectId: row.projectId,
        recipientUserId: row.recipientUserId,
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
