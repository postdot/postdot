import {
    DomainInvariantError,
    providerAnalyticsAvailabilityStates,
    providerAnalyticsContractVersion,
    providerAnalyticsFreshnessStates,
    providerAnalyticsPostbotEntityTypes,
    providerAnalyticsSubjectTypes,
    requireNonBlank,
    requireTimestamp,
    type ProviderAnalyticsAvailability,
    type ProviderAnalyticsFreshness,
    type ProviderAnalyticsPostbotEntityType,
    type ProviderAnalyticsObservation,
    type ProviderAnalyticsObservationInput,
    type ProviderAnalyticsSubjectType,
} from '@postdot/core'

import { createDatabaseTransaction, type PostbotDatabase } from './client'

const defaultObservationLimit = 100
const maximumObservationLimit = 500
const maximumKnownContentLimit = 25

export interface ProviderAnalyticsStoreOptions {
    readonly createId?: () => string
}

export interface RecordProviderAnalyticsObservationsInput {
    readonly projectId: string
    readonly subjectId: string
    readonly observations: readonly ProviderAnalyticsObservationInput[]
}

export interface RecordProviderAnalyticsObservationsResult {
    readonly contractVersion: typeof providerAnalyticsContractVersion
    readonly inserted: number
    readonly duplicates: number
    readonly observations: readonly ProviderAnalyticsObservation[]
}

export interface ListProviderAnalyticsObservationsInput {
    readonly projectId: string
    readonly subjectId: string
    readonly provider: string
    readonly subjectType?: ProviderAnalyticsSubjectType | null
    readonly providerSubjectId?: string | null
    readonly postbotEntityId?: string | null
    readonly limit?: number
}

export interface ProviderAnalyticsObservationPage {
    readonly contractVersion: typeof providerAnalyticsContractVersion
    readonly projectId: string
    readonly provider: string
    readonly observations: readonly ProviderAnalyticsObservation[]
    readonly limit: number
    readonly hasMore: boolean
}

export interface ListKnownProviderContentInput {
    readonly projectId: string
    readonly subjectId: string
    readonly provider: string
    readonly channelId: string
    readonly publicationIds?: readonly string[]
    readonly limit?: number
}

export interface ListLatestProviderContentObservationsInput {
    readonly projectId: string
    readonly subjectId: string
    readonly provider: string
    readonly publicationIds: readonly string[]
}

export interface KnownProviderContent {
    readonly channelId: string
    readonly postbotEntityType: 'publication'
    readonly postbotEntityId: string
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
}

interface ProjectAccessRow {
    readonly id: string
}

interface ObservationRow {
    readonly id: string
    readonly projectId: string
    readonly provider: string
    readonly subjectType: ProviderAnalyticsSubjectType
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
    readonly providerContentRevisionId: string | null
    readonly postbotEntityType: ProviderAnalyticsPostbotEntityType | null
    readonly postbotEntityId: string | null
    readonly metricName: string
    readonly value: number | null
    readonly unit: string
    readonly aggregation: string
    readonly reportingPeriodStart: number | null
    readonly reportingPeriodEnd: number | null
    readonly observedAt: number | null
    readonly fetchedAt: number
    readonly availability: ProviderAnalyticsAvailability
    readonly freshness: ProviderAnalyticsFreshness
    readonly provenance: string
}

interface KnownProviderContentRow {
    readonly channelId: string
    readonly postbotEntityId: string
    readonly providerSubjectId: string
}

