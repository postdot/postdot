import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import { eq, isNull, useLiveQuery, DbProvider } from '@tanstack/react-db'
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { createDbRealtimeAdapter, type DbRealtimeAdapter } from '@/lib/realtime-db'
import {
    FixtureRealtimeEnvironment,
    groupAttentionRows,
    selectAttentionGroups,
    selectQueue,
    selectUnreadNotifications,
    type RealtimeAttentionGroup,
    type RealtimeAttentionRow,
    type RealtimeEvent,
    type RealtimeMetricsSnapshot,
    type RealtimeNotification,
    type RealtimePublication,
} from '@/lib/realtime-prototype'
import { createQueryRealtimeAdapter, type QueryRealtimeAdapter } from '@/lib/realtime-query'
import * as m from '@/paraglide/messages.js'

type PrototypeMode = 'query' | 'db'

export function RealtimePrototypePage({ projectId }: { readonly projectId: string }) {
    const environment = useMemo(() => new FixtureRealtimeEnvironment(projectId), [projectId])
    const [mode, setMode] = useState<PrototypeMode>('query')
    const [lastSignal, setLastSignal] = useState<RealtimeEvent | null>(null)
    const [renderRevision, setRenderRevision] = useState(0)
    const [connection, setConnection] = useState<'connected' | 'disconnected'>('connected')

    useEffect(
        () => environment.metrics.subscribe(() => setRenderRevision(value => value + 1)),
        [environment]
    )
    useEffect(() => environment.events.subscribe(() => undefined, setConnection), [environment])

    void renderRevision

    async function sendSignal(action: () => Promise<RealtimeEvent>) {
        const event = await action()
        setLastSignal(event)
    }

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto max-w-7xl">
                <header className="max-w-3xl">
                    <p className="text-xs font-semibold text-primary">REALTIME-96 · SPIKE</p>
                    <h1 className="mt-2 font-heading text-3xl font-semibold leading-tight">
                        {m.realtime_title()}
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {m.realtime_description()}
                    </p>
                </header>

                <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                            <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                                <ModeButton
                                    active={mode === 'query'}
                                    label={m.realtime_query_option()}
                                    onClick={() => setMode('query')}
                                />
                                <ModeButton
                                    active={mode === 'db'}
                                    label={m.realtime_db_option()}
                                    onClick={() => setMode('db')}
                                />
                            </div>
                            <ConnectionBadge status={connection} />
                        </div>

                        <div className="mt-5">
                            {mode === 'query' ? (
                                <QueryPrototype connection={connection} environment={environment} />
                            ) : (
                                <DbPrototype connection={connection} environment={environment} />
                            )}
                        </div>
                    </div>

                    <aside className="border-l border-border pl-0 xl:pl-6">
                        <SimulatorControls
                            connected={connection === 'connected'}
                            lastSignal={lastSignal}
                            onDisconnect={() => void environment.events.disconnect()}
                            onPublicationStatus={() =>
                                void sendSignal(() =>
                                    environment.simulatePublicationStatusChange('published', 90)
                                )
                            }
                            onPublicationUpdate={() =>
                                void sendSignal(() => environment.simulatePublicationUpdate(90))
                            }
                            onNotificationCreated={() =>
                                void sendSignal(() => environment.simulateNotificationCreated(90))
                            }
                            onNotificationRead={() =>
                                void sendSignal(() =>
                                    environment.simulateNotificationRead(
                                        `${projectId}-notification-1`,
                                        90
                                    )
                                )
                            }
                            onReconnect={() => void environment.events.reconnect()}
                        />
                    </aside>
                </div>
            </div>
        </main>
    )
}

function QueryPrototype({
    connection,
    environment,
}: {
    readonly connection: 'connected' | 'disconnected'
    readonly environment: FixtureRealtimeEnvironment
}) {
    const adapter = useMemo(
        () =>
            createQueryRealtimeAdapter({
                projectId: environment.projectId,
                source: environment.source,
                events: environment.events,
                metrics: environment.metrics,
            }),
        [environment]
    )

    useEffect(() => {
        adapter.start()
        void adapter.load().catch(() => undefined)
        return () => adapter.dispose()
    }, [adapter])

    return (
        <QueryClientProvider client={adapter.queryClient}>
            <QueryPrototypeContent adapter={adapter} connection={connection} />
        </QueryClientProvider>
    )
}

