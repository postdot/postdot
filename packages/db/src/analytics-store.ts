import {
    deliveryModes,
    DomainInvariantError,
    publicationStates,
    requireNonBlank,
    requireProjectTimeZone,
    requireTimestamp,
    type DeliveryMode,
    type PublicationState,
} from '@herald/core'

import type { HeraldDatabase } from './client'

const defaultFrom = 0
const maximumTimestamp = Number.MAX_SAFE_INTEGER

const executionActions = {
    claimed: 'publication.execution.claimed',
    effectStarted: 'publication.execution.effect_started',
    succeeded: 'publication.execution.succeeded',
    retryScheduled: 'publication.execution.retry_scheduled',
    failed: 'publication.execution.failed',
    ambiguous: 'publication.execution.ambiguous',
    claimRecovered: 'publication.execution.claim_recovered',
    ambiguityRecovered: 'publication.execution.ambiguity_recovered',
    cancelled: 'publication.execution.cancelled',
} as const

const publicationEventActions = {
    created: 'publication.created',
    published: 'publication.published',
    reconciled: 'publication.reconciled',
} as const

const publicationAnalyticsActions = new Set<string>([
    ...Object.values(publicationEventActions),
    ...Object.values(executionActions),
])

export interface AnalyticsRangeInput {
    readonly from?: number | null
    readonly to?: number | null
}

export interface ProjectAnalyticsInput extends AnalyticsRangeInput {
    readonly projectId: string
    readonly subjectId: string
}

export interface AnalyticsStateCount {
    readonly state: PublicationState
    readonly count: number
}

export interface AnalyticsDeliveryModeCount {
    readonly deliveryMode: DeliveryMode
    readonly count: number
}

export interface AnalyticsChannelInventory {
    readonly channelId: string
    readonly channelName: string
    readonly provider: string | null
    readonly total: number
    readonly byState: readonly AnalyticsStateCount[]
    readonly byDeliveryMode: readonly AnalyticsDeliveryModeCount[]
}

export interface AnalyticsPublicationInventory {
    readonly total: number
    readonly byState: readonly AnalyticsStateCount[]
    readonly byDeliveryMode: readonly AnalyticsDeliveryModeCount[]
    readonly byChannel: readonly AnalyticsChannelInventory[]
}

export interface AnalyticsEventCounts {
    readonly publicationsCreated: number
    readonly publicationsPublished: number
    readonly publicationsFailed: number
    readonly publicationsAmbiguous: number
    readonly executionClaims: number
    readonly executionAttempts: number
    readonly executionSucceeded: number
    readonly executionRetriesScheduled: number
    readonly executionFailed: number
    readonly executionAmbiguous: number
    readonly executionClaimRecoveries: number
    readonly executionAmbiguityRecoveries: number
    readonly executionCancelled: number
}

export interface AnalyticsDailyBucket {
    readonly date: string
    readonly publicationsCreated: number
    readonly publicationsPublished: number
    readonly publicationsFailed: number
    readonly publicationsAmbiguous: number
    readonly executionAttempts: number
    readonly executionRetriesScheduled: number
}

export interface ProjectAnalytics {
    readonly projectId: string
    readonly timeZone: string
    readonly range: {
        readonly from: number | null
        readonly to: number | null
    }
    readonly inventory: AnalyticsPublicationInventory
    readonly events: AnalyticsEventCounts
    readonly daily: readonly AnalyticsDailyBucket[]
}

interface ProjectAccessRow {
    readonly timeZone: string
}

interface PublicationInventoryRow {
    readonly state: PublicationState
    readonly deliveryMode: DeliveryMode
    readonly channelId: string
    readonly channelName: string
    readonly provider: string | null
}

interface PublicationEventRow {
    readonly action: string
    readonly occurredAt: number
    readonly metadataJson: string | null
}

interface MutableCountMap {
    [key: string]: number
}

interface MutableChannelInventory {
    readonly channelId: string
    readonly channelName: string
    readonly provider: string | null
    readonly states: MutableCountMap
    readonly deliveryModes: MutableCountMap
    total: number
}

interface MutableDailyBucket {
    readonly date: string
    publicationsCreated: number
    publicationsPublished: number
    publicationsFailed: number
    publicationsAmbiguous: number
    executionAttempts: number
    executionRetriesScheduled: number
}