export function createProviderAnalyticsStore(
    database: PostbotDatabase,
    options: ProviderAnalyticsStoreOptions = {}
) {
    const client = database.$client
    const createId = options.createId ?? (() => crypto.randomUUID())

    const projectAccessStatement = client.query<
        ProjectAccessRow,
        [projectId: string, subjectId: string]
    >(
        String.raw`
        select projects.id
        from projects
        inner join actors
            on actors.project_id = projects.id
           and actors.subject_id = ?2
           and actors.kind in ('human', 'agent', 'api_token')
        where projects.id = ?1
        limit 1
    `
    )
    const insertObservationStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            provider: string,
            subjectType: string,
            providerSubjectId: string,
            providerSubjectLabel: string | null,
            providerContentRevisionId: string | null,
            postbotEntityType: string | null,
            postbotEntityId: string | null,
            metricName: string,
            value: number | null,
            unit: string,
            aggregation: string,
            reportingPeriodStart: number | null,
            reportingPeriodEnd: number | null,
            observedAt: number | null,
            fetchedAt: number,
            availability: string,
            freshness: string,
            provenance: string,
        ]
    >(
        String.raw`
        insert or ignore into provider_analytics_observations (
            id,
            project_id,
            provider,
            subject_type,
            provider_subject_id,
            provider_subject_label,
            provider_content_revision_id,
            postbot_entity_type,
            postbot_entity_id,
            metric_name,
            value,
            unit,
            aggregation,
            reporting_period_start,
            reporting_period_end,
            observed_at,
            fetched_at,
            availability,
            freshness,
            provenance
        ) values (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
        )
    `
    )
    const observationKeyStatement = client.query<
        ObservationRow,
        [
            projectId: string,
            provider: string,
            subjectType: string,
            providerSubjectId: string,
            metricName: string,
            fetchedAt: number,
        ]
    >(
        String.raw`
        select id,
               project_id as projectId,
               provider,
               subject_type as subjectType,
               provider_subject_id as providerSubjectId,
               provider_subject_label as providerSubjectLabel,
               provider_content_revision_id as providerContentRevisionId,
               postbot_entity_type as postbotEntityType,
               postbot_entity_id as postbotEntityId,
               metric_name as metricName,
               value,
               unit,
               aggregation,
               reporting_period_start as reportingPeriodStart,
               reporting_period_end as reportingPeriodEnd,
               observed_at as observedAt,
               fetched_at as fetchedAt,
               availability,
               freshness,
               provenance
        from provider_analytics_observations
        where project_id = ?1
          and provider = ?2
          and subject_type = ?3
          and provider_subject_id = ?4
          and metric_name = ?5
          and fetched_at = ?6
        limit 1
    `
    )
    const listObservationsStatement = client.query<
        ObservationRow,
        [
            projectId: string,
            provider: string,
            subjectType: string | null,
            providerSubjectId: string | null,
            postbotEntityId: string | null,
            limit: number,
        ]
    >(
        String.raw`
        select id,
               project_id as projectId,
               provider,
               subject_type as subjectType,
               provider_subject_id as providerSubjectId,
               provider_subject_label as providerSubjectLabel,
               provider_content_revision_id as providerContentRevisionId,
               postbot_entity_type as postbotEntityType,
               postbot_entity_id as postbotEntityId,
               metric_name as metricName,
               value,
               unit,
               aggregation,
               reporting_period_start as reportingPeriodStart,
               reporting_period_end as reportingPeriodEnd,
               observed_at as observedAt,
               fetched_at as fetchedAt,
               availability,
               freshness,
               provenance
        from provider_analytics_observations
        where project_id = ?1
          and provider = ?2
          and (?3 is null or subject_type = ?3)
          and (?4 is null or provider_subject_id = ?4)
          and (?5 is null or postbot_entity_id = ?5)
        order by fetched_at desc, id desc
        limit ?6
    `
    )
    const listLatestContentObservationsStatement = (publicationIds: readonly string[]) =>
        client.query<ObservationRow, [string, string, ...string[]]>(
            String.raw`
            with ranked as (
                select id,
                       project_id as projectId,
                       provider,
                       subject_type as subjectType,
                       provider_subject_id as providerSubjectId,
                       provider_subject_label as providerSubjectLabel,
                       provider_content_revision_id as providerContentRevisionId,
                       postbot_entity_type as postbotEntityType,
                       postbot_entity_id as postbotEntityId,
                       metric_name as metricName,
                       value,
                       unit,
                       aggregation,
                       reporting_period_start as reportingPeriodStart,
                       reporting_period_end as reportingPeriodEnd,
                       observed_at as observedAt,
                       fetched_at as fetchedAt,
                       availability,
                       freshness,
                       provenance,
                       row_number() over (
                           partition by postbot_entity_id, metric_name
                           order by fetched_at desc, id desc
                       ) as rowRank
                from provider_analytics_observations
                where project_id = ?1
                  and provider = ?2
                  and subject_type = 'content'
                  and postbot_entity_type = 'publication'
                  and postbot_entity_id in (${publicationIds.map((_, index) => `?${index + 3}`).join(', ')})
            )
            select id,
                   projectId,
                   provider,
                   subjectType,
                   providerSubjectId,
                   providerSubjectLabel,
                   providerContentRevisionId,
                   postbotEntityType,
                   postbotEntityId,
                   metricName,
                   value,
                   unit,
                   aggregation,
                   reportingPeriodStart,
                   reportingPeriodEnd,
                   observedAt,
                   fetchedAt,
                   availability,
                   freshness,
                   provenance
            from ranked
            where rowRank = 1
            order by fetchedAt desc, id desc
            limit ${maximumObservationLimit + 1}
        `
        )
    const listKnownContentStatement = client.query<
        KnownProviderContentRow,
        [projectId: string, channelId: string, provider: string, limit: number]
    >(
        String.raw`
        select publications.channel_id as channelId,
               publications.id as postbotEntityId,
               publications.external_id as providerSubjectId
        from publications
        inner join project_publisher_contexts as publishers
            on publishers.project_id = publications.project_id
           and publishers.channel_id = publications.channel_id
           and publishers.kind = ?3
        where publications.project_id = ?1
          and publications.channel_id = ?2
          and publications.external_id is not null
        order by publications.published_at desc,
                 publications.created_at desc,
                 publications.id desc
        limit ?4
    `
    )
    const listSelectedKnownContentStatement = (publicationIds: readonly string[]) =>
        client.query<KnownProviderContentRow, [string, string, string, ...string[]]>(
            String.raw`
            select publications.channel_id as channelId,
                   publications.id as postbotEntityId,
                   publications.external_id as providerSubjectId
            from publications
            inner join project_publisher_contexts as publishers
                on publishers.project_id = publications.project_id
               and publishers.channel_id = publications.channel_id
               and publishers.kind = ?3
            where publications.project_id = ?1
              and publications.channel_id = ?2
              and publications.external_id is not null
              and publications.id in (${publicationIds.map((_, index) => `?${index + 4}`).join(', ')})
            order by publications.published_at desc,
                     publications.created_at desc,
                     publications.id desc
        `
        )

    const recordObservationsTransaction = createDatabaseTransaction(
        database,
        (
            input: RecordProviderAnalyticsObservationsInput,
            normalizedProjectId: string
        ): RecordProviderAnalyticsObservationsResult => {
            let inserted = 0
            let duplicates = 0
            const observations: ProviderAnalyticsObservation[] = []

            for (const observation of input.observations) {
                const normalized = normalizeObservation(observation, normalizedProjectId)
                const result = insertObservationStatement.run(
                    createId(),
                    normalized.projectId,
                    normalized.provider,
                    normalized.subjectType,
                    normalized.providerSubjectId,
                    normalized.providerSubjectLabel,
                    normalized.providerContentRevisionId,
                    normalized.postbotEntityType,
                    normalized.postbotEntityId,
                    normalized.metricName,
                    normalized.value,
                    normalized.unit,
                    normalized.aggregation,
                    normalized.reportingPeriodStart,
                    normalized.reportingPeriodEnd,
                    normalized.observedAt,
                    normalized.fetchedAt,
                    normalized.availability,
                    normalized.freshness,
                    normalized.provenance
                )
                if (result.changes === 0) duplicates += 1
                else inserted += 1

                const persisted = observationKeyStatement.get(
                    normalized.projectId,
                    normalized.provider,
                    normalized.subjectType,
                    normalized.providerSubjectId,
                    normalized.metricName,
                    normalized.fetchedAt
                )
                if (persisted !== null) observations.push(toObservation(persisted))
            }

            return {
                contractVersion: providerAnalyticsContractVersion,
                inserted,
                duplicates,
                observations,
            }
        }
    )

    return {
        recordObservations(
            input: RecordProviderAnalyticsObservationsInput
        ): RecordProviderAnalyticsObservationsResult | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            if (projectAccessStatement.get(projectId, subjectId) === null) return null

            return recordObservationsTransaction.immediate(input, projectId)
        },

        listObservations(
            input: ListProviderAnalyticsObservationsInput
        ): ProviderAnalyticsObservationPage | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            if (projectAccessStatement.get(projectId, subjectId) === null) return null

            const provider = requireNonBlank(input.provider, 'provider')
            const subjectType = normalizeOptionalSubjectType(input.subjectType)
            const providerSubjectId = normalizeOptionalText(
                input.providerSubjectId,
                'providerSubjectId'
            )
            const postbotEntityId = normalizeOptionalText(input.postbotEntityId, 'postbotEntityId')
            const limit = normalizeLimit(input.limit)
            const rows = listObservationsStatement.all(
                projectId,
                provider,
                subjectType,
                providerSubjectId,
                postbotEntityId,
                limit + 1
            )

            return {
                contractVersion: providerAnalyticsContractVersion,
                projectId,
                provider,
                observations: rows.slice(0, limit).map(toObservation),
                limit,
                hasMore: rows.length > limit,
            }
        },

        listLatestContentObservations(
            input: ListLatestProviderContentObservationsInput
        ): ProviderAnalyticsObservationPage | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            if (projectAccessStatement.get(projectId, subjectId) === null) return null

            const provider = requireNonBlank(input.provider, 'provider')
            const publicationIds = normalizeLatestPublicationIds(input.publicationIds)
            const rows = listLatestContentObservationsStatement(publicationIds).all(
                projectId,
                provider,
                ...publicationIds
            )

            return {
                contractVersion: providerAnalyticsContractVersion,
                projectId,
                provider,
                observations: rows.slice(0, maximumObservationLimit).map(toObservation),
                limit: maximumObservationLimit,
                hasMore: rows.length > maximumObservationLimit,
            }
        },

        listKnownProviderContent(
            input: ListKnownProviderContentInput
        ): KnownProviderContent[] | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            if (projectAccessStatement.get(projectId, subjectId) === null) return null

            const channelId = requireNonBlank(input.channelId, 'channelId')
            const provider = requireNonBlank(input.provider, 'provider')
            const limit = normalizeKnownContentLimit(input.limit)
            const publicationIds = normalizePublicationIds(input.publicationIds)
            const rows =
                publicationIds.length === 0
                    ? listKnownContentStatement.all(projectId, channelId, provider, limit)
                    : listSelectedKnownContentStatement(publicationIds).all(
                          projectId,
                          channelId,
                          provider,
                          ...publicationIds
                      )

            return rows.slice(0, limit).map(row => ({
                channelId: row.channelId,
                postbotEntityType: 'publication',
                postbotEntityId: row.postbotEntityId,
                providerSubjectId: row.providerSubjectId,
                providerSubjectLabel: null,
            }))
        },
    }
}

