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
import { Field, FieldContent, FieldDescription, FieldTitle } from '@herald/ui/components/field'
import { ScrollArea } from '@herald/ui/components/scroll-area'
import { Switch } from '@herald/ui/components/switch'
import { ArchiveIcon } from '@solar-icons/react/bold/archive'
import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { BellIcon } from '@solar-icons/react/bold/bell'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { SettingsIcon } from '@solar-icons/react/bold/settings'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
    api,
    formatApiError,
    type Notification,
    type NotificationInbox as NotificationInboxState,
    type NotificationPreference,
} from '@/lib/api'

interface NotificationInboxProps {
    readonly projectId: string | null
}

type NotificationPanel = 'inbox' | 'preferences'

const preferenceCopy: Record<
    NotificationPreference['kind'],
    { readonly label: string; readonly description: string }
> = {
    publication_published: {
        label: 'Successful publications',
        description: 'Show a confirmation when Herald delivers a publication.',
    },
    publication_failed: {
        label: 'Failed publications',
        description: 'Show publications that could not be delivered and need attention.',
    },
    publication_ambiguous: {
        label: 'Uncertain outcomes',
        description: 'Show publications whose remote outcome needs reconciliation.',
    },
}

export function NotificationInbox({ projectId }: NotificationInboxProps) {
    const [open, setOpen] = useState(false)
    const [inbox, setInbox] = useState<NotificationInboxState | null>(null)
    const [panel, setPanel] = useState<NotificationPanel>('inbox')
    const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [preferencesLoading, setPreferencesLoading] = useState(false)
    const [workingId, setWorkingId] = useState<string | null>(null)
    const [workingPreferenceKind, setWorkingPreferenceKind] = useState<
        NotificationPreference['kind'] | null
    >(null)
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

    const loadPreferences = useCallback(async () => {
        if (projectId === null) return

        const version = ++requestVersion.current
        setPreferencesLoading(true)
        setError(null)
        try {
            const response = await api.listNotificationPreferences(projectId)
            if (version !== requestVersion.current) return
            setPreferences(response.preferences)
        } catch (caughtError) {
            if (version !== requestVersion.current) return
            setError(formatApiError(caughtError))
        } finally {
            if (version === requestVersion.current) setPreferencesLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        requestVersion.current += 1
        setInbox(null)
        setPanel('inbox')
        setPreferences(null)
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

    const updatePreference = async (preference: NotificationPreference, inAppEnabled: boolean) => {
        if (projectId === null || preference.inAppEnabled === inAppEnabled) return

        const version = requestVersion.current
        setWorkingPreferenceKind(preference.kind)
        setError(null)
        try {
            const updated = await api.updateNotificationPreference(
                projectId,
                preference.kind,
                inAppEnabled
            )
            if (version !== requestVersion.current) return
            setPreferences(
                current =>
                    current?.map(item => (item.kind === updated.kind ? updated : item)) ?? null
            )
        } catch (caughtError) {
            if (version !== requestVersion.current) return
            setError(formatApiError(caughtError))
        } finally {
            if (version === requestVersion.current) setWorkingPreferenceKind(null)
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
                    setPanel('inbox')
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
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <DialogTitle>
                                        {panel === 'inbox'
                                            ? 'Notifications'
                                            : 'Notification preferences'}
                                    </DialogTitle>
                                    {panel === 'inbox' && unreadCount > 0 ? (
                                        <Badge variant="secondary">{unreadCount} unread</Badge>
                                    ) : null}
                                </div>
                                <DialogDescription className="mt-1">
                                    {panel === 'inbox'
                                        ? 'Publication outcomes and project activity.'
                                        : 'Choose which publication outcomes appear in this inbox.'}
                                </DialogDescription>
                            </div>
                            <Button
                                aria-label={
                                    panel === 'inbox'
                                        ? 'Open notification preferences'
                                        : 'Back to notifications'
                                }
                                className="shrink-0"
                                size="icon-sm"
                                title={
                                    panel === 'inbox'
                                        ? 'Notification preferences'
                                        : 'Back to notifications'
                                }
                                variant="ghost"
                                onClick={() => {
                                    if (panel === 'inbox') {
                                        setPanel('preferences')
                                        void loadPreferences()
                                    } else {
                                        setPanel('inbox')
                                        void loadInbox()
                                    }
                                }}>
                                {panel === 'inbox' ? (
                                    <SettingsIcon aria-hidden="true" />
                                ) : (
                                    <ArrowLeftIcon aria-hidden="true" />
                                )}
                            </Button>
                        </div>
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

                    {panel === 'inbox' ? (
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
                                            Publication outcomes and other project activity will
                                            appear here.
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
                    ) : (
                        <NotificationPreferencesPanel
                            loading={preferencesLoading}
                            preferences={preferences}
                            workingKind={workingPreferenceKind}
                            onChange={updatePreference}
                        />
                    )}
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

function NotificationPreferencesPanel({
    loading,
    onChange,
    preferences,
    workingKind,
}: {
    readonly loading: boolean
    readonly onChange: (preference: NotificationPreference, inAppEnabled: boolean) => Promise<void>
    readonly preferences: readonly NotificationPreference[] | null
    readonly workingKind: NotificationPreference['kind'] | null
}) {
    if (loading && preferences === null) {
        return (
            <div
                className="grid gap-2 px-5 pb-5"
                aria-label="Loading notification preferences"
                role="status">
                {[0, 1, 2].map(item => (
                    <div className="h-[4.75rem] animate-pulse rounded-md bg-muted" key={item} />
                ))}
                <span className="sr-only">Loading notification preferences</span>
            </div>
        )
    }

    if (preferences === null) return null

    return (
        <div
            className="grid gap-2 px-5 pb-5"
            data-notification-preferences="true"
            role="group"
            aria-label="Notification preferences">
            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                Disabled categories stay out of the inbox for future events. Existing notifications
                are preserved.
            </p>
            {preferences.map(preference => {
                const copy = preferenceCopy[preference.kind]
                return (
                    <Field
                        className="rounded-md bg-surface-raised px-3.5 py-3 shadow-field"
                        key={preference.kind}
                        orientation="horizontal">
                        <FieldContent>
                            <FieldTitle>{copy.label}</FieldTitle>
                            <FieldDescription>{copy.description}</FieldDescription>
                        </FieldContent>
                        <Switch
                            aria-label={`${copy.label}: ${preference.inAppEnabled ? 'enabled' : 'disabled'}`}
                            checked={preference.inAppEnabled}
                            disabled={workingKind === preference.kind}
                            onCheckedChange={checked => void onChange(preference, checked)}
                        />
                    </Field>
                )
            })}
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