export function createAnalyticsStore(database: HeraldDatabase) {
    const client = database.$client
    const projectAccessStatement = client.query<
        ProjectAccessRow,
        [projectId: string, subjectId: string]
    >(`
        select projects.time_zone as timeZone
        from projects
        inner join actors
            on actors.project_id = projects.id
           and actors.subject_id = ?2
           and actors.kind in ('human', 'agent', 'api_token')
        where projects.id = ?1
        limit 1
    `)
    const publicationInventoryStatement = client.query<
        PublicationInventoryRow,
        [projectId: string]
    >(`
        select publications.state,
               publications.delivery_mode as deliveryMode,
               channels.id as channelId,
               channels.name as channelName,
               publishers.kind as provider
        from publications
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        left join publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        where publications.project_id = ?1
        order by channels.created_at, channels.id, publications.created_at, publications.id
    `)
    const publicationEventsStatement = client.query<
        PublicationEventRow,
        [projectId: string, from: number, to: number]
    >(`
        select action,
               created_at as occurredAt,
               metadata_json as metadataJson
        from audit_events
        where project_id = ?1
          and entity_type = 'publication'
          and created_at >= ?2
          and created_at < ?3
        order by created_at, sequence
    `)

    return {
        getProjectAnalytics(input: ProjectAnalyticsInput): ProjectAnalytics | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const project = projectAccessStatement.get(projectId, subjectId)
            if (project === null) return null

            const range = normalizeRange(input)
            const timeZone = requireProjectTimeZone(project.timeZone)
            const inventory = buildInventory(publicationInventoryStatement.all(projectId))
            const eventRows = publicationEventsStatement.all(projectId, range.from, range.to)
            const events = createEventCounts()
            const daily = new Map<string, MutableDailyBucket>()

            for (const row of eventRows) {
                if (!publicationAnalyticsActions.has(row.action)) continue
                const bucket = getDailyBucket(daily, toLocalDate(row.occurredAt, timeZone))
                const metadata = parseMetadata(row.metadataJson, row.action)
                recordEvent(events, bucket, row.action, metadata)
            }

            return {
                projectId,
                timeZone,
                range: {
                    from: input.from === undefined || input.from === null ? null : range.from,
                    to: input.to === undefined || input.to === null ? null : range.to,
                },
                inventory,
                events,
                daily: [...daily.values()],
            }
        },
    }
}

export type AnalyticsStore = ReturnType<typeof createAnalyticsStore>

function normalizeRange(input: AnalyticsRangeInput): {
    readonly from: number
    readonly to: number
} {
    const from =
        input.from === undefined || input.from === null
            ? defaultFrom
            : requireTimestamp(input.from, 'analytics from')
    const to =
        input.to === undefined || input.to === null
            ? maximumTimestamp
            : requireTimestamp(input.to, 'analytics to')
    if (to < from) {
        throw new DomainInvariantError(
            'invalid_time',
            'analytics to must not precede analytics from'
        )
    }
    return { from, to }
}

function buildInventory(rows: readonly PublicationInventoryRow[]): AnalyticsPublicationInventory {
    const byState = createCountMap(publicationStates)
    const byDeliveryMode = createCountMap(deliveryModes)
    const byChannel = new Map<string, MutableChannelInventory>()

    for (const row of rows) {
        increment(byState, row.state)
        increment(byDeliveryMode, row.deliveryMode)

        const key = `${row.channelId}\u0000${row.provider ?? ''}`
        const channel = byChannel.get(key) ?? {
            channelId: row.channelId,
            channelName: row.channelName,
            provider: row.provider,
            states: createCountMap(publicationStates),
            deliveryModes: createCountMap(deliveryModes),
            total: 0,
        }
        channel.total += 1
        increment(channel.states, row.state)
        increment(channel.deliveryModes, row.deliveryMode)
        byChannel.set(key, channel)
    }

    return {
        total: rows.length,
        byState: toStateCounts(byState),
        byDeliveryMode: toDeliveryModeCounts(byDeliveryMode),
        byChannel: [...byChannel.values()].map(channel => ({
            channelId: channel.channelId,
            channelName: channel.channelName,
            provider: channel.provider,
            total: channel.total,
            byState: toStateCounts(channel.states),
            byDeliveryMode: toDeliveryModeCounts(channel.deliveryModes),
        })),
    }
}

function createCountMap<const Keys extends readonly string[]>(keys: Keys): MutableCountMap {
    return Object.fromEntries(keys.map(key => [key, 0]))
}

function toStateCounts(counts: MutableCountMap): readonly AnalyticsStateCount[] {
    return publicationStates.map(state => ({ state, count: counts[state] ?? 0 }))
}

