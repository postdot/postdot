import { Type, type Static } from 'typebox'

export const notificationKindSchema = Type.Union([
    Type.Literal('publication_published'),
    Type.Literal('publication_failed'),
    Type.Literal('publication_ambiguous'),
])

export const notificationSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    projectId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    sourceEventId: Type.String({ minLength: 1 }),
    kind: notificationKindSchema,
    severity: Type.Union([Type.Literal('success'), Type.Literal('warning'), Type.Literal('error')]),
    subject: Type.Object({
        type: Type.String({ minLength: 1 }),
        id: Type.String({ minLength: 1 }),
    }),
    title: Type.String({ minLength: 1 }),
    body: Type.String({ minLength: 1 }),
    readAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    archivedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
})

export const notificationInboxSchema = Type.Object({
    notifications: Type.Array(notificationSchema),
    unreadCount: Type.Integer({ minimum: 0 }),
    totalUnreadCount: Type.Integer({ minimum: 0 }),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

export const notificationInboxQuery = Type.Object({
    projectId: Type.Optional(Type.String({ minLength: 1 })),
    before: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    view: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('all')])),
})

export const notificationPreferenceSchema = Type.Object({
    kind: notificationKindSchema,
    inAppEnabled: Type.Boolean(),
})

export const updateNotificationPreferenceBody = Type.Object({
    inAppEnabled: Type.Boolean(),
})

export const notificationParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    notificationId: Type.String({ minLength: 1 }),
})

export const userNotificationParams = Type.Object({
    notificationId: Type.String({ minLength: 1 }),
})

export const notificationPreferenceParams = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    kind: notificationKindSchema,
})

export const userNotificationPreferenceParams = Type.Object({
    kind: notificationKindSchema,
})

export type NotificationResponse = Static<typeof notificationSchema>
export type NotificationInboxResponse = Static<typeof notificationInboxSchema>
export type NotificationPreferenceResponse = Static<typeof notificationPreferenceSchema>

export const emailAlertPreferenceSchema = Type.Object({
    lastDeliveryState: Type.Union([
        Type.Literal('pending'),
        Type.Literal('running'),
        Type.Literal('delivered'),
        Type.Literal('failed'),
        Type.Literal('ambiguous'),
        Type.Null(),
    ]),
    enabled: Type.Boolean(),
    available: Type.Boolean(),
    email: Type.Union([Type.String(), Type.Null()]),
    verified: Type.Boolean(),
})
export type EmailAlertPreferenceResponse = Static<typeof emailAlertPreferenceSchema>
