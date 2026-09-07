import type { Notification, PublicationSummary } from '@/lib/api'

export const realtimeEventTypes = [
    'publication.updated',
    'publication.status_changed',
    'notification.created',
    'notification.read',
] as const

export type RealtimeEventType = (typeof realtimeEventTypes)[number]
export type RealtimePublicationState = PublicationSummary['state']
export type RealtimeNotificationKind = Notification['kind']
export type RealtimeNotificationSeverity = Notification['severity']

export interface RealtimePublication {
    readonly id: string
    readonly projectId: string
    readonly postId: string
    readonly channelId: string
    readonly channelName: string
    readonly postTitle: string | null
    readonly state: RealtimePublicationState
    readonly scheduledAt: number | null
    readonly updatedAt: number
}

export interface RealtimeNotification {
    readonly id: string
    readonly projectId: string
    readonly subjectType: string
    readonly subjectId: string
    readonly kind: RealtimeNotificationKind
    readonly severity: RealtimeNotificationSeverity
    readonly title: string
    readonly body: string
    readonly readAt: number | null
    readonly archivedAt: number | null
    readonly createdAt: number
}

export interface RealtimeSnapshot {
    readonly publications: readonly RealtimePublication[]
    readonly notifications: readonly RealtimeNotification[]
}

export interface RealtimeEventBase {
    readonly id: string
    readonly projectId: string
    readonly sequence: number
    readonly entityId: string
}

export type RealtimeEvent =
    | (RealtimeEventBase & {
          readonly type: 'publication.updated'
          readonly payload: { readonly updatedAt: number }
      })
    | (RealtimeEventBase & {
          readonly type: 'publication.status_changed'
          readonly payload: { readonly state: RealtimePublicationState }
      })
    | (RealtimeEventBase & {
          readonly type: 'notification.created'
          readonly payload: { readonly createdAt: number }
      })
    | (RealtimeEventBase & {
          readonly type: 'notification.read'
          readonly payload: { readonly readAt: number }
      })

export type RealtimeConnectionStatus = 'connected' | 'disconnected'
export type RealtimeEventListener = (event: RealtimeEvent) => void | Promise<void>
export type RealtimeStatusListener = (status: RealtimeConnectionStatus) => void | Promise<void>

export interface ProjectRealtimeDataSource {
    listPublications(projectId: string): Promise<readonly RealtimePublication[]>
    listNotifications(projectId: string): Promise<readonly RealtimeNotification[]>
    markNotificationRead(projectId: string, notificationId: string): Promise<RealtimeNotification>
}

export interface RealtimeEventSource {
    readonly status: RealtimeConnectionStatus
    subscribe(onEvent: RealtimeEventListener, onStatus?: RealtimeStatusListener): () => void
}

export const realtimeQueryKeys = {
    root: (projectId: string) => ['realtime-prototype', projectId] as const,
    publications: (projectId: string) => ['realtime-prototype', projectId, 'publications'] as const,
    notifications: (projectId: string) =>
        ['realtime-prototype', projectId, 'notifications'] as const,
    attention: (projectId: string) => ['realtime-prototype', projectId, 'attention'] as const,
} as const

const queueStates = new Set<RealtimePublicationState>([
    'scheduled',
    'ready',
    'publishing',
    'failed',
    'ambiguous',
])

export interface RealtimeQueueRow extends RealtimePublication {
    readonly queueReason: 'scheduled' | 'needs_attention' | 'in_flight'
}

export interface RealtimeAttentionRow {
    readonly channelName: string
    readonly publicationId: string
    readonly publicationState: RealtimePublicationState
    readonly notificationId: string
}

export interface RealtimeAttentionGroup {
    readonly channelName: string
    readonly publicationCount: number
    readonly unreadNotificationCount: number
}

