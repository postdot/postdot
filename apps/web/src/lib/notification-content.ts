import * as m from '@/paraglide/messages.js'
import type { Locale } from '@/paraglide/runtime.js'

import type { Notification } from './api'

interface NotificationCopy {
    readonly title: string
    readonly body: string | null
}

// Match the complete owned template: kind alone cannot distinguish reconciliation
// or justify replacing custom copy. Stored notification data remains unchanged.
const templates = [
    {
        kind: 'publication_published',
        title: 'Publication delivered',
        body: 'Herald confirmed that the publication was delivered.',
        titleMessage: m.notification_delivered_title,
        bodyMessage: null,
    },
    {
        kind: 'publication_failed',
        title: 'Publication failed',
        body: 'The publication could not be delivered and needs attention.',
        titleMessage: m.notification_failed_title,
        bodyMessage: m.notification_failed_body,
    },
    {
        kind: 'publication_ambiguous',
        title: 'Publication outcome unknown',
        body: 'Herald could not confirm whether the publication was delivered.',
        titleMessage: m.notification_uncertain_title,
        bodyMessage: m.notification_uncertain_body,
    },
    {
        kind: 'publication_published',
        title: 'Publication reconciled as delivered',
        body: 'A previously uncertain publication was confirmed as delivered.',
        titleMessage: m.notification_reconciled_delivered_title,
        bodyMessage: m.notification_reconciled_body,
    },
    {
        kind: 'publication_failed',
        title: 'Publication reconciled as failed',
        body: 'A previously uncertain publication was confirmed as failed.',
        titleMessage: m.notification_reconciled_failed_title,
        bodyMessage: m.notification_reconciled_body,
    },
] as const

export function notificationContent(
    notification: Pick<Notification, 'kind' | 'title' | 'body'>,
    locale: Locale
): NotificationCopy {
    const template = templates.find(
        item =>
            item.kind === notification.kind &&
            item.title === notification.title &&
            item.body === notification.body
    )
    if (template === undefined) {
        return { title: notification.title, body: notification.body }
    }
    return {
        title: template.titleMessage({}, { locale }),
        body: template.bodyMessage?.({}, { locale }) ?? null,
    }
}
