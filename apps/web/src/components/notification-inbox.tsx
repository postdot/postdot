import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import { Field, FieldContent, FieldDescription, FieldTitle } from '@postdot/ui/components/field'
import {
    Popover,
    PopoverClose,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
} from '@postdot/ui/components/popover'
import { ScrollArea } from '@postdot/ui/components/scroll-area'
import { Switch } from '@postdot/ui/components/switch'
import { Tooltip, TooltipTrigger, TooltipContent } from '@postdot/ui/components/tooltip'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { ArrowLeftIcon } from '@solar-icons/react/linear/arrow-left'
import { BellIcon } from '@solar-icons/react/linear/bell'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { DangerTriangleIcon } from '@solar-icons/react/linear/danger-triangle'
import { QuestionCircleIcon } from '@solar-icons/react/linear/question-circle'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import { ChannelAvatar } from '@/components/identity-visuals'
import {
    api,
    ApiError,
    formatApiError,
    type Notification,
    type NotificationInbox as NotificationInboxState,
    type NotificationPreference,
    type Project,
} from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import {
    notificationChannelSummary,
    notificationContent,
    notificationOutcomeCopy,
} from '@/lib/notification-content'
import {
    groupNotifications,
    notificationChannels,
    notificationSection,
    notificationTime,
    type NotificationGroup,
} from '@/lib/notification-groups'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import * as m from '@/paraglide/messages.js'
import type { Locale } from '@/paraglide/runtime.js'

import { NotificationEmailPreferences } from './notification-email-preferences'

interface NotificationInboxProps {
    readonly projectId: string | null
    readonly projects: readonly Project[]
}

type NotificationPanel = 'inbox' | 'preferences'

export function NotificationInbox({ projectId, projects }: NotificationInboxProps) {
    const { locale } = useLanguage()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const [now, setNow] = useState(Date.now)
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

    useEffect(() => {
        if (!open) return
        setNow(Date.now())
        const timer = window.setInterval(() => setNow(Date.now()), 30_000)
        return () => window.clearInterval(timer)
    }, [open])

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

    const applyToGroup = async (group: NotificationGroup, action: 'read' | 'archive') => {
        setWorkingId(group.notification.id)
        setActionError(null)
        try {
            for (const member of group.members) {
                if (action === 'read' && member.readAt !== null) continue
                const updated = await (action === 'read'
                    ? api.markUserNotificationRead(member.id)
                    : api.archiveUserNotification(member.id))
                queryClient.setQueryData<NotificationInboxState>(
                    ['notifications', projectId ?? 'all'],
                    current => {
                        if (current === undefined) return current
                        const previous = current.notifications.find(item => item.id === member.id)
                        const decrement = previous?.readAt === null ? 1 : 0
                        return {
                            ...current,
                            notifications:
                                action === 'archive'
                                    ? current.notifications.filter(item => item.id !== member.id)
                                    : current.notifications.map(item =>
                                          item.id === member.id ? { ...item, ...updated } : item
                                      ),
                            unreadCount: Math.max(0, current.unreadCount - decrement),
                            totalUnreadCount: Math.max(0, current.totalUnreadCount - decrement),
                        }
                    }
                )
            }
        } catch (error) {
            setActionError(formatApiError(error))
            await inboxQuery.refetch().catch(() => undefined)
        } finally {
            setWorkingId(null)
        }
    }

    const retry = async (group: NotificationGroup) => {
        setWorkingId(group.notification.id)
        setActionError(null)
        try {
            const publications = new Map(
                group.members
                    .filter(item => item.context?.canRetry)
                    .map(item => [item.subject.id, item])
            )
            for (const member of publications.values()) {
                await api.retryFailedPublication(member.context!.projectId, member.subject.id)
            }
            await inboxQuery.refetch()
        } catch (error) {
            setActionError(formatApiError(error))
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
    const groups = groupNotifications(notifications)
    const zoneFor = (notification: Notification) =>
        projects.find(
            project =>
                project.id === notification.context?.projectId ||
                project.id === notification.projectId
        )?.timeZone ?? 'UTC'
    const sections = new Set(
        groups.map(group =>
            notificationSection(group.notification.createdAt, zoneFor(group.notification), now)
        )
    )
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
                <Tooltip>
                    <PopoverTrigger
                        render={
                            <TooltipTrigger
                                render={
                                    <Button
                                        aria-label={
                                            unreadCount === 0
                                                ? m.notifications_open()
                                                : m.notifications_open_unread({
                                                      count: unreadCount,
                                                  })
                                        }
                                        className="relative"
                                        size="icon-sm"
                                        variant="ghost"
                                    />
                                }
                            />
                        }>
                        <BellIcon aria-hidden="true" />
                        {unreadCount > 0 ? (
                            <span className="absolute top-0.5 right-0.5 flex min-w-3.5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] leading-3.5 font-semibold text-primary-foreground tabular-nums">
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        ) : null}
                    </PopoverTrigger>
                    <TooltipContent>{m.notifications_title()}</TooltipContent>
                </Tooltip>

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
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            aria-label={
                                                panel === 'inbox'
                                                    ? m.notifications_preferences_open()
                                                    : m.notifications_back()
                                            }
                                            size="icon-sm"
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
                                    }
                                />
                                <TooltipContent>
                                    {panel === 'inbox'
                                        ? m.notifications_preferences()
                                        : m.notifications_back()}
                                </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <PopoverClose
                                    render={
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    aria-label={m.common_close()}
                                                    size="icon-sm"
                                                    variant="ghost"
                                                />
                                            }
                                        />
                                    }>
                                    <CloseIcon aria-hidden="true" />
                                </PopoverClose>
                                <TooltipContent>{m.common_close()}</TooltipContent>
                            </Tooltip>
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
                                    className="py-10"
                                    description={null}
                                    illustration="notifications"
                                    illustrationClassName="w-32"
                                    title={m.notifications_empty()}
                                />
                            ) : (
                                <ul className="grid grid-cols-1 gap-2">
                                    {groups.map((group, index) => {
                                        const notification = group.notification
                                        const timeZone = zoneFor(notification)
                                        const section = notificationSection(
                                            notification.createdAt,
                                            timeZone,
                                            now
                                        )
                                        const previous = groups[index - 1]?.notification
                                        const showSection =
                                            sections.size > 1 &&
                                            (previous === undefined ||
                                                notificationSection(
                                                    previous.createdAt,
                                                    zoneFor(previous),
                                                    now
                                                ) !== section)
                                        return (
                                            <NotificationItem
                                                key={notification.id}
                                                group={group}
                                                section={showSection ? section : null}
                                                disabled={workingId !== null}
                                                locale={locale}
                                                timeZone={timeZone}
                                                now={now}
                                                opening={openingId === notification.id}
                                                navigationDisabled={openingId !== null}
                                                subjectError={
                                                    subjectError?.id === notification.id
                                                        ? subjectError.message
                                                        : null
                                                }
                                                onOpen={openSubject}
                                                onClose={() => setOpen(false)}
                                                onArchive={() => applyToGroup(group, 'archive')}
                                                onMarkRead={() => applyToGroup(group, 'read')}
                                                onRetry={() => retry(group)}
                                            />
                                        )
                                    })}
                                </ul>
                            )}
                        </ScrollArea>
                    ) : (
                        <>
                            <NotificationPreferencesPanel
                                loading={preferencesLoading}
                                preferences={preferences}
                                workingKind={workingPreferenceKind}
                                onChange={updatePreference}
                            />
                            <NotificationEmailPreferences
                                key={projectId}
                                projectId={projectId}
                                projectName={
                                    projects.find(project => project.id === projectId)?.name ?? null
                                }
                            />
                        </>
                    )}
                </PopoverContent>
            </Popover>
        </>
    )
}

