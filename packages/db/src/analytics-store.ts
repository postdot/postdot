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

const analyticsContractVersion = 1
const supportedEventVersion = 1
const defaultRangeDurationMs = 30 * 24 * 60 * 60 * 1_000
const maximumRangeDurationMs = 366 * 24 * 60 * 60 * 1_000
const unknownDimensionDeliveryMode = 'unknown' as const

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
    targetPromoted: 'publication.target_promoted',
    ready: 'publication.ready',
    published: 'publication.published',
    reconciled: 'publication.reconciled',
} as const

const historicalActions = new Set<string>([
    ...Object.values(publicationEventActions),
    ...Object.values(executionActions),
])

export interface AnalyticsRangeInput {
    readonly from?: number | null
    readonly to?: number | null
}

export interface AnalyticsFiltersInput {
    readonly channelId?: string | null
    readonly provider?: string | null
    readonly deliveryMode?: DeliveryMode | null
}

export interface ProjectAnalyticsInput extends AnalyticsRangeInput, AnalyticsFiltersInput {
    readonly projectId: string
    readonly subjectId: string
}

export interface AnalyticsStoreOptions {
    readonly now?: () => number
}

export type AnalyticsDimensionDeliveryMode = DeliveryMode | typeof unknownDimensionDeliveryMode

export interface AnalyticsDimension {
    readonly channelId: string | null
    readonly channelName: string | null
    readonly provider: string
    readonly deliveryMode: AnalyticsDimensionDeliveryMode
}

export interface AnalyticsDimensionCount extends AnalyticsDimension {
    readonly count: number
}

export interface AnalyticsStateCount {
    readonly state: PublicationState
    readonly count: number
}

export interface AnalyticsDeliveryModeCount {
    readonly deliveryMode: DeliveryMode
    readonly count: number
}

export interface AnalyticsPublicationInventory {
    readonly total: number
    readonly byState: readonly AnalyticsStateCount[]
    readonly byDeliveryMode: readonly AnalyticsDeliveryModeCount[]
    readonly byDimension: readonly AnalyticsDimensionCount[]
}

export interface AnalyticsCurrentExecutionSnapshot {
    readonly scheduled: number
    readonly due: number
    readonly running: number
    readonly retryablePending: number
    readonly succeeded: number
    readonly failed: number
    readonly ambiguous: number
}

export interface AnalyticsCurrentWorkloadSnapshot {
    readonly manualDue: number
    readonly ambiguousReconciliation: number
    readonly oldestDueAt: number | null
    readonly nextRunAt: number | null
    readonly futureScheduled: number
    readonly overdue: number
}

export interface AnalyticsCurrentSnapshot {
    readonly publications: AnalyticsPublicationInventory
    readonly executions: AnalyticsCurrentExecutionSnapshot
    readonly workload: AnalyticsCurrentWorkloadSnapshot
}

export interface AnalyticsLifecycleTransitions {
    readonly total: number
    readonly byState: readonly AnalyticsStateCount[]
    readonly byDimension: readonly AnalyticsDimensionCount[]
}

export interface AnalyticsPublicationDimensionMetrics {
    readonly created: readonly AnalyticsDimensionCount[]
    readonly published: readonly AnalyticsDimensionCount[]
    readonly failed: readonly AnalyticsDimensionCount[]
    readonly ambiguous: readonly AnalyticsDimensionCount[]
}

export interface AnalyticsHistoricalPublicationMetrics {
    readonly created: number
    readonly published: number
    readonly failed: number
    readonly ambiguous: number
    readonly lifecycleTransitions: AnalyticsLifecycleTransitions
    readonly byDimension: AnalyticsPublicationDimensionMetrics
}

export interface AnalyticsExecutionDimensionMetrics {
    readonly claimed: readonly AnalyticsDimensionCount[]
    readonly attempts: readonly AnalyticsDimensionCount[]
    readonly succeeded: readonly AnalyticsDimensionCount[]
    readonly failed: readonly AnalyticsDimensionCount[]
    readonly retryable: readonly AnalyticsDimensionCount[]
    readonly ambiguous: readonly AnalyticsDimensionCount[]
    readonly directAmbiguous: readonly AnalyticsDimensionCount[]
    readonly claimRecoveries: readonly AnalyticsDimensionCount[]
    readonly ambiguityRecoveries: readonly AnalyticsDimensionCount[]
    readonly cancelled: readonly AnalyticsDimensionCount[]
}

export interface AnalyticsHistoricalExecutionMetrics {
    readonly claimed: number
    readonly attempts: number
    readonly succeeded: number
    readonly failed: number
    readonly retryable: number
    readonly ambiguous: number
    readonly directAmbiguous: number
    readonly claimRecoveries: number
    readonly ambiguityRecoveries: number
    readonly cancelled: number
    readonly byDimension: AnalyticsExecutionDimensionMetrics
}

export interface AnalyticsRetryMetrics {
    readonly scheduled: number
    readonly rate: number | null
    readonly attemptsPerPublication: number | null
}

export interface AnalyticsLatencySummary {
    readonly count: number
    readonly totalMs: number
    readonly minMs: number
    readonly maxMs: number
    readonly averageMs: number
}

export interface AnalyticsHistoricalLatencyMetrics {
    readonly queueDelay: AnalyticsLatencySummary | null
    readonly effectDuration: AnalyticsLatencySummary | null
    readonly scheduledToOutcome: AnalyticsLatencySummary | null
    readonly manualCompletion: AnalyticsLatencySummary | null
}

export interface AnalyticsBucketMetrics {
    readonly publicationsCreated: number
    readonly publicationsPublished: number
    readonly publicationsFailed: number
    readonly publicationsAmbiguous: number
    readonly publicationLifecycleTransitions: number
    readonly executionClaimed: number
    readonly executionAttempts: number
    readonly executionSucceeded: number
    readonly executionFailed: number
    readonly executionRetryable: number
    readonly executionAmbiguous: number
    readonly executionClaimRecoveries: number
    readonly executionAmbiguityRecoveries: number
    readonly executionCancelled: number
}

export interface AnalyticsBucketDimension extends AnalyticsDimension {
    readonly metrics: AnalyticsBucketMetrics
}

type MutableBucketMetrics = {
    -readonly [Key in keyof AnalyticsBucketMetrics]: number
}

export interface AnalyticsDailyBucket {
    readonly bucketDate: string
    readonly bucketStartUtc: number
    readonly bucketEndUtc: number
    readonly metrics: AnalyticsBucketMetrics
    readonly dimensions: readonly AnalyticsBucketDimension[]
}

export interface AnalyticsDataQuality {
    readonly unknownEventVersions: number
    readonly unsupportedFacts: number
    readonly invalidMetadata: number
    readonly missingLifecycleState: number
    readonly missingAttemptMetadata: number
    readonly missingHistoricalDimensions: number
    readonly incompleteLatencyPairs: number
    readonly incompleteQueueDelayPairs: number
    readonly contradictoryAttempts: number
    readonly duplicateFacts: number
    readonly duplicateAttemptFacts: number
}

export interface AnalyticsCoverage {
    readonly supportedFactVersions: readonly number[]
    readonly skippedFactCount: number
    readonly dataQuality: AnalyticsDataQuality
}

