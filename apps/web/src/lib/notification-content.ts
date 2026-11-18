import * as m from '@/paraglide/messages.js'
import type { Locale } from '@/paraglide/runtime.js'

import type { Notification } from './api'

interface NotificationCopy {
    readonly title: string
}

// Match the complete owned template: kind alone cannot distinguish reconciliation
// or justify replacing custom copy. Stored notification data remains unchanged.
const templates = [
    {
        kind: 'publication_published',
        title: 'Publication delivered',
        body: 'Postdot confirmed that the publication was delivered.',
        titleMessage: m.notification_delivered_title,
    },
    {
        kind: 'publication_failed',
        title: 'Publication failed',
        body: 'The publication could not be delivered and needs attention.',
        titleMessage: m.notification_failed_title,
    },
    {
        kind: 'publication_ambiguous',
        title: 'Publication outcome unknown',
        body: 'Postdot could not confirm whether the publication was delivered.',
        titleMessage: m.notification_uncertain_title,
    },
    {
        kind: 'publication_published',
        title: 'Publication reconciled as delivered',
        body: 'A previously uncertain publication was confirmed as delivered.',
        titleMessage: m.notification_reconciled_delivered_title,
    },
    {
        kind: 'publication_failed',
        title: 'Publication reconciled as failed',
        body: 'A previously uncertain publication was confirmed as failed.',
        titleMessage: m.notification_reconciled_failed_title,
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
        return { title: notification.title }
    }
    return {
        title: template.titleMessage({}, { locale }),
    }
}

export function notificationOutcome(notification: Pick<Notification, 'kind' | 'title' | 'body'>) {
    const template = templates.find(
        item =>
            item.kind === notification.kind &&
            item.title === notification.title &&
            item.body === notification.body
    )
    if (template === templates[3]) return 'confirmedPublished'
    if (template === templates[4]) return 'confirmedFailed'
    if (notification.kind === 'publication_failed') return 'failed'
    if (notification.kind === 'publication_ambiguous') return 'ambiguous'
    return 'published'
}

export function notificationChannelSummary(names: readonly string[], locale: Locale) {
    const parts = names.slice(0, 2)
    if (names.length > 2)
        parts.push(m.notifications_more_channels({ count: names.length - 2 }, { locale }))
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
}

export function notificationOutcomeCopy(
    notification: Notification,
    channels: string,
    locale: Locale
) {
    const messages = {
        published: m.notifications_published_on,
        failed: m.notifications_failed_on,
        ambiguous: m.notifications_ambiguous_on,
        confirmedPublished: m.notifications_confirmed_published_on,
        confirmedFailed: m.notifications_confirmed_failed_on,
    }
    return messages[notificationOutcome(notification)]({ channels }, { locale })
}