function NotificationItem({
    disabled,
    locale,
    group,
    section,
    timeZone,
    now,
    onArchive,
    onMarkRead,
    onRetry,
    onOpen,
    onClose,
    opening,
    navigationDisabled,
    subjectError,
}: {
    readonly group: NotificationGroup
    readonly section: 'today' | 'yesterday' | 'earlier' | null
    readonly timeZone: string
    readonly now: number
    readonly opening: boolean
    readonly navigationDisabled: boolean
    readonly subjectError: string | null
    readonly onOpen: (notification: Notification) => Promise<void>
    readonly onClose: () => void
    readonly disabled: boolean
    readonly locale: Locale
    readonly onArchive: () => Promise<void>
    readonly onMarkRead: () => Promise<void>
    readonly onRetry: () => Promise<void>
}) {
    const rowRef = useRef<HTMLDivElement>(null)
    const timeTooltipId = useId()
    const notification = group.notification
    const unread = group.members.some(item => item.readAt === null)
    const context = notification.context
    const title = context
        ? publicationIdentityLabel(context)
        : notificationContent(notification, locale).title
    const channels = notificationChannels(group)
    const canOpen = notification.projectId !== null && notification.subject.type === 'publication'
    const StatusIcon =
        notification.severity === 'error'
            ? DangerTriangleIcon
            : notification.severity === 'warning'
              ? QuestionCircleIcon
              : CheckIcon
    const sectionLabels = {
        today: m.notifications_today,
        yesterday: m.notifications_yesterday,
        earlier: m.notifications_earlier,
    }

    return (
        <li className="min-w-0">
            {section !== null ? (
                <h3 className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                    {sectionLabels[section]()}
                </h3>
            ) : null}
            <div
                data-notification-row
                ref={rowRef}
                className="group relative flex items-start gap-2 rounded-md px-2 py-3 hover:bg-muted/60 focus-within:bg-muted/60">
                {canOpen ? (
                    context ? (
                        <Link
                            className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={m.notifications_open_subject({ title })}
                            to="/dashboard/projects/$projectId/posts/$postId"
                            params={{ projectId: context.projectId, postId: context.postId }}
                            onClick={onClose}
                        />
                    ) : (
                        <Link
                            className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={m.notifications_open_subject({ title })}
                            aria-busy={opening}
                            aria-disabled={navigationDisabled}
                            to="/dashboard/projects/$projectId/publications/$publicationId"
                            params={{
                                projectId: notification.projectId!,
                                publicationId: notification.subject.id,
                            }}
                            search={{ from: undefined, date: undefined, view: undefined }}
                            onClick={event => {
                                event.preventDefault()
                                if (!navigationDisabled) void onOpen(notification)
                            }}
                        />
                    )
                ) : null}
                <span
                    aria-hidden="true"
                    className={`mt-3 size-1.5 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`}
                />
                <div className="pointer-events-none mt-0.5 w-14 shrink-0" aria-hidden="true">
                    <div className="relative flex w-fit items-center -space-x-1.5">
                        {channels.length === 0 ? (
                            <span className="flex size-6 items-center justify-center rounded-md bg-muted">
                                <BellIcon className="size-4 text-muted-foreground" />
                            </span>
                        ) : (
                            channels
                                .slice(0, 3)
                                .map(channel => (
                                    <ChannelAvatar
                                        key={channel.id}
                                        channel={{ ...channel, profileId: '' }}
                                        size="sm"
                                        className="ring-2 ring-popover"
                                    />
                                ))
                        )}
                        {channels.length > 3 ? (
                            <span className="relative flex size-5 items-center justify-center rounded-full bg-muted text-xs ring-2 ring-popover">
                                +{channels.length - 3}
                            </span>
                        ) : null}
                        <span
                            className={`absolute -right-2 -bottom-1.5 flex size-3.5 items-center justify-center rounded-full bg-popover ring-2 ring-popover ${severityClass(notification)}`}>
                            <StatusIcon className="size-2.5" />
                        </span>
                    </div>
                </div>
                <div className="pointer-events-none min-w-0 flex-1 pl-1">
                    <p
                        className={`truncate text-sm font-medium ${unread ? 'pr-24 text-foreground sm:pr-18' : 'pr-12 text-muted-foreground sm:pr-9'}`}>
                        {title}
                    </p>
                    <div className="mt-1 text-xs leading-5 break-words text-muted-foreground">
                        {channels.length > 0 ? (
                            <>
                                <span className="min-w-0 break-words">
                                    {notificationOutcomeCopy(
                                        notification,
                                        notificationChannelSummary(
                                            channels.map(channel => channel.name),
                                            locale
                                        ),
                                        locale
                                    )}
                                </span>
                                <span aria-hidden="true"> · </span>
                            </>
                        ) : null}
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <time
                                        tabIndex={0}
                                        aria-describedby={timeTooltipId}
                                        className="pointer-events-auto relative z-10 cursor-default whitespace-nowrap rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        dateTime={new Date(notification.createdAt).toISOString()}
                                    />
                                }>
                                {notificationTime(notification.createdAt, timeZone, locale, now)}
                            </TooltipTrigger>
                            <TooltipContent container={rowRef} role="tooltip" id={timeTooltipId}>
                                {formatProjectDateTime(notification.createdAt, timeZone, locale)}
                            </TooltipContent>
                        </Tooltip>
                        {notification.kind === 'publication_failed' &&
                        group.members.some(item => item.context?.canRetry) ? (
                            <Button
                                className="pointer-events-auto relative z-10 ml-2"
                                size="xs"
                                variant="secondary"
                                disabled={disabled}
                                onClick={() => void onRetry()}>
                                {m.common_retry()}
                            </Button>
                        ) : null}
                    </div>
                    {subjectError !== null ? (
                        <p role="alert" className="mt-1 text-xs text-state-failed">
                            {subjectError}
                        </p>
                    ) : null}
                </div>
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    {unread ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        aria-label={m.notifications_mark_as_read({ title })}
                                        disabled={disabled}
                                        size="icon"
                                        className="size-11 sm:size-8"
                                        variant="ghost"
                                        onClick={() => void onMarkRead()}
                                    />
                                }>
                                <CheckIcon aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipContent role="tooltip">
                                {m.notifications_read_short()}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    aria-label={m.notifications_archive_item({ title })}
                                    disabled={disabled}
                                    size="icon"
                                    className="size-11 sm:size-8"
                                    variant="ghost"
                                    onClick={() => void onArchive()}
                                />
                            }>
                            <ArchiveIcon aria-hidden="true" />
                        </TooltipTrigger>
                        <TooltipContent role="tooltip">
                            {m.notifications_archive_short()}
                        </TooltipContent>
                    </Tooltip>
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
    if (notification.severity === 'error') return 'text-state-failed'
    if (notification.severity === 'warning') return 'text-state-attention'
    return 'text-state-published'
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