export function selectQueue(
    publications: readonly RealtimePublication[]
): readonly RealtimeQueueRow[] {
    return publications
        .filter(publication => queueStates.has(publication.state))
        .map(publication => {
            const queueReason: RealtimeQueueRow['queueReason'] =
                publication.state === 'failed' || publication.state === 'ambiguous'
                    ? 'needs_attention'
                    : publication.state === 'publishing'
                      ? 'in_flight'
                      : 'scheduled'
            return { ...publication, queueReason }
        })
        .toSorted((left, right) => {
            const leftTime = left.scheduledAt ?? Number.MAX_SAFE_INTEGER
            const rightTime = right.scheduledAt ?? Number.MAX_SAFE_INTEGER
            return leftTime - rightTime || right.updatedAt - left.updatedAt
        })
}

export function selectUnreadNotifications(
    notifications: readonly RealtimeNotification[]
): readonly RealtimeNotification[] {
    return notifications.filter(notification => notification.readAt === null)
}

export function selectAttentionGroups(
    publications: readonly RealtimePublication[],
    notifications: readonly RealtimeNotification[]
): readonly RealtimeAttentionGroup[] {
    const unreadByPublication = new Map<string, number>()
    for (const notification of notifications) {
        if (notification.readAt !== null) continue
        unreadByPublication.set(
            notification.subjectId,
            (unreadByPublication.get(notification.subjectId) ?? 0) + 1
        )
    }

    const groups = new Map<string, RealtimeAttentionGroup>()
    for (const publication of publications) {
        const unreadNotificationCount = unreadByPublication.get(publication.id) ?? 0
        if (unreadNotificationCount === 0 && !queueStates.has(publication.state)) continue

        const existing = groups.get(publication.channelName)
        if (existing === undefined) {
            groups.set(publication.channelName, {
                channelName: publication.channelName,
                publicationCount: 1,
                unreadNotificationCount,
            })
            continue
        }

        groups.set(publication.channelName, {
            ...existing,
            publicationCount: existing.publicationCount + 1,
            unreadNotificationCount: existing.unreadNotificationCount + unreadNotificationCount,
        })
    }

    return [...groups.values()].toSorted((left, right) =>
        left.channelName.localeCompare(right.channelName)
    )
}

export function groupAttentionRows(
    rows: readonly RealtimeAttentionRow[]
): readonly RealtimeAttentionGroup[] {
    const groups = new Map<string, RealtimeAttentionGroup>()
    for (const row of rows) {
        const existing = groups.get(row.channelName)
        if (existing === undefined) {
            groups.set(row.channelName, {
                channelName: row.channelName,
                publicationCount: 1,
                unreadNotificationCount: 1,
            })
            continue
        }

        groups.set(row.channelName, {
            ...existing,
            publicationCount: existing.publicationCount + 1,
            unreadNotificationCount: existing.unreadNotificationCount + 1,
        })
    }

    return [...groups.values()].toSorted((left, right) =>
        left.channelName.localeCompare(right.channelName)
    )
}

export function eventIsApplied(snapshot: RealtimeSnapshot, event: RealtimeEvent): boolean {
    if (event.type === 'publication.updated' || event.type === 'publication.status_changed') {
        const publication = snapshot.publications.find(item => item.id === event.entityId)
        if (publication === undefined) return false
        if (event.type === 'publication.updated')
            return publication.updatedAt >= event.payload.updatedAt
        return publication.state === event.payload.state
    }

    const notification = snapshot.notifications.find(item => item.id === event.entityId)
    if (notification === undefined) return false
    if (event.type === 'notification.created')
        return notification.createdAt >= event.payload.createdAt
    return notification.readAt !== null && notification.readAt >= event.payload.readAt
}

export function toRealtimePublication(publication: PublicationSummary): RealtimePublication {
    return {
        id: publication.id,
        projectId: publication.projectId,
        postId: publication.postId,
        channelId: publication.channelId,
        channelName: publication.channelName,
        postTitle: publication.postTitle,
        state: publication.state,
        scheduledAt: publication.scheduledAt,
        updatedAt: publication.updatedAt,
    }
}

