import type { DomainEvent } from './domain-event'
import { DomainInvariantError, requireNonBlank, requireTimestamp } from './invariants'

export const notificationKinds = [
    'publication_published',
    'publication_failed',
    'publication_ambiguous',
] as const
export type NotificationKind = (typeof notificationKinds)[number]

export const notificationSeverities = ['success', 'warning', 'error'] as const
export type NotificationSeverity = (typeof notificationSeverities)[number]

export interface ProjectNotification {
    readonly id: string
    readonly projectId: string
    readonly recipientActorId: string
    readonly sourceEventId: string
    readonly kind: NotificationKind
    readonly severity: NotificationSeverity
    readonly subject: { readonly type: string; readonly id: string }
    readonly title: string
    readonly body: string
    readonly readAt: number | null
    readonly archivedAt: number | null
    readonly createdAt: number
}

/**
 * A notification shown in the signed-in user's inbox.
 *
 * Publication outcomes currently carry a project, while the nullable project
 * scope leaves room for instance/user notifications that do not belong to one
 * project.
 */
export interface UserNotification {
    readonly id: string
    readonly projectId: string | null
    readonly recipientUserId: string
    readonly recipientActorId: string | null
    readonly sourceEventId: string
    readonly kind: NotificationKind
    readonly severity: NotificationSeverity
    readonly subject: { readonly type: string; readonly id: string }
    readonly title: string
    readonly body: string
    readonly readAt: number | null
    readonly archivedAt: number | null
    readonly createdAt: number
}

export type CreateProjectNotificationInput = Omit<ProjectNotification, 'readAt' | 'archivedAt'> & {
    readonly readAt?: number | null
    readonly archivedAt?: number | null
}

export type CreateUserNotificationInput = Omit<UserNotification, 'readAt' | 'archivedAt'> & {
    readonly readAt?: number | null
    readonly archivedAt?: number | null
}

export interface ProjectNotificationTemplate {
    readonly kind: NotificationKind
    readonly severity: NotificationSeverity
    readonly title: string
    readonly body: string
}

export function createProjectNotification(
    input: CreateProjectNotificationInput
): ProjectNotification {
    if (!notificationKinds.includes(input.kind)) {
        throw new DomainInvariantError('invalid_input', 'notification kind is invalid')
    }
    if (!notificationSeverities.includes(input.severity)) {
        throw new DomainInvariantError('invalid_input', 'notification severity is invalid')
    }

    const createdAt = requireTimestamp(input.createdAt, 'notification createdAt')
    const readAt = requireOptionalLifecycleTimestamp(input.readAt, createdAt, 'readAt')
    const archivedAt = requireOptionalLifecycleTimestamp(input.archivedAt, createdAt, 'archivedAt')

    return {
        id: requireNonBlank(input.id, 'notification id'),
        projectId: requireNonBlank(input.projectId, 'notification projectId'),
        recipientActorId: requireNonBlank(input.recipientActorId, 'notification recipientActorId'),
        sourceEventId: requireNonBlank(input.sourceEventId, 'notification sourceEventId'),
        kind: input.kind,
        severity: input.severity,
        subject: {
            type: requireNonBlank(input.subject.type, 'notification subject type'),
            id: requireNonBlank(input.subject.id, 'notification subject id'),
        },
        title: requireNonBlank(input.title, 'notification title'),
        body: requireNonBlank(input.body, 'notification body'),
        readAt,
        archivedAt,
        createdAt,
    }
}

export function createUserNotification(input: CreateUserNotificationInput): UserNotification {
    if (!notificationKinds.includes(input.kind)) {
        throw new DomainInvariantError('invalid_input', 'notification kind is invalid')
    }
    if (!notificationSeverities.includes(input.severity)) {
        throw new DomainInvariantError('invalid_input', 'notification severity is invalid')
    }

    const createdAt = requireTimestamp(input.createdAt, 'notification createdAt')
    const readAt = requireOptionalLifecycleTimestamp(input.readAt, createdAt, 'readAt')
    const archivedAt = requireOptionalLifecycleTimestamp(input.archivedAt, createdAt, 'archivedAt')

    return {
        id: requireNonBlank(input.id, 'notification id'),
        projectId:
            input.projectId === null
                ? null
                : requireNonBlank(input.projectId, 'notification projectId'),
        recipientUserId: requireNonBlank(input.recipientUserId, 'notification recipient user id'),
        recipientActorId:
            input.recipientActorId === null
                ? null
                : requireNonBlank(input.recipientActorId, 'notification recipient actor id'),
        sourceEventId: requireNonBlank(input.sourceEventId, 'notification source event id'),
        kind: input.kind,
        severity: input.severity,
        subject: {
            type: requireNonBlank(input.subject.type, 'notification subject type'),
            id: requireNonBlank(input.subject.id, 'notification subject id'),
        },
        title: requireNonBlank(input.title, 'notification title'),
        body: requireNonBlank(input.body, 'notification body'),
        readAt,
        archivedAt,
        createdAt,
    }
}

export function projectNotificationTemplate(
    event: DomainEvent
): ProjectNotificationTemplate | null {
    if (event.version !== 1 || event.subject.type !== 'publication') return null

    switch (event.name) {
        case 'publication.execution.succeeded':
        case 'publication.published':
            return {
                kind: 'publication_published',
                severity: 'success',
                title: 'Publication delivered',
                body: 'Herald confirmed that the publication was delivered.',
            }
        case 'publication.execution.failed':
            return {
                kind: 'publication_failed',
                severity: 'error',
                title: 'Publication failed',
                body: 'The publication could not be delivered and needs attention.',
            }
        case 'publication.execution.ambiguous':
            return {
                kind: 'publication_ambiguous',
                severity: 'warning',
                title: 'Publication outcome unknown',
                body: 'Herald could not confirm whether the publication was delivered.',
            }
        case 'publication.reconciled':
            return projectReconciliationTemplate(event.payload.toState)
        default:
            return null
    }
}

function projectReconciliationTemplate(toState: unknown): ProjectNotificationTemplate | null {
    if (toState === 'published') {
        return {
            kind: 'publication_published',
            severity: 'success',
            title: 'Publication reconciled as delivered',
            body: 'A previously uncertain publication was confirmed as delivered.',
        }
    }
    if (toState === 'failed') {
        return {
            kind: 'publication_failed',
            severity: 'error',
            title: 'Publication reconciled as failed',
            body: 'A previously uncertain publication was confirmed as failed.',
        }
    }
    return null
}

function requireOptionalLifecycleTimestamp(
    value: number | null | undefined,
    createdAt: number,
    field: string
): number | null {
    if (value === null || value === undefined) return null
    const timestamp = requireTimestamp(value, `notification ${field}`)
    if (timestamp < createdAt) {
        throw new DomainInvariantError(
            'invalid_time',
            `notification ${field} must not precede creation`
        )
    }
    return timestamp
}