export type ProviderAnalyticsStore = ReturnType<typeof createProviderAnalyticsStore>

function normalizeObservation(
    input: ProviderAnalyticsObservationInput,
    projectId: string
): ProviderAnalyticsObservationInput {
    if (input.projectId !== projectId) {
        throw new DomainInvariantError(
            'project_mismatch',
            `Observation must belong to project ${projectId}`
        )
    }

    const provider = requireNonBlank(input.provider, 'provider')
    const providerSubjectId = requireNonBlank(input.providerSubjectId, 'providerSubjectId')
    const metricName = requireNonBlank(input.metricName, 'metricName')
    const unit = requireNonBlank(input.unit, 'unit')
    const aggregation = requireNonBlank(input.aggregation, 'aggregation')
    const provenance = requireNonBlank(input.provenance, 'provenance')
    if (!providerAnalyticsSubjectTypes.includes(input.subjectType)) {
        throw new DomainInvariantError('invalid_input', 'subjectType is invalid')
    }
    if (!providerAnalyticsAvailabilityStates.includes(input.availability)) {
        throw new DomainInvariantError('invalid_input', 'availability is invalid')
    }
    if (!providerAnalyticsFreshnessStates.includes(input.freshness)) {
        throw new DomainInvariantError('invalid_input', 'freshness is invalid')
    }

    const providerSubjectLabel = normalizeOptionalText(
        input.providerSubjectLabel,
        'providerSubjectLabel'
    )
    const providerContentRevisionId = normalizeOptionalText(
        input.providerContentRevisionId,
        'providerContentRevisionId'
    )
    const postbotEntityType = normalizeOptionalEntityType(input.postbotEntityType)
    const postbotEntityId = normalizeOptionalText(input.postbotEntityId, 'postbotEntityId')
    if ((postbotEntityType === null) !== (postbotEntityId === null)) {
        throw new DomainInvariantError(
            'invalid_input',
            'postbotEntityType and postbotEntityId must be provided together'
        )
    }

    const value = input.value === null ? null : input.value
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new DomainInvariantError('invalid_input', 'observation value must be non-negative')
    }
    if ((input.availability === 'measured') !== (value !== null)) {
        throw new DomainInvariantError(
            'invalid_input',
            'measured observations require a value and unavailable observations must not have one'
        )
    }

    const reportingPeriodStart = normalizeOptionalTimestamp(
        input.reportingPeriodStart,
        'reportingPeriodStart'
    )
    const reportingPeriodEnd = normalizeOptionalTimestamp(
        input.reportingPeriodEnd,
        'reportingPeriodEnd'
    )
    if (
        (reportingPeriodStart === null) !== (reportingPeriodEnd === null) ||
        (reportingPeriodStart !== null &&
            reportingPeriodEnd !== null &&
            reportingPeriodEnd <= reportingPeriodStart)
    ) {
        throw new DomainInvariantError(
            'invalid_time',
            'reportingPeriodStart and reportingPeriodEnd must describe a non-empty period'
        )
    }

    return {
        projectId,
        provider,
        subjectType: input.subjectType,
        providerSubjectId,
        providerSubjectLabel,
        providerContentRevisionId,
        postbotEntityType,
        postbotEntityId,
        metricName,
        value,
        unit,
        aggregation,
        reportingPeriodStart,
        reportingPeriodEnd,
        observedAt: normalizeOptionalTimestamp(input.observedAt, 'observedAt'),
        fetchedAt: requireTimestamp(input.fetchedAt, 'fetchedAt'),
        availability: input.availability,
        freshness: input.freshness,
        provenance,
    }
}