export interface ProjectAnalytics {
    readonly contractVersion: number
    readonly projectId: string
    readonly projectTimeZone: string
    readonly observedAt: number
    readonly range: {
        readonly from: number
        readonly to: number
    }
    readonly current: AnalyticsCurrentSnapshot
    readonly historical: {
        readonly publications: AnalyticsHistoricalPublicationMetrics
        readonly executions: AnalyticsHistoricalExecutionMetrics
        readonly retries: AnalyticsRetryMetrics
        readonly latency: AnalyticsHistoricalLatencyMetrics
        readonly buckets: readonly AnalyticsDailyBucket[]
    }
    readonly coverage: AnalyticsCoverage
}

interface ProjectAccessRow {
    readonly timeZone: string
}

interface PublicationInventoryRow {
    readonly id: string
    readonly state: PublicationState
    readonly deliveryMode: DeliveryMode
    readonly scheduledAt: number | null
    readonly channelId: string
    readonly channelName: string
    readonly provider: string | null
    readonly hasExecutionHistory: number
}

interface CurrentJobRow {
    readonly id: string
    readonly state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    readonly runAt: number
    readonly publicationState: PublicationState
    readonly deliveryMode: DeliveryMode
    readonly channelId: string
    readonly channelName: string
    readonly provider: string | null
}

interface HistoricalFactRow {
    readonly id: string
    readonly sequence: number
    readonly action: string
    readonly eventVersion: number
    readonly entityId: string
    readonly metadataJson: string | null
    readonly occurredAt: number
    readonly channelId: string | null
    readonly channelName: string | null
    readonly deliveryMode: DeliveryMode | null
}

interface AnalyticsFilters {
    readonly channelId?: string
    readonly provider?: string
    readonly deliveryMode?: DeliveryMode
}

interface MutableCountMap {
    [key: string]: number
}

interface MutableDimensionCount {
    readonly dimension: AnalyticsDimension
    count: number
}

type HistoricalDimensionMetric =
    | 'publicationCreated'
    | 'publicationPublished'
    | 'publicationFailed'
    | 'publicationAmbiguous'
    | 'lifecycleTransitions'
    | 'executionClaimed'
    | 'executionAttempts'
    | 'executionSucceeded'
    | 'executionFailed'
    | 'executionRetryable'
    | 'executionAmbiguous'
    | 'executionDirectAmbiguous'
    | 'executionClaimRecoveries'
    | 'executionAmbiguityRecoveries'
    | 'executionCancelled'

type BucketMetricName = keyof AnalyticsBucketMetrics

interface MutableLatencySummary {
    count: number
    totalMs: number
    minMs: number
    maxMs: number
}

interface MutableBucketDimension {
    readonly dimension: AnalyticsDimension
    readonly metrics: MutableBucketMetrics
}

interface MutableBucket {
    readonly bucketDate: string
    readonly bucketStartUtc: number
    readonly bucketEndUtc: number
    readonly metrics: MutableBucketMetrics
    readonly dimensions: Map<string, MutableBucketDimension>
}

interface MutableCoverage {
    unknownEventVersions: number
    unsupportedFacts: number
    invalidMetadata: number
    missingLifecycleState: number
    missingAttemptMetadata: number
    missingHistoricalDimensions: number
    incompleteLatencyPairs: number
    incompleteQueueDelayPairs: number
    contradictoryAttempts: number
    duplicateFacts: number
    duplicateAttemptFacts: number
    skippedFactCount: number
}

interface AttemptFact {
    readonly occurredAt: number
    readonly dimension: AnalyticsDimension
    readonly runAt: number | null
}

interface AttemptOutcome {
    readonly action: string
    readonly occurredAt: number
    readonly dimension: AnalyticsDimension
    readonly targetState: PublicationState | null
    readonly row: HistoricalFactRow
}

interface MutableAttempt {
    readonly publicationId: string
    readonly actions: Set<string>
    dimension: AnalyticsDimension
    included: boolean
    effectStarted: AttemptFact | undefined
    outcome: AttemptOutcome | undefined
    contradictory: boolean
}

interface SchedulePoint {
    readonly scheduledAt: number
}

interface HistoricalAccumulator {
    created: number
    published: number
    failed: number
    ambiguous: number
    lifecycleTotal: number
    lifecycleByState: MutableCountMap
    executionClaimed: number
    executionAttempts: number
    executionSucceeded: number
    executionFailed: number
    executionRetryable: number
    executionAmbiguous: number
    executionDirectAmbiguous: number
    executionClaimRecoveries: number
    executionAmbiguityRecoveries: number
    executionCancelled: number
    dimensionMetrics: Map<HistoricalDimensionMetric, Map<string, MutableDimensionCount>>
    buckets: Map<string, MutableBucket>
    attempts: Map<string, MutableAttempt>
    schedules: Map<string, SchedulePoint>
    createdPublications: Set<string>
    publishedPublications: Set<string>
    seenFactIds: Set<string>
    latency: {
        readonly queueDelay: MutableLatencySummary
        readonly effectDuration: MutableLatencySummary
        readonly scheduledToOutcome: MutableLatencySummary
        readonly manualCompletion: MutableLatencySummary
    }
    coverage: MutableCoverage
}