function QueryPrototypeContent({
    adapter,
    connection,
}: {
    readonly adapter: QueryRealtimeAdapter
    readonly connection: 'connected' | 'disconnected'
}) {
    const publicationsQuery = useQuery(adapter.publicationsQuery)
    const notificationsQuery = useQuery(adapter.notificationsQuery)
    const markRead = useMutation({
        mutationFn: (notificationId: string) => adapter.markNotificationRead(notificationId),
    })

    const publications = publicationsQuery.data ?? []
    const notifications = notificationsQuery.data ?? []
    const error = publicationsQuery.error ?? notificationsQuery.error

    return (
        <RealtimePanel
            attention={selectAttentionGroups(publications, notifications)}
            connection={connection}
            error={error}
            fetching={publicationsQuery.isFetching || notificationsQuery.isFetching}
            loading={publicationsQuery.isPending || notificationsQuery.isPending}
            mode="query"
            notifications={notifications}
            onMarkRead={notificationId => markRead.mutate(notificationId)}
            pendingReadId={markRead.isPending ? markRead.variables : null}
            publications={publications}
            metrics={adapter.metrics.snapshot()}
        />
    )
}

function DbPrototype({
    connection,
    environment,
}: {
    readonly connection: 'connected' | 'disconnected'
    readonly environment: FixtureRealtimeEnvironment
}) {
    const adapter = useMemo(
        () =>
            createDbRealtimeAdapter({
                projectId: environment.projectId,
                source: environment.source,
                events: environment.events,
                metrics: environment.metrics,
            }),
        [environment]
    )

    useEffect(() => {
        adapter.start()
        return () => {
            void adapter.dispose()
        }
    }, [adapter])

    return (
        <DbProvider client={adapter.dbClient}>
            <DbPrototypeContent
                adapter={adapter}
                connection={connection}
                environment={environment}
            />
        </DbProvider>
    )
}

function DbPrototypeContent({
    adapter,
    connection,
    environment,
}: {
    readonly adapter: DbRealtimeAdapter
    readonly connection: 'connected' | 'disconnected'
    readonly environment: FixtureRealtimeEnvironment
}) {
    const publicationsQuery = useLiveQuery({
        queryKey: ['realtime-prototype', adapter.projectId, 'publications-live'],
        query: query =>
            query
                .from({ publication: adapter.publications })
                .select(({ publication }) => publication),
    })
    const notificationsQuery = useLiveQuery({
        queryKey: ['realtime-prototype', adapter.projectId, 'notifications-live'],
        query: query =>
            query
                .from({ notification: adapter.notifications })
                .select(({ notification }) => notification),
    })
    const attentionQuery = useLiveQuery({
        queryKey: ['realtime-prototype', adapter.projectId, 'attention-live'],
        query: query =>
            query
                .from({ publication: adapter.publications })
                .join({ notification: adapter.notifications }, ({ publication, notification }) =>
                    eq(notification.subjectId, publication.id)
                )
                .where(({ notification }) => isNull(notification.readAt))
                .select(({ publication, notification }) => ({
                    channelName: publication.channelName,
                    notificationId: notification.id,
                    publicationId: publication.id,
                    publicationState: publication.state,
                })),
    })

    const publications = publicationsQuery.data ?? []
    const notifications = notificationsQuery.data ?? []
    const attentionRows = (attentionQuery.data ?? []) as readonly RealtimeAttentionRow[]
    const loading =
        publicationsQuery.isLoading || notificationsQuery.isLoading || attentionQuery.isLoading
    const error =
        publicationsQuery.isError || notificationsQuery.isError || attentionQuery.isError
            ? new Error(m.realtime_error())
            : null

    return (
        <RealtimePanel
            attention={groupAttentionRows(attentionRows)}
            connection={connection}
            error={error}
            fetching={publicationsQuery.isLoading || notificationsQuery.isLoading}
            loading={loading}
            mode="db"
            notifications={notifications}
            onMarkRead={notificationId => void adapter.markNotificationRead(notificationId)}
            pendingReadId={null}
            publications={publications}
            metrics={environment.metrics.snapshot()}
        />
    )
}