function toDeliveryModeCounts(counts: MutableCountMap): readonly AnalyticsDeliveryModeCount[] {
    return deliveryModes.map(deliveryMode => ({
        deliveryMode,
        count: counts[deliveryMode] ?? 0,
    }))
}

function increment(counts: MutableCountMap, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1
}

function createEventCounts(): {
    publicationsCreated: number
    publicationsPublished: number
    publicationsFailed: number
    publicationsAmbiguous: number
    executionClaims: number
    executionAttempts: number
    executionSucceeded: number
    executionRetriesScheduled: number
    executionFailed: number
    executionAmbiguous: number
    executionClaimRecoveries: number
    executionAmbiguityRecoveries: number
    executionCancelled: number
} {
    return {
        publicationsCreated: 0,
        publicationsPublished: 0,
        publicationsFailed: 0,
        publicationsAmbiguous: 0,
        executionClaims: 0,
        executionAttempts: 0,
        executionSucceeded: 0,
        executionRetriesScheduled: 0,
        executionFailed: 0,
        executionAmbiguous: 0,
        executionClaimRecoveries: 0,
        executionAmbiguityRecoveries: 0,
        executionCancelled: 0,
    }
}

function recordEvent(
    counts: ReturnType<typeof createEventCounts>,
    bucket: MutableDailyBucket,
    action: string,
    metadata: Readonly<Record<string, unknown>>
): void {
    switch (action) {
        case publicationEventActions.created:
            counts.publicationsCreated += 1
            bucket.publicationsCreated += 1
            return
        case publicationEventActions.published:
            counts.publicationsPublished += 1
            bucket.publicationsPublished += 1
            return
        case publicationEventActions.reconciled:
            if (metadata.toState === 'published') {
                counts.publicationsPublished += 1
                bucket.publicationsPublished += 1
            } else if (metadata.toState === 'failed') {
                counts.publicationsFailed += 1
                bucket.publicationsFailed += 1
            }
            return
        case executionActions.claimed:
            counts.executionClaims += 1
            return
        case executionActions.effectStarted:
            counts.executionAttempts += 1
            bucket.executionAttempts += 1
            return
        case executionActions.succeeded:
            counts.executionSucceeded += 1
            counts.publicationsPublished += 1
            bucket.publicationsPublished += 1
            return
        case executionActions.retryScheduled:
            counts.executionRetriesScheduled += 1
            bucket.executionRetriesScheduled += 1
            return
        case executionActions.failed:
            counts.executionFailed += 1
            counts.publicationsFailed += 1
            bucket.publicationsFailed += 1
            return
        case executionActions.ambiguous:
            counts.executionAmbiguous += 1
            counts.publicationsAmbiguous += 1
            bucket.publicationsAmbiguous += 1
            return
        case executionActions.claimRecovered:
            counts.executionClaimRecoveries += 1
            return
        case executionActions.ambiguityRecovered:
            counts.executionAmbiguityRecoveries += 1
            counts.publicationsAmbiguous += 1
            bucket.publicationsAmbiguous += 1
            return
        case executionActions.cancelled:
            counts.executionCancelled += 1
            return
        default:
            throw new DomainInvariantError(
                'invalid_content',
                `Unsupported analytics event action: ${action}`
            )
    }
}

function getDailyBucket(daily: Map<string, MutableDailyBucket>, date: string): MutableDailyBucket {
    const existing = daily.get(date)
    if (existing !== undefined) return existing

    const created: MutableDailyBucket = {
        date,
        publicationsCreated: 0,
        publicationsPublished: 0,
        publicationsFailed: 0,
        publicationsAmbiguous: 0,
        executionAttempts: 0,
        executionRetriesScheduled: 0,
    }
    daily.set(date, created)
    return created
}

function parseMetadata(
    metadataJson: string | null,
    action: string
): Readonly<Record<string, unknown>> {
    if (metadataJson === null) return {}

    let parsed: unknown
    try {
        parsed = JSON.parse(metadataJson)
    } catch {
        throw new DomainInvariantError(
            'invalid_content',
            `Analytics event ${action} contains invalid metadata`
        )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new DomainInvariantError(
            'invalid_content',
            `Analytics event ${action} metadata must be an object`
        )
    }
    return parsed as Readonly<Record<string, unknown>>
}

function toLocalDate(timestamp: number, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(timestamp))
    const values = new Map(parts.map(part => [part.type, part.value]))
    return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}