export function createAnalyticsStore(
    database: HeraldDatabase,
    options: AnalyticsStoreOptions = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const projectAccessStatement = client.query<
        ProjectAccessRow,
        [projectId: string, subjectId: string]
    >(
        String.raw`
        select projects.time_zone as timeZone
        from projects
        inner join actors
            on actors.project_id = projects.id
           and actors.subject_id = ?2
           and actors.kind in ('human', 'agent', 'api_token')
        where projects.id = ?1
        limit 1
    `
    )
    const publicationInventoryStatement = client.query<
        PublicationInventoryRow,
        [projectId: string]
    >(
        String.raw`
        select publications.id,
               publications.state,
               publications.delivery_mode as deliveryMode,
               publications.scheduled_at as scheduledAt,
               channels.id as channelId,
               channels.name as channelName,
               publishers.kind as provider,
               case when exists (
                   select 1
                   from audit_events
                   where audit_events.project_id = publications.project_id
                     and audit_events.entity_type = 'publication'
                     and audit_events.entity_id = publications.id
                     and audit_events.action in (
                         'publication.execution.effect_started',
                         'publication.execution.succeeded',
                         'publication.execution.retry_scheduled',
                         'publication.execution.failed',
                         'publication.execution.ambiguous',
                         'publication.execution.ambiguity_recovered'
                     )
               ) then 1 else 0 end as hasExecutionHistory
        from publications
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        left join publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        where publications.project_id = ?1
        order by channels.created_at, channels.id, publications.created_at, publications.id
    `
    )
    const currentJobsStatement = client.query<CurrentJobRow, [projectId: string]>(
        String.raw`
        select jobs.id,
               jobs.state,
               jobs.run_at as runAt,
               publications.state as publicationState,
               publications.delivery_mode as deliveryMode,
               channels.id as channelId,
               channels.name as channelName,
               publishers.kind as provider
        from jobs
        inner join publications
            on publications.project_id = jobs.project_id
           and publications.id = jobs.publication_id
        inner join channels
            on channels.project_id = publications.project_id
           and channels.id = publications.channel_id
        left join publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
        where jobs.project_id = ?1
        order by jobs.run_at, jobs.id
    `
    )
    const currentRetryablePendingStatement = client.query<
        { id: string },
        [projectId: string, eventVersion: number]
    >(
        String.raw`
        select jobs.id
        from jobs
        where jobs.project_id = ?1
          and jobs.state = 'pending'
          and (
              select audit_events.action
              from audit_events
              where audit_events.project_id = jobs.project_id
                and audit_events.entity_type = 'publication'
                and audit_events.entity_id = jobs.publication_id
                and audit_events.event_version = ?2
                and audit_events.action in (
                    'publication.execution.claimed',
                    'publication.execution.effect_started',
                    'publication.execution.retry_scheduled',
                    'publication.execution.failed',
                    'publication.execution.succeeded',
                    'publication.execution.ambiguous',
                    'publication.execution.claim_recovered',
                    'publication.execution.ambiguity_recovered',
                    'publication.execution.cancelled'
                )
                and json_extract(audit_events.metadata_json, '$.jobId') = jobs.id
              order by audit_events.sequence desc
              limit 1
          ) = 'publication.execution.retry_scheduled'
        order by jobs.run_at, jobs.id
    `
    )
    const historicalFactsStatement = client.query<
        HistoricalFactRow,
        [projectId: string, from: number, to: number]
    >(
        String.raw`
        select audit_events.id,
               audit_events.sequence,
               audit_events.action,
               audit_events.event_version as eventVersion,
               audit_events.entity_id as entityId,
               audit_events.metadata_json as metadataJson,
               audit_events.created_at as occurredAt,
               publications.channel_id as channelId,
               channels.name as channelName,
               publications.delivery_mode as deliveryMode
        from audit_events
        left join publications
            on publications.project_id = audit_events.project_id
           and publications.id = audit_events.entity_id
        left join channels
            on channels.project_id = audit_events.project_id
           and channels.id = publications.channel_id
        where audit_events.project_id = ?1
          and audit_events.entity_type = 'publication'
          and audit_events.created_at >= ?2
          and audit_events.created_at < ?3
        order by audit_events.created_at, audit_events.sequence
    `
    )

    return {
        getProjectAnalytics(input: ProjectAnalyticsInput): ProjectAnalytics | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const project = projectAccessStatement.get(projectId, subjectId)
            if (project === null) return null

            const observedAt = requireTimestamp(now(), 'analytics observedAt')
            const range = normalizeRange(input, observedAt)
            const filters = normalizeFilters(input)
            const projectTimeZone = requireProjectTimeZone(project.timeZone)
            const publicationRows = publicationInventoryStatement.all(projectId)
            const jobRows = currentJobsStatement.all(projectId)
            const retryablePendingIds = new Set(
                currentRetryablePendingStatement
                    .all(projectId, supportedEventVersion)
                    .map(row => row.id)
            )
            const current = buildCurrentSnapshot(
                publicationRows,
                jobRows,
                retryablePendingIds,
                observedAt,
                filters
            )
            const history = buildHistoricalMetrics(
                // SQLite yields one historical fact at a time. The accumulator retains only the
                // bounded deduplication and latency-pair state required by this read model.
                historicalFactsStatement.iterate(projectId, range.from, range.to),
                projectTimeZone,
                filters
            )

            return {
                contractVersion: analyticsContractVersion,
                projectId,
                projectTimeZone,
                observedAt,
                range,
                current,
                historical: history.historical,
                coverage: history.coverage,
            }
        },
    }
}

export type AnalyticsStore = ReturnType<typeof createAnalyticsStore>

function normalizeRange(
    input: AnalyticsRangeInput,
    observedAt: number
): { readonly from: number; readonly to: number } {
    const hasFrom = input.from !== undefined && input.from !== null
    const hasTo = input.to !== undefined && input.to !== null
    const to = hasTo ? requireTimestamp(input.to as number, 'analytics to') : observedAt
    if (to > observedAt) {
        throw new DomainInvariantError(
            'invalid_time',
            'analytics to must not be later than the observed time'
        )
    }
    const from = hasFrom
        ? requireTimestamp(input.from as number, 'analytics from')
        : Math.max(0, to - defaultRangeDurationMs)
    if (to < from) {
        throw new DomainInvariantError(
            'invalid_time',
            'analytics to must not precede analytics from'
        )
    }
    if (to - from > maximumRangeDurationMs) {
        throw new DomainInvariantError(
            'invalid_time',
            'analytics range must not be longer than 366 days'
        )
    }
    return { from, to }
}

function normalizeFilters(input: AnalyticsFiltersInput): AnalyticsFilters {
    const channelId =
        input.channelId === undefined || input.channelId === null
            ? undefined
            : requireNonBlank(input.channelId, 'analytics channelId')
    const provider =
        input.provider === undefined || input.provider === null
            ? undefined
            : requireNonBlank(input.provider, 'analytics provider')
    const deliveryMode =
        input.deliveryMode === undefined || input.deliveryMode === null
            ? undefined
            : input.deliveryMode
    if (deliveryMode !== undefined && !deliveryModes.includes(deliveryMode)) {
        throw new DomainInvariantError(
            'invalid_input',
            'analytics deliveryMode must be manual or automatic'
        )
    }
    return { channelId, provider, deliveryMode }
}

function buildCurrentSnapshot(
    publicationRows: readonly PublicationInventoryRow[],
    jobRows: readonly CurrentJobRow[],
    retryablePendingIds: ReadonlySet<string>,
    observedAt: number,
    filters: AnalyticsFilters
): AnalyticsCurrentSnapshot {
    const filteredPublications = publicationRows.filter(row =>
        matchesFilters(currentDimension(row), filters)
    )
    const publications = buildPublicationInventory(filteredPublications)
    const automaticJobs = jobRows.filter(
        row => row.deliveryMode === 'automatic' && matchesFilters(currentDimension(row), filters)
    )
    const pendingJobs = automaticJobs.filter(row => row.state === 'pending')
    const currentAmbiguous = filteredPublications.filter(
        row =>
            row.deliveryMode === 'automatic' &&
            row.state === 'ambiguous' &&
            row.hasExecutionHistory === 1
    ).length

    return {
        publications,
        executions: {
            scheduled: pendingJobs.length,
            due: pendingJobs.filter(row => row.runAt <= observedAt).length,
            running: automaticJobs.filter(row => row.state === 'running').length,
            retryablePending: pendingJobs.filter(row => retryablePendingIds.has(row.id)).length,
            succeeded: automaticJobs.filter(
                row => row.state === 'succeeded' && row.publicationState === 'published'
            ).length,
            failed: automaticJobs.filter(
                row => row.state === 'failed' && row.publicationState === 'failed'
            ).length,
            ambiguous: currentAmbiguous,
        },
        workload: {
            manualDue: filteredPublications.filter(
                row =>
                    row.deliveryMode === 'manual' &&
                    row.state === 'scheduled' &&
                    row.scheduledAt !== null &&
                    row.scheduledAt <= observedAt
            ).length,
            ambiguousReconciliation: currentAmbiguous,
            oldestDueAt: minimumTimestamp(pendingJobs.filter(row => row.runAt <= observedAt)),
            nextRunAt: minimumTimestamp(pendingJobs),
            futureScheduled: pendingJobs.filter(row => row.runAt > observedAt).length,
            overdue: pendingJobs.filter(row => row.runAt <= observedAt).length,
        },
    }
}

