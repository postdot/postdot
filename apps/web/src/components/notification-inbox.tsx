import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { ScrollArea } from '@herald/ui/components/scroll-area'
import { ArchiveIcon } from '@solar-icons/react/bold/archive'
import { BellIcon } from '@solar-icons/react/bold/bell'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
    api,
    formatApiError,
    type Notification,
    type NotificationInbox as NotificationInboxState,
} from '@/lib/api'

interface NotificationInboxProps {
    readonly projectId: string | null
}

export function NotificationInbox({ projectId }: NotificationInboxProps) {
    const [open, setOpen] = useState(false)
    const [inbox, setInbox] = useState<NotificationInboxState | null>(null)
    const [loading, setLoading] = useState(false)
    const [workingId, setWorkingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const requestVersion = useRef(0)

    const loadInbox = useCallback(async () => {
        if (projectId === null) return

        const version = ++requestVersion.current
        setLoading(true)
        setError(null)
        try {
            const nextInbox = await api.listNotifications(projectId, { limit: 25 })
            if (version !== requestVersion.current) return
            setInbox(nextInbox)
        } catch (caughtError) {
            if (version !== requestVersion.current) return
            setError(formatApiError(caughtError))
        } finally {
            if (version === requestVersion.current) setLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        requestVersion.current += 1
        setInbox(null)
        setError(null)
        void loadInbox()
    }, [loadInbox])

    const markRead = async (notification: Notification) => {
        if (projectId === null || notification.readAt !== null) return

        const version = requestVersion.current
        setWorkingId(notification.id)
        setError(null)
        try {
            const updated = await api.markNotificationRead(projectId, notification.id)
            if (version !== requestVersion.current) return
            setInbox(current =>
                current === null
                    ? current
                    : {
                          ...current,
                          notifications: current.notifications.map(item =>
                              item.id === updated.id ? updated : item
                          ),
                          unreadCount: Math.max(0, current.unreadCount - 1),
                      }
            )
        } catch (caughtError) {
            if (version !== requestVersion.current) return
            setError(formatApiError(caughtError))
        } finally {
            if (version === requestVersion.current) setWorkingId(null)
        }
    }

    const archive = async (notification: Notification) => {
        if (projectId === null) return

        const version = requestVersion.current
        setWorkingId(notification.id)
        setError(null)
        try {
            await api.archiveNotification(projectId, notification.id)
            if (version !== requestVersion.current) return
            setInbox(current =>
                current === null
                    ? current
                    : {
                          ...current,
                          notifications: current.notifications.filter(
                              item => item.id !== notification.id
                          ),
                          unreadCount:
                              notification.readAt === null
                                  ? Math.max(0, current.unreadCount - 1)
                                  : current.unreadCount,
                      }
            )
        } catch (caughtError) {
            if (version !== requestVersion.current) return
            setError(formatApiError(caughtError))
        } finally {
            if (version === requestVersion.current) setWorkingId(null)
        }
    }

    const unreadCount = inbox?.unreadCount ?? 0
    const notifications = inbox?.notifications ?? []

    return (
        <>
            <Button
                aria-label={
                    unreadCount === 0
                        ? 'Open notifications'
                        : `Open notifications, ${unreadCount} unread`
                }
                className="relative"
                disabled={projectId === null}
                size="icon-sm"
                title="Notifications"
                variant="ghost"
                onClick={() => {
                    setOpen(true)
                    void loadInbox()
                }}>
                <BellIcon aria-hidden="true" />
                {unreadCount > 0 ? (
                    <span className="absolute top-0.5 right-0.5 flex min-w-3.5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] leading-3.5 font-semibold text-primary-foreground tabular-nums">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                ) : null}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
                    <DialogHeader className="gap-1 px-5 pt-5 pb-4 pr-12">
                        <div className="flex items-center gap-2">
                            <DialogTitle>Notifications</DialogTitle>
                            {unreadCount > 0 ? (
                                <Badge variant="secondary">{unreadCount} unread</Badge>
                            ) : null}
                        </div>
                        <DialogDescription>
                            Project activity that needs your attention.
                        </DialogDescription>
                    </DialogHeader>

                    {error !== null ? (
                        <div
                            className="mx-5 mb-4 flex items-center justify-between gap-3 rounded-md bg-state-failed/10 px-3 py-2.5 text-sm text-state-failed"
                            role="alert">
                            <span>{error}</span>
                            <Button
                                className="shrink-0"
                                disabled={loading}
                                size="sm"
                                variant="ghost"
                                onClick={() => void loadInbox()}>
                                Try again
                            </Button>
                        </div>
                    ) : null}

                    <ScrollArea className="max-h-[min(36rem,calc(100vh-12rem))] px-5 pb-5">
                        {loading && inbox === null ? (
                            <NotificationLoadingState />
                        ) : notifications.length === 0 ? (
                            <Empty className="min-h-48 bg-muted px-5 py-8">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <BellIcon aria-hidden="true" />
                                    </EmptyMedia>
                                    <EmptyTitle>No notifications</EmptyTitle>
                                    <EmptyDescription>
                                        Publication outcomes and other project activity will appear
                                        here.
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <div className="grid gap-2" role="list">
                                {notifications.map(notification => (
                                    <NotificationItem
                                        key={notification.id}
                                        disabled={workingId === notification.id}
                                        notification={notification}
                                        onArchive={archive}
                                        onMarkRead={markRead}
                                    />
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </>
    )
}

function NotificationItem({
    disabled,
    notification,
    onArchive,
    onMarkRead,
}: {
    readonly disabled: boolean
    readonly notification: Notification
    readonly onArchive: (notification: Notification) => Promise<void>
    readonly onMarkRead: (notification: Notification) => Promise<void>
}) {
    const unread = notification.readAt === null

    return (
        <article
            className={
                unread
                    ? 'rounded-md bg-surface-raised px-3.5 py-3 shadow-field'
                    : 'rounded-md bg-muted/60 px-3.5 py-3'
            }
            role="listitem">
            <div className="flex items-start gap-3">
                <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${severityClass(notification)}`}
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm leading-5 font-medium text-foreground">
                                {notification.title}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {notification.body}
                            </p>
                        </div>
                        <time
                            className="shrink-0 text-[0.68rem] leading-4 text-muted-foreground"
                            dateTime={new Date(notification.createdAt).toISOString()}>
                            {formatNotificationTime(notification.createdAt)}
                        </time>
                    </div>

                    <div className="mt-2 flex items-center gap-1">
                        {unread ? (
                            <Button
                                aria-label={`Mark ${notification.title} as read`}
                                disabled={disabled}
                                size="icon-xs"
                                title="Mark as read"
                                variant="ghost"
                                onClick={() => void onMarkRead(notification)}>
                                <CheckReadIcon aria-hidden="true" />
                                <span className="sr-only">Mark as read</span>
                            </Button>
                        ) : null}
                        <Button
                            aria-label={`Archive ${notification.title}`}
                            disabled={disabled}
                            size="icon-xs"
                            title="Archive"
                            variant="ghost"
                            onClick={() => void onArchive(notification)}>
                            <ArchiveIcon aria-hidden="true" />
                            <span className="sr-only">Archive</span>
                        </Button>
                    </div>
                </div>
            </div>
        </article>
    )
}

function NotificationLoadingState() {
    return (
        <div className="grid gap-2" aria-label="Loading notifications" role="status">
            {[0, 1, 2].map(item => (
                <div className="rounded-md bg-muted px-3.5 py-3" key={item}>
                    <div className="flex gap-3">
                        <div className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/25" />
                        <div className="grid flex-1 gap-2">
                            <div className="h-4 w-2/3 animate-pulse rounded bg-muted-foreground/15" />
                            <div className="h-3 w-full animate-pulse rounded bg-muted-foreground/10" />
                            <div className="h-3 w-1/3 animate-pulse rounded bg-muted-foreground/10" />
                        </div>
                    </div>
                </div>
            ))}
            <span className="sr-only">Loading notifications</span>
        </div>
    )
}

function severityClass(notification: Notification) {
    if (notification.severity === 'error') return 'bg-state-failed'
    if (notification.severity === 'warning') return 'bg-state-attention'
    return 'bg-state-published'
}

function formatNotificationTime(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(timestamp)
}
