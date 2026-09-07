import type { Notification } from './api'

export function notificationContent(
    notification: Pick<Notification, 'title' | 'body'>
): Pick<Notification, 'title' | 'body'> {
    return {
        title: notification.title,
        body: notification.body,
    }
}