function buildPublicationInventory(
    rows: readonly PublicationInventoryRow[]
): AnalyticsPublicationInventory {
    const byState = createCountMap(publicationStates)
    const byDeliveryMode = createCountMap(deliveryModes)
    const byDimension = new Map<string, MutableDimensionCount>()

    for (const row of rows) {
        increment(byState, row.state)
        increment(byDeliveryMode, row.deliveryMode)
        incrementDimension(byDimension, currentDimension(row))
    }

    return {
        total: rows.length,
        byState: publicationStates.map(state => ({
            state,
            count: byState[state] ?? 0,
        })),
        byDeliveryMode: deliveryModes.map(deliveryMode => ({
            deliveryMode,
            count: byDeliveryMode[deliveryMode] ?? 0,
        })),
        byDimension: toDimensionCounts(byDimension),
    }
}

function buildHistoricalMetrics(
    rows: Iterable<HistoricalFactRow>,
    timeZone: string,
    filters: AnalyticsFilters
): {
    readonly historical: ProjectAnalytics['historical']
    readonly coverage: AnalyticsCoverage
} {
    const accumulator = createHistoricalAccumulator()

    for (const row of rows) {
        if (accumulator.seenFactIds.has(row.id)) {
            accumulator.coverage.duplicateFacts += 1
            continue
        }
        accumulator.seenFactIds.add(row.id)

        if (row.eventVersion !== supportedEventVersion) {
            accumulator.coverage.unknownEventVersions += 1
            accumulator.coverage.skippedFactCount += 1
            continue
        }
        if (!historicalActions.has(row.action)) {
            accumulator.coverage.unsupportedFacts += 1
            accumulator.coverage.skippedFactCount += 1
            continue
        }

        const metadataResult = parseMetadata(row.metadataJson)
        if (!metadataResult.ok) accumulator.coverage.invalidMetadata += 1
        const metadata = metadataResult.metadata
        const dimension = deriveHistoricalDimension(row, metadata, row.action, accumulator.coverage)
        const included = matchesFilters(dimension, filters)

        switch (row.action) {
            case publicationEventActions.created:
                recordPublicationCreated(accumulator, row, metadata, dimension, included, timeZone)
                break
            case publicationEventActions.targetPromoted:
                recordTargetPromotion(accumulator, row, metadata, dimension, included, timeZone)
                break
            case publicationEventActions.ready:
                recordPublicationReady(accumulator, row, metadata, dimension, included, timeZone)
                break
            case publicationEventActions.published:
                recordPublicationPublished(
                    accumulator,
                    row,
                    metadata,
                    dimension,
                    included,
                    timeZone
                )
                break
            case publicationEventActions.reconciled:
                recordReconciliation(accumulator, row, metadata, dimension, included, timeZone)
                break
            case executionActions.claimed:
                recordClaim(accumulator, row, metadata, dimension, included, timeZone)
                break
            case executionActions.effectStarted:
                recordEffectStarted(accumulator, row, metadata, dimension, included, timeZone)
                break
            case executionActions.succeeded:
            case executionActions.retryScheduled:
            case executionActions.failed:
            case executionActions.ambiguous:
            case executionActions.ambiguityRecovered:
            case executionActions.cancelled:
                recordExecutionOutcome(accumulator, row, metadata, dimension, included)
                break
            case executionActions.claimRecovered:
                recordClaimRecovery(accumulator, row, metadata, dimension, included, timeZone)
                break
        }
    }

    finalizeExecutionOutcomes(accumulator, timeZone)
    finalizeAttemptLatencies(accumulator)
    return {
        historical: toHistoricalMetrics(accumulator),
        coverage: {
            supportedFactVersions: [supportedEventVersion],
            skippedFactCount: accumulator.coverage.skippedFactCount,
            dataQuality: {
                unknownEventVersions: accumulator.coverage.unknownEventVersions,
                unsupportedFacts: accumulator.coverage.unsupportedFacts,
                invalidMetadata: accumulator.coverage.invalidMetadata,
                missingLifecycleState: accumulator.coverage.missingLifecycleState,
                missingAttemptMetadata: accumulator.coverage.missingAttemptMetadata,
                missingHistoricalDimensions: accumulator.coverage.missingHistoricalDimensions,
                incompleteLatencyPairs: accumulator.coverage.incompleteLatencyPairs,
                incompleteQueueDelayPairs: accumulator.coverage.incompleteQueueDelayPairs,
                contradictoryAttempts: accumulator.coverage.contradictoryAttempts,
                duplicateFacts: accumulator.coverage.duplicateFacts,
                duplicateAttemptFacts: accumulator.coverage.duplicateAttemptFacts,
            },
        },
    }
}

function createHistoricalAccumulator(): HistoricalAccumulator {
    return {
        created: 0,
        published: 0,
        failed: 0,
        ambiguous: 0,
        lifecycleTotal: 0,
        lifecycleByState: createCountMap(publicationStates),
        executionClaimed: 0,
        executionAttempts: 0,
        executionSucceeded: 0,
        executionFailed: 0,
        executionRetryable: 0,
        executionAmbiguous: 0,
        executionDirectAmbiguous: 0,
        executionClaimRecoveries: 0,
        executionAmbiguityRecoveries: 0,
        executionCancelled: 0,
        dimensionMetrics: new Map(),
        buckets: new Map(),
        attempts: new Map(),
        schedules: new Map(),
        createdPublications: new Set(),
        publishedPublications: new Set(),
        seenFactIds: new Set(),
        latency: {
            queueDelay: createLatencySummary(),
            effectDuration: createLatencySummary(),
            scheduledToOutcome: createLatencySummary(),
            manualCompletion: createLatencySummary(),
        },
        coverage: {
            unknownEventVersions: 0,
            unsupportedFacts: 0,
            invalidMetadata: 0,
            missingLifecycleState: 0,
            missingAttemptMetadata: 0,
            missingHistoricalDimensions: 0,
            incompleteLatencyPairs: 0,
            incompleteQueueDelayPairs: 0,
            contradictoryAttempts: 0,
            duplicateFacts: 0,
            duplicateAttemptFacts: 0,
            skippedFactCount: 0,
        },
    }
}

function recordPublicationCreated(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const state = readState(metadata.state)
    if (hasProperty(metadata, 'scheduledAt')) {
        const scheduledAt = readOptionalTimestamp(metadata, 'scheduledAt')
        setSchedule(accumulator, row.entityId, scheduledAt)
        if (state === 'scheduled' && scheduledAt === null) {
            accumulator.coverage.incompleteLatencyPairs += 1
        }
    } else if (state === 'scheduled') {
        accumulator.coverage.incompleteLatencyPairs += 1
    }
    if (state === null) accumulator.coverage.missingLifecycleState += 1
    if (!included || accumulator.createdPublications.has(row.entityId)) return

    accumulator.createdPublications.add(row.entityId)
    accumulator.created += 1
    recordDimensionMetric(accumulator, 'publicationCreated', dimension)
    recordBucketMetric(accumulator, row.occurredAt, timeZone, dimension, 'publicationsCreated')
    if (state !== null)
        recordPublicationLifecycle(accumulator, row, dimension, true, state, timeZone)
}