export function toRealtimeNotification(notification: Notification): RealtimeNotification {
    return {
        id: notification.id,
        projectId: notification.projectId,
        subjectType: notification.subject.type,
        subjectId: notification.subject.id,
        kind: notification.kind,
        severity: notification.severity,
        title: notification.title,
        body: notification.body,
        readAt: notification.readAt,
        archivedAt: notification.archivedAt,
        createdAt: notification.createdAt,
    }
}

export function createHeraldRealtimeDataSource(): ProjectRealtimeDataSource {
    return {
        async listPublications(projectId) {
            const { api } = await import('@/lib/api')
            const response = await api.listPublications(projectId)
            return response.publications.map(toRealtimePublication)
        },

        async listNotifications(projectId) {
            const { api } = await import('@/lib/api')
            const response = await api.listNotifications(projectId, { limit: 100, view: 'all' })
            return response.notifications.map(toRealtimeNotification)
        },

        async markNotificationRead(projectId, notificationId) {
            const { api } = await import('@/lib/api')
            return toRealtimeNotification(await api.markNotificationRead(projectId, notificationId))
        },
    }
}

export interface RealtimeMetricsSnapshot {
    readonly publicationReads: number
    readonly notificationReads: number
    readonly notificationWrites: number
    readonly receivedEvents: number
    readonly deduplicatedEvents: number
    readonly reconnects: number
    readonly projectionWaits: number
}

export class RealtimeMetrics {
    private current: RealtimeMetricsSnapshot = {
        publicationReads: 0,
        notificationReads: 0,
        notificationWrites: 0,
        receivedEvents: 0,
        deduplicatedEvents: 0,
        reconnects: 0,
        projectionWaits: 0,
    }

    private readonly listeners = new Set<() => void>()

    snapshot(): RealtimeMetricsSnapshot {
        return this.current
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    record(field: keyof RealtimeMetricsSnapshot): void {
        this.current = { ...this.current, [field]: this.current[field] + 1 }
        for (const listener of this.listeners) listener()
    }
}

export class LocalRealtimeEventSource implements RealtimeEventSource {
    private connected = true
    private readonly eventListeners = new Set<RealtimeEventListener>()
    private readonly statusListeners = new Set<RealtimeStatusListener>()

    get status(): RealtimeConnectionStatus {
        return this.connected ? 'connected' : 'disconnected'
    }

    subscribe(onEvent: RealtimeEventListener, onStatus?: RealtimeStatusListener): () => void {
        this.eventListeners.add(onEvent)
        if (onStatus !== undefined) this.statusListeners.add(onStatus)
        if (onStatus !== undefined) void onStatus(this.status)

        return () => {
            this.eventListeners.delete(onEvent)
            if (onStatus !== undefined) this.statusListeners.delete(onStatus)
        }
    }

    async emit(event: RealtimeEvent): Promise<void> {
        if (!this.connected) return
        await Promise.all([...this.eventListeners].map(listener => listener(event)))
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return
        this.connected = false
        await Promise.all([...this.statusListeners].map(listener => listener('disconnected')))
    }

    async reconnect(): Promise<void> {
        if (this.connected) return
        this.connected = true
        await Promise.all([...this.statusListeners].map(listener => listener('connected')))
    }
}

export interface FixtureRealtimeEnvironmentOptions {
    readonly now?: number
    readonly networkDelayMs?: number
}

export class FixtureRealtimeEnvironment {
    readonly events = new LocalRealtimeEventSource()
    readonly metrics = new RealtimeMetrics()
    readonly projectId: string
    readonly source: ProjectRealtimeDataSource

    private now: number
    private sequence = 0
    private nextFixtureNotificationNumber = 2
    private readonly networkDelayMs: number
    private readonly authoritativePublications = new Map<string, RealtimePublication>()
    private readonly visiblePublications = new Map<string, RealtimePublication>()
    private readonly authoritativeNotifications = new Map<string, RealtimeNotification>()
    private readonly visibleNotifications = new Map<string, RealtimeNotification>()
    private shouldFailNextNotificationWrite = false