function normalizeOptionalText(value: string | null | undefined, field: string): string | null {
    if (value === undefined || value === null) return null
    return requireNonBlank(value, field)
}

function normalizeOptionalTimestamp(
    value: number | null | undefined,
    field: string
): number | null {
    if (value === undefined || value === null) return null
    return requireTimestamp(value, field)
}

function normalizeOptionalSubjectType(
    value: ProviderAnalyticsSubjectType | null | undefined
): ProviderAnalyticsSubjectType | null {
    if (value === undefined || value === null) return null
    if (!providerAnalyticsSubjectTypes.includes(value)) {
        throw new DomainInvariantError('invalid_input', 'subjectType is invalid')
    }
    return value
}

function normalizeOptionalEntityType(
    value: ProviderAnalyticsPostbotEntityType | null | undefined
): ProviderAnalyticsPostbotEntityType | null {
    if (value === undefined || value === null) return null
    if (!providerAnalyticsPostbotEntityTypes.includes(value)) {
        throw new DomainInvariantError('invalid_input', 'postbotEntityType is invalid')
    }
    return value
}

function normalizeLimit(value: number | undefined): number {
    if (value === undefined) return defaultObservationLimit
    if (!Number.isSafeInteger(value) || value < 1 || value > maximumObservationLimit) {
        throw new DomainInvariantError(
            'invalid_input',
            `limit must be between 1 and ${maximumObservationLimit}`
        )
    }
    return value
}