function recordTargetPromotion(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    if (!hasProperty(metadata, 'scheduledAt')) {
        accumulator.coverage.incompleteLatencyPairs += 1
        accumulator.coverage.missingLifecycleState += 1
        return
    }
    if (metadata.scheduledAt !== null && readOptionalTimestamp(metadata, 'scheduledAt') === null) {
        accumulator.coverage.incompleteLatencyPairs += 1
        accumulator.coverage.missingLifecycleState += 1
        return
    }
    const scheduledAt = readOptionalTimestamp(metadata, 'scheduledAt')
    setSchedule(accumulator, row.entityId, scheduledAt)
    if (!included) return

    recordPublicationLifecycle(
        accumulator,
        row,
        dimension,
        true,
        scheduledAt === null ? 'draft' : 'scheduled',
        timeZone
    )
}

function recordPublicationReady(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const toState = readState(metadata.toState)
    if (toState === null) {
        accumulator.coverage.missingLifecycleState += 1
        return
    }
    recordPublicationLifecycle(accumulator, row, dimension, included, toState, timeZone)
}

function recordPublicationPublished(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const toState = readState(metadata.toState)
    if (toState === null) accumulator.coverage.missingLifecycleState += 1
    if (!included || accumulator.publishedPublications.has(row.entityId)) return
    accumulator.publishedPublications.add(row.entityId)
    accumulator.published += 1
    recordDimensionMetric(accumulator, 'publicationPublished', dimension)
    recordBucketMetric(accumulator, row.occurredAt, timeZone, dimension, 'publicationsPublished')
    if (toState !== null) {
        recordPublicationLifecycle(accumulator, row, dimension, true, toState, timeZone)
    }
    recordScheduledLatency(
        accumulator,
        row.entityId,
        row.occurredAt,
        dimension.deliveryMode === 'manual'
    )
}

function recordReconciliation(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const toState = readState(metadata.toState)
    if (toState === null) {
        accumulator.coverage.missingLifecycleState += 1
        accumulator.coverage.incompleteLatencyPairs += 1
        return
    }
    if (!included) return

    if (toState === 'published' && !accumulator.publishedPublications.has(row.entityId)) {
        accumulator.publishedPublications.add(row.entityId)
        accumulator.published += 1
        recordDimensionMetric(accumulator, 'publicationPublished', dimension)
        recordBucketMetric(
            accumulator,
            row.occurredAt,
            timeZone,
            dimension,
            'publicationsPublished'
        )
    }
    recordPublicationLifecycle(accumulator, row, dimension, true, toState, timeZone)
    if (toState === 'published' || toState === 'failed' || toState === 'ambiguous') {
        recordScheduledLatency(accumulator, row.entityId, row.occurredAt, false)
    }
}

function recordClaim(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const attempt = getAttempt(accumulator, row, metadata, dimension, included)
    if (attempt === null || !markAttemptAction(accumulator, attempt, executionActions.claimed)) {
        return
    }
    if (!included) return

    accumulator.executionClaimed += 1
    recordDimensionMetric(accumulator, 'executionClaimed', dimension)
    recordBucketMetric(accumulator, row.occurredAt, timeZone, dimension, 'executionClaimed')
}

function recordEffectStarted(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const attempt = getAttempt(accumulator, row, metadata, dimension, included)
    if (
        attempt === null ||
        !markAttemptAction(accumulator, attempt, executionActions.effectStarted)
    ) {
        return
    }
    attempt.effectStarted = {
        occurredAt: row.occurredAt,
        dimension,
        runAt: readOptionalTimestamp(metadata, 'runAt'),
    }
    const targetState = readState(metadata.toState)
    if (targetState === null) accumulator.coverage.missingLifecycleState += 1
    if (!included) return

    accumulator.executionAttempts += 1
    recordDimensionMetric(accumulator, 'executionAttempts', dimension)
    recordBucketMetric(accumulator, row.occurredAt, timeZone, dimension, 'executionAttempts')
    if (targetState !== null) {
        recordPublicationLifecycle(accumulator, row, dimension, true, targetState, timeZone)
    }
}

function recordExecutionOutcome(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean
): void {
    const attempt = getAttempt(accumulator, row, metadata, dimension, included)
    if (attempt === null || !markAttemptAction(accumulator, attempt, row.action)) return
    if (attempt.outcome !== undefined) {
        attempt.contradictory = true
        accumulator.coverage.contradictoryAttempts += 1
        return
    }
    attempt.outcome = {
        action: row.action,
        occurredAt: row.occurredAt,
        dimension,
        targetState: readState(metadata.toState),
        row,
    }
    if (attempt.outcome.targetState === null) {
        accumulator.coverage.missingLifecycleState += 1
    }

    if (row.action === executionActions.retryScheduled) {
        const retryAt = readOptionalTimestamp(metadata, 'retryAt')
        if (hasProperty(metadata, 'retryAt') && retryAt !== null) {
            setSchedule(accumulator, row.entityId, retryAt)
        } else {
            accumulator.coverage.incompleteLatencyPairs += 1
            setSchedule(accumulator, row.entityId, null)
        }
    }
}