    constructor(projectId: string, options: FixtureRealtimeEnvironmentOptions = {}) {
        this.projectId = projectId
        this.now = options.now ?? 1_700_000_000_000
        this.networkDelayMs = options.networkDelayMs ?? 0

        const publications = createFixturePublications(projectId, this.now)
        const notifications = createFixtureNotifications(projectId, publications, this.now)
        for (const publication of publications) {
            this.authoritativePublications.set(publication.id, publication)
            this.visiblePublications.set(publication.id, publication)
        }
        for (const notification of notifications) {
            this.authoritativeNotifications.set(notification.id, notification)
            this.visibleNotifications.set(notification.id, notification)
        }

        this.source = {
            listPublications: project => this.listPublications(project),
            listNotifications: project => this.listNotifications(project),
            markNotificationRead: (project, notificationId) =>
                this.markNotificationRead(project, notificationId),
        }
    }

    failNextNotificationWrite(): void {
        this.shouldFailNextNotificationWrite = true
    }

    async simulatePublicationStatusChange(
        state: RealtimePublicationState,
        projectionDelayMs = 0
    ): Promise<RealtimeEvent> {
        const publication = this.authoritativePublications.get(`${this.projectId}-publication-1`)
        if (publication === undefined) throw new Error('fixture publication is missing')

        const updatedAt = this.tick()
        const updated = { ...publication, state, updatedAt }
        this.authoritativePublications.set(publication.id, updated)
        const event: RealtimeEvent = {
            id: this.nextEventId(),
            projectId: this.projectId,
            sequence: this.sequence,
            entityId: publication.id,
            type: 'publication.status_changed',
            payload: { state },
        }

        this.projectLater(
            () => this.visiblePublications.set(publication.id, { ...updated }),
            projectionDelayMs
        )
        await this.events.emit(event)
        return event
    }

    async simulatePublicationUpdate(projectionDelayMs = 0): Promise<RealtimeEvent> {
        const publication = this.authoritativePublications.get(`${this.projectId}-publication-1`)
        if (publication === undefined) throw new Error('fixture publication is missing')

        const updatedAt = this.tick()
        const updated = {
            ...publication,
            postTitle: `${publication.postTitle ?? 'Publication'} · revised`,
            updatedAt,
        }
        this.authoritativePublications.set(publication.id, updated)
        const event: RealtimeEvent = {
            id: this.nextEventId(),
            projectId: this.projectId,
            sequence: this.sequence,
            entityId: publication.id,
            type: 'publication.updated',
            payload: { updatedAt },
        }

        this.projectLater(
            () => this.visiblePublications.set(publication.id, { ...updated }),
            projectionDelayMs
        )
        await this.events.emit(event)
        return event
    }

    async simulateNotificationCreated(projectionDelayMs = 0): Promise<RealtimeEvent> {
        const publication = this.authoritativePublications.get(`${this.projectId}-publication-1`)
        if (publication === undefined) throw new Error('fixture publication is missing')

        const createdAt = this.tick()
        const notification: RealtimeNotification = {
            id: `${this.projectId}-notification-${this.nextFixtureNotificationNumber}`,
            projectId: this.projectId,
            subjectType: 'publication',
            subjectId: publication.id,
            kind: 'publication_failed',
            severity: 'error',
            title: 'Publication needs attention',
            body: 'A remote worker reported a failed publication.',
            readAt: null,
            archivedAt: null,
            createdAt,
        }
        this.nextFixtureNotificationNumber += 1
        this.authoritativeNotifications.set(notification.id, notification)
        const event: RealtimeEvent = {
            id: this.nextEventId(),
            projectId: this.projectId,
            sequence: this.sequence,
            entityId: notification.id,
            type: 'notification.created',
            payload: { createdAt },
        }

        this.projectLater(
            () => this.visibleNotifications.set(notification.id, { ...notification }),
            projectionDelayMs
        )
        await this.events.emit(event)
        return event
    }

