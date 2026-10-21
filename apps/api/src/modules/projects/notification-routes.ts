import type { UserNotification } from '@postdot/core'
import type { NotificationStore, NotificationEmailStore } from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity } from '../../plugins/auth'
import { errorResponse, projectParams } from './models'
import {
    emailAlertPreferenceSchema,
    notificationInboxSchema,
    notificationInboxQuery,
    notificationParams,
    notificationPreferenceParams,
    notificationPreferenceSchema,
    notificationSchema,
    userNotificationParams,
    userNotificationPreferenceParams,
    updateNotificationPreferenceBody,
} from './notification-models'
import type { AuthenticatedElysia } from './types'

const humanOnlyResponse = {
    error: {
        code: 'forbidden',
        message: 'Human authentication is required to manage notifications',
    },
} as const
const notFoundResponse = {
    error: { code: 'not_found', message: 'Project or notification not found' },
} as const
const globalNotFoundResponse = {
    error: { code: 'not_found', message: 'Notification not found' },
} as const

export function registerNotificationRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    notifications: NotificationStore,
    emailAlerts?: { store: NotificationEmailStore; available: boolean | (() => boolean) }
) {
    const available = () =>
        typeof emailAlerts?.available === 'function'
            ? emailAlerts.available()
            : (emailAlerts?.available ?? false)
    return app
        .get(
            '/api/projects/:projectId/email-alerts',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: emailAlertPreferenceSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'getProjectEmailAlerts',
                    summary: 'Read personal project email alerts',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, user, status }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const preference = emailAlerts?.store.preferences(params.projectId, user.id)
                if (emailAlerts && preference === null) return status(404, notFoundResponse)
                return {
                    ...(preference ?? {
                        enabled: false,
                        email: null,
                        verified: false,
                        lastDeliveryState: null,
                    }),
                    available: available(),
                }
            }
        )
        .patch(
            '/api/projects/:projectId/email-alerts',
            {
                auth: true,
                params: projectParams,
                body: Type.Object({ enabled: Type.Boolean() }),
                response: {
                    200: emailAlertPreferenceSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'setProjectEmailAlerts',
                    summary: 'Enable or disable personal project email alerts',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, user, body, status }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                if (!emailAlerts || (body.enabled && !available()))
                    return status(400, {
                        error: {
                            code: 'invalid_input',
                            message: 'Email delivery is not configured',
                        },
                    })
                const current = emailAlerts.store.preferences(params.projectId, user.id)
                if (current === null) return status(404, notFoundResponse)
                if (body.enabled && !current.verified)
                    return status(400, {
                        error: {
                            code: 'invalid_input',
                            message: 'A verified account email is required',
                        },
                    })
                const preference = emailAlerts.store.setEnabled(
                    params.projectId,
                    user.id,
                    body.enabled
                )!
                return { ...preference, available: available() }
            }
        )
        .get(
            '/api/notifications',
            {
                auth: true,
                query: notificationInboxQuery,
                response: {
                    200: notificationInboxSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listUserNotifications',
                    summary: 'List the signed-in user notification inbox',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, query, user, status }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const projectId = query.projectId ?? null
                const page = notifications.listForUser({
                    userId: user.id,
                    projectId,
                    before: query.before,
                    limit: query.limit,
                    includeArchived: query.view === 'all',
                })
                return {
                    notifications: page.items.map(toNotificationResponse),
                    unreadCount: notifications.countUnreadForUser(user.id, projectId),
                    totalUnreadCount: notifications.countUnreadForUser(user.id),
                    nextCursor: page.nextCursor,
                }
            }
        )
        .post(
            '/api/notifications/:notificationId/read',
            {
                auth: true,
                params: userNotificationParams,
                response: {
                    200: notificationSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'markUserNotificationRead',
                    summary: 'Mark a user notification as read',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const notification = notifications.markReadForUser(params.notificationId, user.id)
                return notification === null
                    ? status(404, globalNotFoundResponse)
                    : toNotificationResponse(notification)
            }
        )
        .post(
            '/api/notifications/:notificationId/archive',
            {
                auth: true,
                params: userNotificationParams,
                response: {
                    200: notificationSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'archiveUserNotification',
                    summary: 'Archive a user notification',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const notification = notifications.archiveForUser(params.notificationId, user.id)
                return notification === null
                    ? status(404, globalNotFoundResponse)
                    : toNotificationResponse(notification)
            }
        )
        .get(
            '/api/notification-preferences',
            {
                auth: true,
                response: {
                    200: Type.Object({ preferences: Type.Array(notificationPreferenceSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listUserNotificationPreferences',
                    summary: 'List signed-in user notification preferences',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                return { preferences: [...notifications.listUserPreferences(user.id)] }
            }
        )
        .patch(
            '/api/notification-preferences/:kind',
            {
                auth: true,
                body: updateNotificationPreferenceBody,
                params: userNotificationPreferenceParams,
                response: {
                    200: notificationPreferenceSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'updateUserNotificationPreference',
                    summary: 'Update one signed-in user notification preference',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                return notifications.updateUserPreference({
                    userId: user.id,
                    kind: params.kind,
                    inAppEnabled: body.inAppEnabled,
                })
            }
        )
        .get(
            '/api/projects/:projectId/notifications',
            {
                auth: true,
                params: projectParams,
                query: notificationInboxQuery,
                response: {
                    200: notificationInboxSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectNotifications',
                    summary: 'List the current human notification inbox',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, query, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const page = notifications.list({
                    projectId: params.projectId,
                    subjectId: user.id,
                    before: query.before,
                    limit: query.limit,
                    includeArchived: query.view === 'all',
                })
                const unreadCount = notifications.countUnread(params.projectId, user.id)
                if (page === null || unreadCount === null) return status(404, notFoundResponse)
                return {
                    notifications: page.items.map(toNotificationResponse),
                    unreadCount,
                    totalUnreadCount: notifications.countUnreadForUser(user.id),
                    nextCursor: page.nextCursor,
                }
            }
        )
        .post(
            '/api/projects/:projectId/notifications/:notificationId/read',
            {
                auth: true,
                params: notificationParams,
                response: {
                    200: notificationSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'markProjectNotificationRead',
                    summary: 'Mark a notification as read',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const notification = notifications.markRead(
                    params.projectId,
                    params.notificationId,
                    user.id
                )
                return notification === null
                    ? status(404, notFoundResponse)
                    : toNotificationResponse(notification)
            }
        )
        .post(
            '/api/projects/:projectId/notifications/:notificationId/archive',
            {
                auth: true,
                params: notificationParams,
                response: {
                    200: notificationSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'archiveProjectNotification',
                    summary: 'Archive a notification',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const notification = notifications.archive(
                    params.projectId,
                    params.notificationId,
                    user.id
                )
                return notification === null
                    ? status(404, notFoundResponse)
                    : toNotificationResponse(notification)
            }
        )
        .get(
            '/api/projects/:projectId/notification-preferences',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: Type.Object({ preferences: Type.Array(notificationPreferenceSchema) }),
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectNotificationPreferences',
                    summary: 'List the current human notification preferences',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const preferences = notifications.listPreferences(params.projectId, user.id)
                return preferences === null
                    ? status(404, notFoundResponse)
                    : { preferences: [...preferences] }
            }
        )
        .patch(
            '/api/projects/:projectId/notification-preferences/:kind',
            {
                auth: true,
                body: updateNotificationPreferenceBody,
                params: notificationPreferenceParams,
                response: {
                    200: notificationPreferenceSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'updateProjectNotificationPreference',
                    summary: 'Update one notification preference',
                    tags: ['Notifications'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') return status(403, humanOnlyResponse)
                const preference = notifications.updatePreference({
                    projectId: params.projectId,
                    subjectId: user.id,
                    kind: params.kind,
                    inAppEnabled: body.inAppEnabled,
                })
                return preference === null ? status(404, notFoundResponse) : preference
            }
        )
}

function toNotificationResponse(notification: UserNotification) {
    const {
        recipientActorId: _recipientActorId,
        recipientUserId: _recipientUserId,
        ...response
    } = notification
    return response
}