function finalizeExecutionOutcomes(accumulator: HistoricalAccumulator, timeZone: string): void {
    for (const attempt of accumulator.attempts.values()) {
        if (!attempt.included || attempt.contradictory || attempt.outcome === undefined) continue

        const outcome = attempt.outcome
        const dimension = attempt.dimension
        switch (outcome.action) {
            case executionActions.succeeded:
                accumulator.executionSucceeded += 1
                recordDimensionMetric(accumulator, 'executionSucceeded', dimension)
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionSucceeded'
                )
                if (!accumulator.publishedPublications.has(attempt.publicationId)) {
                    accumulator.publishedPublications.add(attempt.publicationId)
                    accumulator.published += 1
                    recordDimensionMetric(accumulator, 'publicationPublished', dimension)
                    recordBucketMetric(
                        accumulator,
                        outcome.occurredAt,
                        timeZone,
                        dimension,
                        'publicationsPublished'
                    )
                }
                if (outcome.targetState !== null) {
                    recordPublicationLifecycle(
                        accumulator,
                        outcome.row,
                        dimension,
                        true,
                        outcome.targetState,
                        timeZone
                    )
                }
                recordScheduledLatency(
                    accumulator,
                    attempt.publicationId,
                    outcome.occurredAt,
                    false
                )
                break
            case executionActions.retryScheduled:
                accumulator.executionRetryable += 1
                recordDimensionMetric(accumulator, 'executionRetryable', dimension)
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionRetryable'
                )
                if (outcome.targetState !== null) {
                    recordPublicationLifecycle(
                        accumulator,
                        outcome.row,
                        dimension,
                        true,
                        outcome.targetState,
                        timeZone
                    )
                }
                break
            case executionActions.failed:
                accumulator.executionFailed += 1
                recordDimensionMetric(accumulator, 'executionFailed', dimension)
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionFailed'
                )
                if (outcome.targetState !== null) {
                    recordPublicationLifecycle(
                        accumulator,
                        outcome.row,
                        dimension,
                        true,
                        outcome.targetState,
                        timeZone
                    )
                }
                recordScheduledLatency(
                    accumulator,
                    attempt.publicationId,
                    outcome.occurredAt,
                    false
                )
                break
            case executionActions.ambiguous:
                accumulator.executionAmbiguous += 1
                accumulator.executionDirectAmbiguous += 1
                recordDimensionMetric(accumulator, 'executionAmbiguous', dimension)
                recordDimensionMetric(accumulator, 'executionDirectAmbiguous', dimension)
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionAmbiguous'
                )
                if (outcome.targetState !== null) {
                    recordPublicationLifecycle(
                        accumulator,
                        outcome.row,
                        dimension,
                        true,
                        outcome.targetState,
                        timeZone
                    )
                }
                recordScheduledLatency(
                    accumulator,
                    attempt.publicationId,
                    outcome.occurredAt,
                    false
                )
                break
            case executionActions.ambiguityRecovered:
                accumulator.executionAmbiguous += 1
                accumulator.executionAmbiguityRecoveries += 1
                recordDimensionMetric(accumulator, 'executionAmbiguous', dimension)
                recordDimensionMetric(accumulator, 'executionAmbiguityRecoveries', dimension)
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionAmbiguous'
                )
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionAmbiguityRecoveries'
                )
                if (outcome.targetState !== null) {
                    recordPublicationLifecycle(
                        accumulator,
                        outcome.row,
                        dimension,
                        true,
                        outcome.targetState,
                        timeZone
                    )
                }
                recordScheduledLatency(
                    accumulator,
                    attempt.publicationId,
                    outcome.occurredAt,
                    false
                )
                break
            case executionActions.cancelled:
                accumulator.executionCancelled += 1
                recordDimensionMetric(accumulator, 'executionCancelled', dimension)
                recordBucketMetric(
                    accumulator,
                    outcome.occurredAt,
                    timeZone,
                    dimension,
                    'executionCancelled'
                )
                if (outcome.targetState !== null) {
                    recordPublicationLifecycle(
                        accumulator,
                        outcome.row,
                        dimension,
                        true,
                        outcome.targetState,
                        timeZone
                    )
                }
                break
        }
    }
}

function recordClaimRecovery(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean,
    timeZone: string
): void {
    const attempt = getAttempt(accumulator, row, metadata, dimension, included)
    if (
        attempt === null ||
        !markAttemptAction(accumulator, attempt, executionActions.claimRecovered)
    ) {
        return
    }
    if (!included) return

    accumulator.executionClaimRecoveries += 1
    recordDimensionMetric(accumulator, 'executionClaimRecoveries', dimension)
    recordBucketMetric(accumulator, row.occurredAt, timeZone, dimension, 'executionClaimRecoveries')
}

function recordPublicationLifecycle(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    dimension: AnalyticsDimension,
    included: boolean,
    state: PublicationState,
    timeZone: string
): void {
    if (!included || !publicationStates.includes(state)) return
    accumulator.lifecycleTotal += 1
    increment(accumulator.lifecycleByState, state)
    recordDimensionMetric(accumulator, 'lifecycleTransitions', dimension)
    recordBucketMetric(
        accumulator,
        row.occurredAt,
        timeZone,
        dimension,
        'publicationLifecycleTransitions'
    )
    if (state === 'failed') {
        accumulator.failed += 1
        recordDimensionMetric(accumulator, 'publicationFailed', dimension)
        recordBucketMetric(accumulator, row.occurredAt, timeZone, dimension, 'publicationsFailed')
    } else if (state === 'ambiguous') {
        accumulator.ambiguous += 1
        recordDimensionMetric(accumulator, 'publicationAmbiguous', dimension)
        recordBucketMetric(
            accumulator,
            row.occurredAt,
            timeZone,
            dimension,
            'publicationsAmbiguous'
        )
    }
}

function getAttempt(
    accumulator: HistoricalAccumulator,
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    dimension: AnalyticsDimension,
    included: boolean
): MutableAttempt | null {
    const jobId = readNonBlankString(metadata, 'jobId')
    const attemptNumber = readNonNegativeInteger(metadata, 'attempt')
    if (jobId === null || attemptNumber === null) {
        accumulator.coverage.missingAttemptMetadata += 1
        accumulator.coverage.skippedFactCount += 1
        return null
    }
    const key = jobId + '\u0000' + String(attemptNumber)
    const existing = accumulator.attempts.get(key)
    if (existing !== undefined) {
        if (included) {
            existing.included = true
            if (isMoreCompleteDimension(dimension, existing.dimension)) {
                existing.dimension = dimension
            }
        }
        return existing
    }
    const attempt: MutableAttempt = {
        publicationId: row.entityId,
        actions: new Set(),
        dimension,
        included,
        effectStarted: undefined,
        outcome: undefined,
        contradictory: false,
    }
    accumulator.attempts.set(key, attempt)
    return attempt
}

function isMoreCompleteDimension(
    candidate: AnalyticsDimension,
    current: AnalyticsDimension
): boolean {
    const candidateKnown =
        candidate.channelId !== null &&
        candidate.provider !== 'unknown' &&
        candidate.deliveryMode !== unknownDimensionDeliveryMode
    const currentKnown =
        current.channelId !== null &&
        current.provider !== 'unknown' &&
        current.deliveryMode !== unknownDimensionDeliveryMode
    return candidateKnown && !currentKnown
}

function markAttemptAction(
    accumulator: HistoricalAccumulator,
    attempt: MutableAttempt,
    action: string
): boolean {
    if (attempt.actions.has(action)) {
        accumulator.coverage.duplicateAttemptFacts += 1
        return false
    }
    attempt.actions.add(action)
    return true
}

function setSchedule(
    accumulator: HistoricalAccumulator,
    publicationId: string,
    scheduledAt: number | null
): void {
    if (scheduledAt === null) {
        accumulator.schedules.delete(publicationId)
        return
    }
    accumulator.schedules.set(publicationId, { scheduledAt })
}

function recordScheduledLatency(
    accumulator: HistoricalAccumulator,
    publicationId: string,
    occurredAt: number,
    manualCompletion: boolean
): void {
    const schedule = accumulator.schedules.get(publicationId)
    if (schedule === undefined || schedule.scheduledAt > occurredAt) {
        accumulator.coverage.incompleteLatencyPairs += 1
        return
    }
    addLatency(
        manualCompletion
            ? accumulator.latency.manualCompletion
            : accumulator.latency.scheduledToOutcome,
        occurredAt - schedule.scheduledAt
    )
}

function finalizeAttemptLatencies(accumulator: HistoricalAccumulator): void {
    for (const attempt of accumulator.attempts.values()) {
        if (!attempt.included) continue
        const effectStarted = attempt.effectStarted
        const outcome = attempt.outcome
        if (effectStarted === undefined || outcome === undefined || attempt.contradictory) {
            if (effectStarted !== undefined || outcome !== undefined) {
                accumulator.coverage.incompleteLatencyPairs += 1
            }
        } else if (outcome.occurredAt < effectStarted.occurredAt) {
            accumulator.coverage.incompleteLatencyPairs += 1
        } else {
            addLatency(
                accumulator.latency.effectDuration,
                outcome.occurredAt - effectStarted.occurredAt
            )
        }

        if (effectStarted === undefined) continue
        if (effectStarted.runAt === null || effectStarted.runAt > effectStarted.occurredAt) {
            accumulator.coverage.incompleteQueueDelayPairs += 1
            continue
        }
        addLatency(accumulator.latency.queueDelay, effectStarted.occurredAt - effectStarted.runAt)
    }
}

