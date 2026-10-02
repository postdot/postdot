import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import { Field, FieldContent, FieldDescription, FieldTitle } from '@herald/ui/components/field'
import {
    Popover,
    PopoverClose,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
} from '@herald/ui/components/popover'
import { ScrollArea } from '@herald/ui/components/scroll-area'
import { Switch } from '@herald/ui/components/switch'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { ArrowLeftIcon } from '@solar-icons/react/linear/arrow-left'
import { BellIcon } from '@solar-icons/react/linear/bell'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import {
    api,
    ApiError,
    formatApiError,
    type Notification,
    type NotificationInbox as NotificationInboxState,
    type NotificationPreference,
    type Project,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { notificationContent } from '@/lib/notification-content'
import * as m from '@/paraglide/messages.js'
import type { Locale } from '@/paraglide/runtime.js'

interface NotificationInboxProps {
    readonly projectId: string | null
    readonly projects: readonly Project[]
}

type NotificationPanel = 'inbox' | 'preferences'

export function NotificationInbox({ projectId, projects }: NotificationInboxProps) {
    const { locale } = useLanguage()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const [openingId, setOpeningId] = useState<string | null>(null)
    const [subjectError, setSubjectError] = useState<{ id: string; message: string } | null>(null)
    const [open, setOpen] = useState(false)
    const [panel, setPanel] = useState<NotificationPanel>('inbox')
    const [workingId, setWorkingId] = useState<string | null>(null)
    const [workingPreferenceKind, setWorkingPreferenceKind] = useState<
        NotificationPreference['kind'] | null
    >(null)
    const [actionError, setActionError] = useState<string | null>(null)

    // The bell badge must be informed before the popover opens. The user
    // realtime bridge invalidates this active query when a notification lands.
    const inboxQuery = useQuery<NotificationInboxState>({
        queryKey: ['notifications', projectId ?? 'all'],
        queryFn: () => api.listUserNotifications(projectId, { limit: 25 }),
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })

    const preferencesQuery = useQuery<{ preferences: NotificationPreference[] }>({
        queryKey: ['notification-preferences', 'user'],
        queryFn: () => api.listUserNotificationPreferences(),
        enabled: panel === 'preferences',
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })

    useEffect(() => {
        setPanel('inbox')
        setActionError(null)
        setSubjectError(null)
    }, [projectId])

    const openSubject = async (notification: Notification) => {
        if (
            openingId !== null ||
            notification.projectId === null ||
            notification.subject.type !== 'publication'
        )
            return
        setOpeningId(notification.id)
        setSubjectError(null)
        try {
            await api.getPublicationEditor(notification.projectId, notification.subject.id)
            await navigate({
                to: '/dashboard/projects/$projectId/publications/$publicationId',
                params: {
                    projectId: notification.projectId,
                    publicationId: notification.subject.id,
                },
                search: { from: undefined, date: undefined, view: undefined },
            })
            setOpen(false)
        } catch (error) {
            setSubjectError({
                id: notification.id,
                message:
                    error instanceof ApiError && (error.status === 403 || error.status === 404)
                        ? m.notifications_subject_unavailable()
                        : formatApiError(error),
            })
        } finally {
            setOpeningId(null)
        }
    }

    const markRead = async (notification: Notification) => {
        if (notification.readAt !== null) return

        setWorkingId(notification.id)
        setActionError(null)
        try {
            const updated = await api.markUserNotificationRead(notification.id)
            queryClient.setQueryData<NotificationInboxState>(
                ['notifications', projectId ?? 'all'],
                current =>
                    current === undefined
                        ? current
                        : {
                              ...current,
                              notifications: current.notifications.map(item =>
                                  item.id === updated.id ? updated : item
                              ),
                              unreadCount: Math.max(0, current.unreadCount - 1),
                              totalUnreadCount: Math.max(0, current.totalUnreadCount - 1),
                          }
            )
        } catch (caughtError) {
            setActionError(formatApiError(caughtError))
            await inboxQuery.refetch().catch(() => undefined)
        } finally {
            setWorkingId(null)
        }
    }

    const updatePreference = async (preference: NotificationPreference, inAppEnabled: boolean) => {
        if (preference.inAppEnabled === inAppEnabled) return

        setWorkingPreferenceKind(preference.kind)
        setActionError(null)
        try {
            const updated = await api.updateUserNotificationPreference(
                preference.kind,
                inAppEnabled
            )
            queryClient.setQueryData<{ preferences: NotificationPreference[] }>(
                ['notification-preferences', 'user'],
                current =>
                    current === undefined
                        ? current
                        : {
                              preferences: current.preferences.map(item =>
                                  item.kind === updated.kind ? updated : item
                              ),
                          }
            )
        } catch (caughtError) {
            setActionError(formatApiError(caughtError))
            await preferencesQuery.refetch().catch(() => undefined)
        } finally {
            setWorkingPreferenceKind(null)
        }
    }

    const archive = async (notification: Notification) => {
        setWorkingId(notification.id)
        setActionError(null)
        try {
            await api.archiveUserNotification(notification.id)
            queryClient.setQueryData<NotificationInboxState>(
                ['notifications', projectId ?? 'all'],
                current =>
                    current === undefined
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
                              totalUnreadCount:
                                  notification.readAt === null
                                      ? Math.max(0, current.totalUnreadCount - 1)
                                      : current.totalUnreadCount,
                          }
            )
        } catch (caughtError) {
            setActionError(formatApiError(caughtError))
            await inboxQuery.refetch().catch(() => undefined)
        } finally {
            setWorkingId(null)
        }
    }

    const inbox = inboxQuery.data
    const preferences = preferencesQuery.data?.preferences ?? null
    // The bell follows the visible context. A project page should not show a
    // global count whose items are intentionally hidden until the user opens
    // the instance-wide inbox without a project selected.
    const unreadCount =
        projectId === null ? (inbox?.totalUnreadCount ?? 0) : (inbox?.unreadCount ?? 0)
    const notifications = inbox?.notifications ?? []
    const loading = inboxQuery.isPending || inboxQuery.isFetching
    const preferencesLoading = preferencesQuery.isPending || preferencesQuery.isFetching
    const queryError = panel === 'inbox' ? inboxQuery.error : preferencesQuery.error
    const error =
        actionError ??
        (queryError === null || queryError === undefined ? null : formatApiError(queryError))

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (nextOpen) {
            setPanel('inbox')
            void inboxQuery.refetch()
        }
    }

    return (
        <>
            <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger
                    render={
                        <Button
                            aria-label={
                                unreadCount === 0
                                    ? m.notifications_open()
                                    : m.notifications_open_unread({ count: unreadCount })
                            }
                            className="relative"
                            size="icon-sm"
                            title={m.notifications_title()}
                            variant="ghost"
                        />
                    }>
                    <BellIcon aria-hidden="true" />
                    {unreadCount > 0 ? (
                        <span className="absolute top-0.5 right-0.5 flex min-w-3.5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] leading-3.5 font-semibold text-primary-foreground tabular-nums">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    ) : null}
                </PopoverTrigger>

                <PopoverContent
                    align="end"
                    className="flex w-[min(26rem,calc(100vw-1rem))] flex-col p-0 sm:w-[26rem]">
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <PopoverTitle>
                                {panel === 'inbox'
                                    ? m.notifications_title()
                                    : m.notifications_preferences()}
                            </PopoverTitle>
                            {panel === 'inbox' && unreadCount > 0 ? (
                                <Badge variant="secondary">
                                    {m.notifications_unread({ count: unreadCount })}
                                </Badge>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <Button
                                aria-label={
                                    panel === 'inbox'
                                        ? m.notifications_preferences_open()
                                        : m.notifications_back()
                                }
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
                                    } else {
                                        setPanel('inbox')
                                        void inboxQuery.refetch()
                                    }
                                }}>
                                {panel === 'inbox' ? (
                                    <SettingsIcon aria-hidden="true" />
                                ) : (
                                    <ArrowLeftIcon aria-hidden="true" />
                                )}
                            </Button>
                            <PopoverClose
                                render={
                                    <Button
                                        aria-label={m.common_close()}
                                        size="icon-sm"
                                        title={m.common_close()}
                                        variant="ghost"
                                    />
                                }>
                                <CloseIcon aria-hidden="true" />
                            </PopoverClose>
                        </div>
                    </div>

                    {error !== null ? (
                        <div
                            className="mx-3 mb-3 flex items-center justify-between gap-3 rounded-md bg-state-failed/10 px-3 py-2.5 text-sm text-state-failed"
                            role="alert">
                            <span>{error}</span>
                            <Button
                                className="shrink-0"
                                disabled={loading || preferencesLoading}
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    void (panel === 'inbox'
                                        ? inboxQuery.refetch()
                                        : preferencesQuery.refetch())
                                }>
                                {m.common_try_again()}
                            </Button>
                        </div>
                    ) : null}

                    {panel === 'inbox' ? (
                        <ScrollArea className="max-h-[min(36rem,calc(100dvh-5rem))] px-3 pb-3">
                            {loading && inbox === undefined ? (
                                <NotificationLoadingState />
                            ) : notifications.length === 0 ? (
                                <EmptyState
                                    className="min-h-56 bg-surface-inset/55 px-5 py-8 shadow-none"
                                    description={null}
                                    illustration="notifications"
                                    illustrationClassName="w-32"
                                    title={m.notifications_empty()}
                                />
                            ) : (
                                <ul className="grid gap-2">
                                    {notifications.map(notification => (
                                        <NotificationItem
                                            key={notification.id}
                                            disabled={workingId === notification.id}
                                            notification={notification}
                                            projectName={
                                                notification.projectId === null ||
                                                notification.projectId === projectId
                                                    ? null
                                                    : (projects.find(
                                                          project =>
                                                              project.id === notification.projectId
                                                      )?.name ?? null)
                                            }
                                            locale={locale}
                                            opening={openingId === notification.id}
                                            navigationDisabled={openingId !== null}
                                            subjectError={
                                                subjectError?.id === notification.id
                                                    ? subjectError.message
                                                    : null
                                            }
                                            onOpen={openSubject}
                                            onArchive={archive}
                                            onMarkRead={markRead}
                                        />
                                    ))}
                                </ul>
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
                </PopoverContent>
            </Popover>
        </>
    )
}

function NotificationItem({
    disabled,
    locale,
    notification,
    projectName,
    onArchive,
    onMarkRead,
    onOpen,
    opening,
    navigationDisabled,
    subjectError,
}: {
    readonly opening: boolean
    readonly navigationDisabled: boolean
    readonly subjectError: string | null
    readonly onOpen: (notification: Notification) => Promise<void>
    readonly disabled: boolean
    readonly notification: Notification
    readonly projectName: string | null
    readonly locale: Locale
    readonly onArchive: (notification: Notification) => Promise<void>
    readonly onMarkRead: (notification: Notification) => Promise<void>
}) {
    const unread = notification.readAt === null
    const copy = notificationContent(notification, locale)
    const canOpen = notification.projectId !== null && notification.subject.type === 'publication'

    return (
        <li
            className={
                unread
                    ? 'rounded-md bg-surface-raised px-3.5 py-3 shadow-field'
                    : 'rounded-md bg-muted/60 px-3.5 py-3'
            }>
            <div className="flex items-start gap-3">
                <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${severityClass(notification)}`}
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    {canOpen ? (
                        <button
                            type="button"
                            aria-label={m.notifications_open_subject({ title: copy.title })}
                            aria-busy={opening}
                            disabled={navigationDisabled}
                            className="block min-h-11 w-full rounded-sm text-left text-sm leading-5 font-medium break-words text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-0"
                            onClick={() => void onOpen(notification)}>
                            {copy.title}
                        </button>
                    ) : (
                        <p className="text-sm leading-5 font-medium break-words text-foreground">
                            {copy.title}
                        </p>
                    )}
                    {subjectError !== null ? (
                        <p role="alert" className="mt-1 text-xs leading-5 text-state-failed">
                            {subjectError}
                        </p>
                    ) : null}
                    {copy.body !== null ? (
                        <p className="mt-1 text-xs leading-5 break-words text-muted-foreground">
                            {copy.body}
                        </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] leading-4 text-muted-foreground">
                        {projectName !== null ? (
                            <span className="min-w-0 break-words">{projectName}</span>
                        ) : null}
                        <time
                            className="tabular-nums"
                            dateTime={new Date(notification.createdAt).toISOString()}>
                            {formatNotificationTime(notification.createdAt, locale)}
                        </time>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                            {unread ? (
                                <Button
                                    aria-label={m.notifications_mark_as_read({ title: copy.title })}
                                    disabled={disabled}
                                    size="icon"
                                    className="size-11 sm:size-8"
                                    title={m.notifications_read_short()}
                                    variant="ghost"
                                    onClick={() => void onMarkRead(notification)}>
                                    <CheckIcon aria-hidden="true" />
                                    <span className="sr-only">{m.notifications_read_short()}</span>
                                </Button>
                            ) : null}
                            <Button
                                aria-label={m.notifications_archive_item({ title: copy.title })}
                                disabled={disabled}
                                size="icon"
                                className="size-11 sm:size-8"
                                title={m.notifications_archive_short()}
                                variant="ghost"
                                onClick={() => void onArchive(notification)}>
                                <ArchiveIcon aria-hidden="true" />
                                <span className="sr-only">{m.notifications_archive_short()}</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </li>
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
                className="grid gap-2 px-3 pb-3"
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
            className="grid gap-2 px-3 pb-3"
            data-notification-preferences="true"
            role="group"
            aria-label={m.notifications_preferences_label()}>
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
