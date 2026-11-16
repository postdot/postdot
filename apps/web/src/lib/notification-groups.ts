import type { Notification } from './api'
import { formatProjectDate, getZonedDateTimeParts } from './date-time'
import { notificationOutcome } from './notification-content'

export interface NotificationGroup {
    readonly notification: Notification
    readonly members: Notification[]
}

/** Anchor the window at the newest member, so a chain cannot span more than ten minutes. */
export function groupNotifications(notifications: readonly Notification[]): NotificationGroup[] {
    const groups: NotificationGroup[] = []
    for (const notification of [...notifications].sort((a, b) => b.createdAt - a.createdAt)) {
        const context = notification.context
        const group =
            context == null
                ? undefined
                : groups.find(
                      item =>
                          item.notification.context?.projectId === context.projectId &&
                          item.notification.context.postId === context.postId &&
                          item.notification.kind === notification.kind &&
                          item.notification.severity === notification.severity &&
                          notificationOutcome(item.notification) ===
                              notificationOutcome(notification) &&
                          item.notification.createdAt - notification.createdAt <= 10 * 60_000
                  )
        if (group) group.members.push(notification)
        else groups.push({ notification, members: [notification] })
    }
    return groups
}

export function notificationChannels(group: NotificationGroup) {
    return [
        ...new Map(
            group.members.flatMap(item =>
                item.context ? [[item.context.channel.id, item.context.channel] as const] : []
            )
        ).values(),
    ]
}

export function notificationSection(
    timestamp: number,
    timeZone: string,
    now = Date.now()
): 'today' | 'yesterday' | 'earlier' {
    const day = (value: number) => {
        const { year, month, day } = getZonedDateTimeParts(value, timeZone)
        return Date.UTC(year, month - 1, day)
    }
    const difference = day(now) - day(timestamp)
    return difference <= 0 ? 'today' : difference === 86_400_000 ? 'yesterday' : 'earlier'
}

export function notificationTime(
    timestamp: number,
    timeZone: string,
    locale: string,
    now = Date.now()
) {
    const seconds = Math.round((timestamp - now) / 1_000)
    if (now - timestamp > 7 * 86_400_000) return formatProjectDate(timestamp, timeZone, locale)
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
    if (Math.abs(seconds) < 3_600) return formatter.format(Math.round(seconds / 60), 'minute')
    if (Math.abs(seconds) < 86_400) return formatter.format(Math.round(seconds / 3_600), 'hour')
    return formatter.format(Math.round(seconds / 86_400), 'day')
}