function toHistoricalMetrics(accumulator: HistoricalAccumulator): ProjectAnalytics['historical'] {
    const lifecycleTransitions: AnalyticsLifecycleTransitions = {
        total: accumulator.lifecycleTotal,
        byState: publicationStates.map(state => ({
            state,
            count: accumulator.lifecycleByState[state] ?? 0,
        })),
        byDimension: toDimensionCounts(
            accumulator.dimensionMetrics.get('lifecycleTransitions') ?? new Map()
        ),
    }

    const publicationByDimension: AnalyticsPublicationDimensionMetrics = {
        created: toDimensionCounts(
            accumulator.dimensionMetrics.get('publicationCreated') ?? new Map()
        ),
        published: toDimensionCounts(
            accumulator.dimensionMetrics.get('publicationPublished') ?? new Map()
        ),
        failed: toDimensionCounts(
            accumulator.dimensionMetrics.get('publicationFailed') ?? new Map()
        ),
        ambiguous: toDimensionCounts(
            accumulator.dimensionMetrics.get('publicationAmbiguous') ?? new Map()
        ),
    }

    const executionByDimension: AnalyticsExecutionDimensionMetrics = {
        claimed: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionClaimed') ?? new Map()
        ),
        attempts: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionAttempts') ?? new Map()
        ),
        succeeded: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionSucceeded') ?? new Map()
        ),
        failed: toDimensionCounts(accumulator.dimensionMetrics.get('executionFailed') ?? new Map()),
        retryable: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionRetryable') ?? new Map()
        ),
        ambiguous: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionAmbiguous') ?? new Map()
        ),
        directAmbiguous: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionDirectAmbiguous') ?? new Map()
        ),
        claimRecoveries: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionClaimRecoveries') ?? new Map()
        ),
        ambiguityRecoveries: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionAmbiguityRecoveries') ?? new Map()
        ),
        cancelled: toDimensionCounts(
            accumulator.dimensionMetrics.get('executionCancelled') ?? new Map()
        ),
    }

    const distinctAttemptPublications = new Set<string>()
    for (const attempt of accumulator.attempts.values()) {
        if (attempt.included && attempt.effectStarted !== undefined) {
            distinctAttemptPublications.add(attempt.publicationId)
        }
    }

    return {
        publications: {
            created: accumulator.created,
            published: accumulator.published,
            failed: accumulator.failed,
            ambiguous: accumulator.ambiguous,
            lifecycleTransitions,
            byDimension: publicationByDimension,
        },
        executions: {
            claimed: accumulator.executionClaimed,
            attempts: accumulator.executionAttempts,
            succeeded: accumulator.executionSucceeded,
            failed: accumulator.executionFailed,
            retryable: accumulator.executionRetryable,
            ambiguous: accumulator.executionAmbiguous,
            directAmbiguous: accumulator.executionDirectAmbiguous,
            claimRecoveries: accumulator.executionClaimRecoveries,
            ambiguityRecoveries: accumulator.executionAmbiguityRecoveries,
            cancelled: accumulator.executionCancelled,
            byDimension: executionByDimension,
        },
        retries: {
            scheduled: accumulator.executionRetryable,
            rate:
                accumulator.executionAttempts === 0
                    ? null
                    : accumulator.executionRetryable / accumulator.executionAttempts,
            attemptsPerPublication:
                distinctAttemptPublications.size === 0
                    ? null
                    : accumulator.executionAttempts / distinctAttemptPublications.size,
        },
        latency: {
            queueDelay: toLatencySummary(accumulator.latency.queueDelay),
            effectDuration: toLatencySummary(accumulator.latency.effectDuration),
            scheduledToOutcome: toLatencySummary(accumulator.latency.scheduledToOutcome),
            manualCompletion: toLatencySummary(accumulator.latency.manualCompletion),
        },
        buckets: [...accumulator.buckets.values()]
            .sort((left, right) => left.bucketDate.localeCompare(right.bucketDate))
            .map(toDailyBucket),
    }
}

function toDailyBucket(bucket: MutableBucket): AnalyticsDailyBucket {
    return {
        bucketDate: bucket.bucketDate,
        bucketStartUtc: bucket.bucketStartUtc,
        bucketEndUtc: bucket.bucketEndUtc,
        metrics: { ...bucket.metrics },
        dimensions: [...bucket.dimensions.values()]
            .sort((left, right) =>
                dimensionKey(left.dimension).localeCompare(dimensionKey(right.dimension))
            )
            .map(entry => ({
                ...entry.dimension,
                metrics: { ...entry.metrics },
            })),
    }
}

function recordBucketMetric(
    accumulator: HistoricalAccumulator,
    timestamp: number,
    timeZone: string,
    dimension: AnalyticsDimension,
    metric: BucketMetricName
): void {
    const bucket = getBucket(accumulator, toLocalDate(timestamp, timeZone), timeZone)
    bucket.metrics[metric] += 1
    const key = dimensionKey(dimension)
    const entry = bucket.dimensions.get(key)
    if (entry === undefined) {
        const metrics = createBucketMetrics()
        metrics[metric] = 1
        bucket.dimensions.set(key, { dimension, metrics })
    } else {
        entry.metrics[metric] += 1
    }
}

function getBucket(
    accumulator: HistoricalAccumulator,
    bucketDate: string,
    timeZone: string
): MutableBucket {
    const existing = accumulator.buckets.get(bucketDate)
    if (existing !== undefined) return existing
    const bucket: MutableBucket = {
        bucketDate,
        bucketStartUtc: utcBoundaryForLocalDate(bucketDate, timeZone),
        bucketEndUtc: utcBoundaryForLocalDate(nextLocalDate(bucketDate), timeZone),
        metrics: createBucketMetrics(),
        dimensions: new Map(),
    }
    accumulator.buckets.set(bucketDate, bucket)
    return bucket
}

function createBucketMetrics(): MutableBucketMetrics {
    return {
        publicationsCreated: 0,
        publicationsPublished: 0,
        publicationsFailed: 0,
        publicationsAmbiguous: 0,
        publicationLifecycleTransitions: 0,
        executionClaimed: 0,
        executionAttempts: 0,
        executionSucceeded: 0,
        executionFailed: 0,
        executionRetryable: 0,
        executionAmbiguous: 0,
        executionClaimRecoveries: 0,
        executionAmbiguityRecoveries: 0,
        executionCancelled: 0,
    }
}

function createLatencySummary(): MutableLatencySummary {
    return { count: 0, totalMs: 0, minMs: 0, maxMs: 0 }
}