function normalizeKnownContentLimit(value: number | undefined): number {
    if (value === undefined) return maximumKnownContentLimit
    if (!Number.isSafeInteger(value) || value < 1 || value > maximumKnownContentLimit) {
        throw new DomainInvariantError(
            'invalid_input',
            `known content limit must be between 1 and ${maximumKnownContentLimit}`
        )
    }
    return value
}

function normalizePublicationIds(value: readonly string[] | undefined): string[] {
    if (value === undefined) return []
    const ids = [...new Set(value.map(id => requireNonBlank(id, 'publicationId')))]
    if (ids.length > maximumKnownContentLimit) {
        throw new DomainInvariantError(
            'invalid_input',
            `at most ${maximumKnownContentLimit} publicationIds may be collected at once`
        )
    }
    return ids
}

function normalizeLatestPublicationIds(value: readonly string[] | undefined): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new DomainInvariantError(
            'invalid_input',
            'publicationIds must contain between 1 and ' + maximumKnownContentLimit + ' ids'
        )
    }
    if (value.length > maximumKnownContentLimit) {
        throw new DomainInvariantError(
            'invalid_input',
            'publicationIds must contain between 1 and ' + maximumKnownContentLimit + ' ids'
        )
    }

    const ids = value.map(id => {
        if (typeof id !== 'string') {
            throw new DomainInvariantError('invalid_input', 'publicationIds must be strings')
        }
        return requireNonBlank(id, 'publicationId')
    })
    if (new Set(ids).size !== ids.length) {
        throw new DomainInvariantError('invalid_input', 'publicationIds must be distinct')
    }

    return ids
}

function toObservation(row: ObservationRow): ProviderAnalyticsObservation {
    return {
        id: row.id,
        projectId: row.projectId,
        provider: row.provider,
        subjectType: row.subjectType,
        providerSubjectId: row.providerSubjectId,
        providerSubjectLabel: row.providerSubjectLabel,
        providerContentRevisionId: row.providerContentRevisionId,
        postbotEntityType: row.postbotEntityType,
        postbotEntityId: row.postbotEntityId,
        metricName: row.metricName,
        value: row.value,
        unit: row.unit,
        aggregation: row.aggregation,
        reportingPeriodStart: row.reportingPeriodStart,
        reportingPeriodEnd: row.reportingPeriodEnd,
        observedAt: row.observedAt,
        fetchedAt: row.fetchedAt,
        availability: row.availability,
        freshness: row.freshness,
        provenance: row.provenance,
    }
}