    async simulateNotificationRead(
        notificationId = `${this.projectId}-notification-1`,
        projectionDelayMs = 0
    ): Promise<RealtimeEvent> {
        const notification = this.authoritativeNotifications.get(notificationId)
        if (notification === undefined) throw new Error('fixture notification is missing')

        const readAt = this.tick()
        const updated = { ...notification, readAt }
        this.authoritativeNotifications.set(notification.id, updated)
        const event: RealtimeEvent = {
            id: this.nextEventId(),
            projectId: this.projectId,
            sequence: this.sequence,
            entityId: notification.id,
            type: 'notification.read',
            payload: { readAt },
        }

        this.projectLater(
            () => this.visibleNotifications.set(notification.id, { ...updated }),
            projectionDelayMs
        )
        await this.events.emit(event)
        return event
    }

    private async listPublications(projectId: string): Promise<readonly RealtimePublication[]> {
        this.assertProject(projectId)
        this.metrics.record('publicationReads')
        await wait(this.networkDelayMs)
        return [...this.visiblePublications.values()].map(publication => ({ ...publication }))
    }

    private async listNotifications(projectId: string): Promise<readonly RealtimeNotification[]> {
        this.assertProject(projectId)
        this.metrics.record('notificationReads')
        await wait(this.networkDelayMs)
        return [...this.visibleNotifications.values()].map(notification => ({ ...notification }))
    }

    private async markNotificationRead(
        projectId: string,
        notificationId: string
    ): Promise<RealtimeNotification> {
        this.assertProject(projectId)
        this.metrics.record('notificationWrites')
        await wait(this.networkDelayMs)
        if (this.shouldFailNextNotificationWrite) {
            this.shouldFailNextNotificationWrite = false
            throw new Error('fixture notification write failed')
        }

        const notification = this.authoritativeNotifications.get(notificationId)
        if (notification === undefined) throw new Error('fixture notification is missing')
        const updated = { ...notification, readAt: this.tick() }
        this.authoritativeNotifications.set(notification.id, updated)
        this.visibleNotifications.set(notification.id, updated)
        return { ...updated }
    }

    private assertProject(projectId: string): void {
        if (projectId !== this.projectId)
            throw new Error('fixture project boundary rejected request')
    }

    private tick(): number {
        this.now += 1_000
        return this.now
    }

    private nextEventId(): string {
        this.sequence += 1
        return `${this.projectId}-event-${this.sequence}`
    }

    private projectLater(project: () => void, delayMs: number): void {
        if (delayMs <= 0) {
            project()
            return
        }
        this.metrics.record('projectionWaits')
        setTimeout(project, delayMs)
    }
}

function createFixturePublications(projectId: string, now: number): readonly RealtimePublication[] {
    return [
        {
            id: `${projectId}-publication-1`,
            projectId,
            postId: `${projectId}-post-1`,
            channelId: `${projectId}-channel-linkedin`,
            channelName: 'LinkedIn',
            postTitle: 'Herald launch notes',
            state: 'scheduled',
            scheduledAt: now + 60 * 60 * 1_000,
            updatedAt: now,
        },
        {
            id: `${projectId}-publication-2`,
            projectId,
            postId: `${projectId}-post-1`,
            channelId: `${projectId}-channel-manual`,
            channelName: 'Editorial review',
            postTitle: 'Herald launch notes',
            state: 'published',
            scheduledAt: null,
            updatedAt: now - 2_000,
        },
    ]
}

function createFixtureNotifications(
    projectId: string,
    publications: readonly RealtimePublication[],
    now: number
): readonly RealtimeNotification[] {
    const publication = publications[0]
    if (publication === undefined) throw new Error('fixture publication is missing')

    return [
        {
            id: `${projectId}-notification-1`,
            projectId,
            subjectType: 'publication',
            subjectId: publication.id,
            kind: 'publication_failed',
            severity: 'error',
            title: 'Publication needs attention',
            body: 'The queue contains a publication that needs review.',
            readAt: null,
            archivedAt: null,
            createdAt: now - 500,
        },
    ]
}

export async function wait(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return
    await new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}