function RealtimePanel({
    attention,
    connection,
    error,
    fetching,
    loading,
    mode,
    notifications,
    onMarkRead,
    pendingReadId,
    publications,
    metrics,
}: {
    readonly attention: readonly RealtimeAttentionGroup[]
    readonly connection: 'connected' | 'disconnected'
    readonly error: unknown
    readonly fetching: boolean
    readonly loading: boolean
    readonly mode: PrototypeMode
    readonly notifications: readonly RealtimeNotification[]
    readonly onMarkRead: (notificationId: string) => void
    readonly pendingReadId: string | null | undefined
    readonly publications: readonly RealtimePublication[]
    readonly metrics: RealtimeMetricsSnapshot
}) {
    const queue = selectQueue(publications)
    const unread = selectUnreadNotifications(notifications)

    if (loading) {
        return <p className="py-8 text-sm text-muted-foreground">{m.realtime_loading()}</p>
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span>{mode === 'query' ? m.realtime_query_option() : m.realtime_db_option()}</span>
                <span>{m.realtime_items({ count: publications.length })}</span>
                <span>
                    {m.realtime_unread()}: {unread.length}
                </span>
                {fetching ? <span className="text-primary">{m.realtime_refreshing()}</span> : null}
            </div>

            {error !== null && error !== undefined ? (
                <Alert variant="destructive">
                    <AlertTitle>{m.realtime_error()}</AlertTitle>
                    <AlertDescription>{errorMessage(error)}</AlertDescription>
                </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
                <DataSection heading={m.realtime_publications()} count={publications.length}>
                    <ul className="divide-y divide-border">
                        {publications.length === 0 ? (
                            <EmptyRow />
                        ) : (
                            publications.map(publication => (
                                <PublicationRow key={publication.id} publication={publication} />
                            ))
                        )}
                    </ul>
                </DataSection>

                <DataSection heading={m.realtime_queue()} count={queue.length}>
                    <ul className="divide-y divide-border">
                        {queue.length === 0 ? (
                            <EmptyRow />
                        ) : (
                            queue.map(publication => (
                                <QueueRow key={publication.id} publication={publication} />
                            ))
                        )}
                    </ul>
                </DataSection>

                <DataSection heading={m.realtime_notifications()} count={notifications.length}>
                    <ul className="divide-y divide-border">
                        {notifications.length === 0 ? (
                            <EmptyRow />
                        ) : (
                            notifications.map(notification => (
                                <NotificationRow
                                    key={notification.id}
                                    notification={notification}
                                    onMarkRead={onMarkRead}
                                    pending={pendingReadId === notification.id}
                                />
                            ))
                        )}
                    </ul>
                </DataSection>

                <DataSection heading={m.realtime_attention()} count={attention.length}>
                    <ul className="divide-y divide-border">
                        {attention.length === 0 ? (
                            <EmptyRow />
                        ) : (
                            attention.map(group => (
                                <li
                                    className="flex items-center justify-between gap-4 px-3 py-3 text-sm"
                                    key={group.channelName}>
                                    <span className="truncate">{group.channelName}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {m.realtime_attention_summary({
                                            publications: group.publicationCount,
                                            notifications: group.unreadNotificationCount,
                                        })}
                                    </span>
                                </li>
                            ))
                        )}
                    </ul>
                </DataSection>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>
                    {m.realtime_requests()}: {metrics.publicationReads + metrics.notificationReads}
                </span>
                <span>
                    {m.realtime_reconnects()}: {metrics.reconnects}
                </span>
                <span>
                    {m.realtime_projection_waits()}: {metrics.projectionWaits}
                </span>
                <span>
                    {connection === 'connected'
                        ? m.realtime_connected()
                        : m.realtime_disconnected()}
                </span>
            </div>
        </div>
    )
}

function DataSection({
    children,
    count,
    heading,
}: {
    readonly children: ReactNode
    readonly count: number
    readonly heading: string
}) {
    return (
        <section className="min-w-0 border-t-2 border-foreground/15">
            <div className="flex items-baseline justify-between gap-4 py-3">
                <h2 className="text-sm font-semibold">{heading}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
            </div>
            <div className="overflow-hidden border border-border bg-card shadow-surface">
                {children}
            </div>
        </section>
    )
}

function PublicationRow({ publication }: { readonly publication: RealtimePublication }) {
    return (
        <li className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
            <div className="min-w-0">
                <p className="truncate font-medium">
                    {publication.postTitle ?? m.realtime_untitled()}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {publication.channelName} · {formatTime(publication.updatedAt)}
                </p>
            </div>
            <StateBadge state={publication.state} />
        </li>
    )
}

function QueueRow({
    publication,
}: {
    readonly publication: RealtimePublication & { queueReason: string }
}) {
    return (
        <li className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
            <div className="min-w-0">
                <p className="truncate font-medium">{publication.channelName}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {publication.scheduledAt === null
                        ? m.realtime_state({ state: publication.state })
                        : formatTime(publication.scheduledAt)}
                </p>
            </div>
            <StateBadge state={publication.state} />
        </li>
    )
}

function NotificationRow({
    notification,
    onMarkRead,
    pending,
}: {
    readonly notification: RealtimeNotification
    readonly onMarkRead: (notificationId: string) => void
    readonly pending: boolean
}) {
    const unread = notification.readAt === null
    return (
        <li className="flex items-start justify-between gap-4 px-3 py-3 text-sm">
            <div className="min-w-0">
                <p className="truncate font-medium">{notification.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {notification.body}
                </p>
            </div>
            {unread ? (
                <Button
                    disabled={pending}
                    onClick={() => onMarkRead(notification.id)}
                    size="xs"
                    variant="ghost">
                    {m.realtime_mark_read()}
                </Button>
            ) : (
                <span className="shrink-0 text-xs text-muted-foreground">{m.realtime_read()}</span>
            )}
        </li>
    )
}

function StateBadge({ state }: { readonly state: RealtimePublication['state'] }) {
    const destructive = state === 'failed' || state === 'ambiguous'
    return <Badge variant={destructive ? 'destructive' : 'secondary'}>{state}</Badge>
}

function EmptyRow() {
    return <li className="px-3 py-4 text-sm text-muted-foreground">{m.realtime_no_rows()}</li>
}

function ModeButton({
    active,
    label,
    onClick,
}: {
    readonly active: boolean
    readonly label: string
    readonly onClick: () => void
}) {
    return (
        <Button
            aria-pressed={active}
            onClick={onClick}
            size="sm"
            variant={active ? 'default' : 'ghost'}>
            {label}
        </Button>
    )
}

function ConnectionBadge({ status }: { readonly status: 'connected' | 'disconnected' }) {
    return (
        <Badge variant={status === 'connected' ? 'secondary' : 'destructive'}>
            {status === 'connected' ? m.realtime_connected() : m.realtime_disconnected()}
        </Badge>
    )
}

function SimulatorControls({
    connected,
    lastSignal,
    onDisconnect,
    onNotificationCreated,
    onNotificationRead,
    onPublicationStatus,
    onPublicationUpdate,
    onReconnect,
}: {
    readonly connected: boolean
    readonly lastSignal: RealtimeEvent | null
    readonly onDisconnect: () => void
    readonly onNotificationCreated: () => void
    readonly onNotificationRead: () => void
    readonly onPublicationStatus: () => void
    readonly onPublicationUpdate: () => void
    readonly onReconnect: () => void
}) {
    return (
        <section className="space-y-4">
            <div>
                <h2 className="text-sm font-semibold">{m.realtime_simulator()}</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {m.realtime_fixture_note()}
                </p>
            </div>
            <div className="grid gap-2">
                <SimulatorButton
                    label={m.realtime_publication_status_changed()}
                    onClick={onPublicationStatus}
                />
                <SimulatorButton
                    label={m.realtime_publication_updated()}
                    onClick={onPublicationUpdate}
                />
                <SimulatorButton
                    label={m.realtime_notification_created()}
                    onClick={onNotificationCreated}
                />
                <SimulatorButton
                    label={m.realtime_notification_read()}
                    onClick={onNotificationRead}
                />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button disabled={!connected} onClick={onDisconnect} size="sm" variant="outline">
                    {m.realtime_disconnect()}
                </Button>
                <Button disabled={connected} onClick={onReconnect} size="sm" variant="outline">
                    {m.realtime_reconnect()}
                </Button>
            </div>
            {lastSignal !== null ? (
                <p className="text-xs leading-5 text-muted-foreground">
                    {m.realtime_event_sent({ event: lastSignal.type })}
                </p>
            ) : null}
        </section>
    )
}

function SimulatorButton({
    label,
    onClick,
}: {
    readonly label: string
    readonly onClick: () => void
}) {
    return (
        <Button className="justify-start" onClick={onClick} size="sm" variant="outline">
            {label}
        </Button>
    )
}

function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    }).format(timestamp)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
