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
import { formatDateTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { notificationContent } from '@/lib/notification-content'
import * as m from '@/paraglide/messages.js'

interface NotificationInboxProps {
    readonly projectId: string | null
}

type NotificationPanel = 'inbox' | 'preferences'

export function NotificationInbox({ projectId }: NotificationInboxProps) {
    const { locale } = useLanguage()
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
                        ? m.notifications_open()
                        : m.notifications_open_unread({ count: unreadCount })
                }
                className="relative"
                disabled={projectId === null}
                size="icon-sm"
                title={m.notifications_title()}
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
                                            ? m.notifications_title()
                                            : m.notifications_preferences()}
                                    </DialogTitle>
                                    {panel === 'inbox' && unreadCount > 0 ? (
                                        <Badge variant="secondary">
                                            {m.notifications_unread({ count: unreadCount })}
                                        </Badge>
                                    ) : null}
                                </div>
                                <DialogDescription className="mt-1">
                                    {panel === 'inbox'
                                        ? m.notifications_dialog_description()
                                        : m.notifications_preferences_description()}
                                </DialogDescription>
                            </div>
                            <Button
                                aria-label={
                                    panel === 'inbox'
                                        ? m.notifications_preferences_open()
                                        : m.notifications_back()
                                }
                                className="shrink-0"
                                size="icon-sm"
                                title={
                                    panel === 'inbox'
                                        ? m.notifications_preferences()
                                        : m.notifications_back()
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
                                {m.common_try_again()}
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
                                        <EmptyTitle>{m.notifications_empty()}</EmptyTitle>
                                        <EmptyDescription>
                                            {m.notifications_empty_description()}
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
                                            locale={locale}
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
    locale,
    notification,
    onArchive,
    onMarkRead,
}: {
    readonly disabled: boolean
    readonly notification: Notification
    readonly locale: string
    readonly onArchive: (notification: Notification) => Promise<void>
    readonly onMarkRead: (notification: Notification) => Promise<void>
}) {
    const unread = notification.readAt === null
    const copy = notificationContent(notification)

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
                                {copy.title}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {copy.body}
                            </p>
                        </div>
                        <time
                            className="shrink-0 text-[0.68rem] leading-4 text-muted-foreground"
                            dateTime={new Date(notification.createdAt).toISOString()}>
                            {formatNotificationTime(notification.createdAt, locale)}
                        </time>
                    </div>

                    <div className="mt-2 flex items-center gap-1">
                        {unread ? (
                            <Button
                                aria-label={m.notifications_mark_as_read({ title: copy.title })}
                                disabled={disabled}
                                size="icon-xs"
                                title={m.notifications_read_short()}
                                variant="ghost"
                                onClick={() => void onMarkRead(notification)}>
                                <CheckReadIcon aria-hidden="true" />
                                <span className="sr-only">{m.notifications_read_short()}</span>
                            </Button>
                        ) : null}
                        <Button
                            aria-label={m.notifications_archive_item({ title: copy.title })}
                            disabled={disabled}
                            size="icon-xs"
                            title={m.notifications_archive_short()}
                            variant="ghost"
                            onClick={() => void onArchive(notification)}>
                            <ArchiveIcon aria-hidden="true" />
                            <span className="sr-only">{m.notifications_archive_short()}</span>
                        </Button>
                    </div>
                </div>
            </div>
        </article>
    )
}

function NotificationLoadingState() {
    return (
        <div className="grid gap-2" aria-label={m.notifications_loading()} role="status">
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
            <span className="sr-only">{m.notifications_loading()}</span>
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
                aria-label={m.notifications_loading_preferences()}
                role="status">
                {[0, 1, 2].map(item => (
                    <div className="h-[4.75rem] animate-pulse rounded-md bg-muted" key={item} />
                ))}
                <span className="sr-only">{m.notifications_loading_preferences()}</span>
            </div>
        )
    }

    if (preferences === null) return null

    return (
        <div
            className="grid gap-2 px-5 pb-5"
            data-notification-preferences="true"
            role="group"
            aria-label={m.notifications_preferences_label()}>
            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                {m.notifications_disabled_preserved()}
            </p>
            {preferences.map(preference => {
                const copy = preferenceCopy(preference.kind)
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
                            aria-label={`${copy.label}: ${preference.inAppEnabled ? m.notification_enabled() : m.notification_disabled()}`}
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

function formatNotificationTime(timestamp: number, locale: string) {
    return formatDateTime(timestamp, 'UTC', locale)
}

function preferenceCopy(kind: NotificationPreference['kind']) {
    if (kind === 'publication_published') {
        return {
            label: m.notification_published_preference(),
            description: m.notification_published_preference_description(),
        }
    }
    if (kind === 'publication_failed') {
        return {
            label: m.notification_failed_preference(),
            description: m.notification_failed_preference_description(),
        }
    }
    return {
        label: m.notification_ambiguous_preference(),
        description: m.notification_ambiguous_preference_description(),
    }
}