function addLatency(summary: MutableLatencySummary, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) return
    if (summary.count === 0) {
        summary.minMs = value
        summary.maxMs = value
    } else {
        summary.minMs = Math.min(summary.minMs, value)
        summary.maxMs = Math.max(summary.maxMs, value)
    }
    summary.count += 1
    summary.totalMs += value
}

function toLatencySummary(summary: MutableLatencySummary): AnalyticsLatencySummary | null {
    if (summary.count === 0) return null
    return {
        count: summary.count,
        totalMs: summary.totalMs,
        minMs: summary.minMs,
        maxMs: summary.maxMs,
        averageMs: summary.totalMs / summary.count,
    }
}

function recordDimensionMetric(
    accumulator: HistoricalAccumulator,
    metric: HistoricalDimensionMetric,
    dimension: AnalyticsDimension
): void {
    const map = accumulator.dimensionMetrics.get(metric) ?? new Map()
    accumulator.dimensionMetrics.set(metric, map)
    incrementDimension(map, dimension)
}

function incrementDimension(
    map: Map<string, MutableDimensionCount>,
    dimension: AnalyticsDimension
): void {
    const key = dimensionKey(dimension)
    const existing = map.get(key)
    if (existing === undefined) {
        map.set(key, { dimension, count: 1 })
    } else {
        existing.count += 1
    }
}

function toDimensionCounts(
    map: Map<string, MutableDimensionCount>
): readonly AnalyticsDimensionCount[] {
    return [...map.values()]
        .sort((left, right) =>
            dimensionKey(left.dimension).localeCompare(dimensionKey(right.dimension))
        )
        .map(entry => ({ ...entry.dimension, count: entry.count }))
}

function currentDimension(row: PublicationInventoryRow | CurrentJobRow): AnalyticsDimension {
    return {
        channelId: row.channelId,
        channelName: row.channelName,
        provider: row.deliveryMode === 'manual' ? 'manual' : (row.provider ?? 'unknown'),
        deliveryMode: row.deliveryMode,
    }
}

function deriveHistoricalDimension(
    row: HistoricalFactRow,
    metadata: Readonly<Record<string, unknown>>,
    action: string,
    coverage: MutableCoverage
): AnalyticsDimension {
    const channelId = readNonBlankString(metadata, 'channelId') ?? row.channelId
    const deliveryModeFromMetadata = readDeliveryMode(metadata.deliveryMode)
    const deliveryMode =
        deliveryModeFromMetadata ??
        (action.startsWith('publication.execution.')
            ? 'automatic'
            : action === publicationEventActions.ready ||
                action === publicationEventActions.published
              ? 'manual'
              : (row.deliveryMode ?? unknownDimensionDeliveryMode))
    const provider =
        readNonBlankString(metadata, 'provider') ??
        readNonBlankString(metadata, 'publisherKind') ??
        (deliveryMode === 'manual' ? 'manual' : 'unknown')
    const dimension = {
        channelId,
        channelName: row.channelName,
        provider,
        deliveryMode,
    } satisfies AnalyticsDimension
    if (
        dimension.channelId === null ||
        dimension.provider === 'unknown' ||
        dimension.deliveryMode === unknownDimensionDeliveryMode
    ) {
        coverage.missingHistoricalDimensions += 1
    }
    return dimension
}

function matchesFilters(dimension: AnalyticsDimension, filters: AnalyticsFilters): boolean {
    return (
        (filters.channelId === undefined || dimension.channelId === filters.channelId) &&
        (filters.provider === undefined || dimension.provider === filters.provider) &&
        (filters.deliveryMode === undefined || dimension.deliveryMode === filters.deliveryMode)
    )
}

function parseMetadata(metadataJson: string | null):
    | { readonly ok: true; readonly metadata: Readonly<Record<string, unknown>> }
    | {
          readonly ok: false
          readonly metadata: Readonly<Record<string, unknown>>
      } {
    if (metadataJson === null) return { ok: true, metadata: {} }
    try {
        const parsed: unknown = JSON.parse(metadataJson)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, metadata: {} }
        }
        return { ok: true, metadata: parsed as Readonly<Record<string, unknown>> }
    } catch {
        return { ok: false, metadata: {} }
    }
}

function hasProperty(metadata: Readonly<Record<string, unknown>>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(metadata, key)
}

function readNonBlankString(
    metadata: Readonly<Record<string, unknown>>,
    key: string
): string | null {
    const value = metadata[key]
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized.length === 0 ? null : normalized
}

function readNonNegativeInteger(
    metadata: Readonly<Record<string, unknown>>,
    key: string
): number | null {
    const value = metadata[key]
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readOptionalTimestamp(
    metadata: Readonly<Record<string, unknown>>,
    key: string
): number | null {
    if (!hasProperty(metadata, key)) return null
    const value = metadata[key]
    return value === null
        ? null
        : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? value
          : null
}

function readState(value: unknown): PublicationState | null {
    return typeof value === 'string' && publicationStates.includes(value as PublicationState)
        ? (value as PublicationState)
        : null
}

function readDeliveryMode(value: unknown): DeliveryMode | null {
    return typeof value === 'string' && deliveryModes.includes(value as DeliveryMode)
        ? (value as DeliveryMode)
        : null
}

function createCountMap<const Keys extends readonly string[]>(keys: Keys): MutableCountMap {
    return Object.fromEntries(keys.map(key => [key, 0]))
}

function increment(counts: MutableCountMap, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1
}

function dimensionKey(dimension: AnalyticsDimension): string {
    return [dimension.channelId ?? '', dimension.provider, dimension.deliveryMode].join('\u0000')
}

function minimumTimestamp(rows: readonly { readonly runAt: number }[]): number | null {
    let minimum: number | null = null
    for (const row of rows) {
        if (minimum === null || row.runAt < minimum) minimum = row.runAt
    }
    return minimum
}

function toLocalDate(timestamp: number, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(timestamp))
    const values = new Map(parts.map(part => [part.type, part.value]))
    return values.get('year') + '-' + values.get('month') + '-' + values.get('day')
}

function nextLocalDate(date: string): string {
    const parts = date.split('-').map(Number)
    const year = parts[0] ?? 1970
    const month = parts[1] ?? 1
    const day = parts[2] ?? 1
    const next = new Date(Date.UTC(year, month - 1, day + 1))
    return [
        String(next.getUTCFullYear()).padStart(4, '0'),
        String(next.getUTCMonth() + 1).padStart(2, '0'),
        String(next.getUTCDate()).padStart(2, '0'),
    ].join('-')
}

function utcBoundaryForLocalDate(date: string, timeZone: string): number {
    const parts = date.split('-').map(Number)
    const year = parts[0] ?? 1970
    const month = parts[1] ?? 1
    const day = parts[2] ?? 1
    const targetLocalAsUtc = Date.UTC(year, month - 1, day)
    let candidate = targetLocalAsUtc
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(new Date(candidate))
        const values = new Map(parts.map(part => [part.type, part.value]))
        const localAsUtc = Date.UTC(
            Number(values.get('year')),
            Number(values.get('month')) - 1,
            Number(values.get('day')),
            Number(values.get('hour')),
            Number(values.get('minute')),
            Number(values.get('second'))
        )
        const offset = localAsUtc - candidate
        const next = targetLocalAsUtc - offset
        if (next === candidate) return candidate
        candidate = next
    }
    return candidate
}
