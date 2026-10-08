import {
    createProjectNotification,
    DomainInvariantError,
    notificationKinds,
    projectNotificationTemplate,
    requireJsonObject,
    requireNonBlank,
    requireTimestamp,
    type ExternalEffectOutcome,
    type ExternalEffectWork,
    type ExpiredClaimRecovery,
    type NotificationKind,
    type PersistedEffectOutcome,
} from '@herald/core'

import type { HeraldDatabase } from './client'
import { createEventJournalStore, parseEventJournalCursor } from './event-journal-store'

const defaultProjectionName = 'external-notification-delivery-v1'
const defaultProjectionLimit = 100
const maximumProjectionLimit = 500

type NotificationDestinationState = 'active' | 'disabled'
type NotificationDeliveryState = 'pending' | 'running' | 'delivered' | 'failed' | 'ambiguous'

interface HumanActorRow {
    readonly id: string
}

interface CursorRow {
    readonly cursor: string | null
}

interface DestinationRow {
    readonly id: string
    readonly projectId: string
    readonly recipientActorId: string
    readonly transportId: string
    readonly label: string
    readonly configurationJson: string
    readonly secretVersion: number | null
    readonly state: NotificationDestinationState
    readonly createdAt: number
    readonly updatedAt: number
}

interface ProjectionCandidateRow {
    readonly destinationId: string
    readonly projectId: string
    readonly recipientActorId: string
    readonly subjectId: string
    readonly transportId: string
    readonly configurationJson: string
    readonly secretId: string | null
    readonly kind: NotificationKind
}

interface DeliveryRow {
    readonly id: string
    readonly projectId: string
    readonly destinationId: string
    readonly secretId: string | null
    readonly secretVersion: number | null
    readonly sourceEventId: string
    readonly transportId: string
    readonly configurationJson: string
    readonly kind: NotificationKind
    readonly severity: 'success' | 'warning' | 'error'
    readonly subjectType: string
    readonly subjectId: string
    readonly title: string
    readonly body: string
    readonly state: NotificationDeliveryState
    readonly attemptCount: number
    readonly nextAttemptAt: number
    readonly leaseToken: string | null
    readonly leaseExpiresAt: number | null
    readonly effectStartedAt: number | null
    readonly deliveredAt: number | null
    readonly failedAt: number | null
    readonly ambiguousAt: number | null
    readonly externalId: string | null
    readonly lastError: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface ExpiredDeliveryRow {
    readonly id: string
    readonly effectStartedAt: number | null
    readonly createdAt: number
}

export interface NotificationDestination {
    readonly id: string
    readonly projectId: string
    readonly recipientActorId: string
    readonly transportId: string
    readonly label: string
    readonly configuration: Readonly<Record<string, unknown>>
    readonly secretVersion: number | null
    readonly state: NotificationDestinationState
    readonly createdAt: number
    readonly updatedAt: number
}

export interface CreateNotificationDestinationInput {
    readonly projectId: string
    readonly subjectId: string
    readonly transportId: string
    readonly label: string
    readonly configuration: Readonly<Record<string, unknown>>
}

export interface SubscribeNotificationDestinationInput {
    readonly projectId: string
    readonly subjectId: string
    readonly destinationId: string
    readonly kind: NotificationKind
    readonly enabled: boolean
}

export interface NotificationDelivery extends ExternalEffectWork {
    readonly projectId: string
    readonly destinationId: string
    readonly secretVersion: number | null
    readonly sourceEventId: string
    readonly transportId: string
    readonly configuration: Readonly<Record<string, unknown>>
    readonly kind: NotificationKind
    readonly severity: 'success' | 'warning' | 'error'
    readonly subject: { readonly type: string; readonly id: string }
    readonly title: string
    readonly body: string
    readonly state: NotificationDeliveryState
    readonly nextAttemptAt: number
    readonly leaseToken: string | null
    readonly leaseExpiresAt: number | null
    readonly effectStartedAt: number | null
    readonly deliveredAt: number | null
    readonly failedAt: number | null
    readonly ambiguousAt: number | null
    readonly externalId: string | null
    readonly lastError: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface NotificationDeliveryProjectionResult {
    readonly scanned: number
    readonly created: number
    readonly hasMore: boolean
}

export interface NotificationDeliveryStoreOptions {
    readonly transportId?: string
    readonly createId?: () => string
    readonly now?: () => number
    readonly acceptDestination?: (input: {
        projectId: string
        subjectId: string
        configuration: Readonly<Record<string, unknown>>
        cursor: string
    }) => boolean
}

export function createNotificationDeliveryStore(
    database: HeraldDatabase,
    options: NotificationDeliveryStoreOptions = {}
) {
    const client = database.$client
    const transportId =
        options.transportId === undefined
            ? null
            : requireNonBlank(options.transportId, 'transportId')
    const projectionName =
        transportId === null ? defaultProjectionName : `${defaultProjectionName}:${transportId}`
    const journal = createEventJournalStore(database)
    const createId = options.createId ?? (() => crypto.randomUUID())
    const now = options.now ?? Date.now

    const listProjectIdsStatement = client.query<{ readonly id: string }, []>(`
        select id from projects order by created_at, id
    `)
    const loadHumanActorStatement = client.query<
        HumanActorRow,
        [projectId: string, subjectId: string]
    >(`
        select id from actors
        where project_id = ?1 and subject_id = ?2 and kind = 'human'
        order by created_at, id limit 1
    `)
    const loadDestinationStatement = client.query<
        DestinationRow,
        [projectId: string, destinationId: string]
    >(destinationSelect('where d.project_id = ?1 and d.id = ?2'))
    const listDestinationsStatement = client.query<DestinationRow, [projectId: string]>(
        destinationSelect('where d.project_id = ?1 order by d.created_at, d.id')
    )
    const insertDestinationStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            transportId: string,
            label: string,
            configurationJson: string,
            createdAt: number,
        ]
    >(`
        insert into notification_destinations (
            id, project_id, recipient_actor_id, transport_id, label, configuration_json,
            created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    `)
    const updateDestinationStateStatement = client.query<
        { readonly changes: number },
        [
            state: NotificationDestinationState,
            updatedAt: number,
            projectId: string,
            destinationId: string,
        ]
    >(`
        update notification_destinations set state = ?1, updated_at = ?2
        where project_id = ?3 and id = ?4
    `)
    const upsertSubscriptionStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            destinationId: string,
            kind: NotificationKind,
            enabled: number,
            updatedAt: number,
        ]
    >(`
        insert into notification_subscriptions (
            id, project_id, destination_id, kind, enabled, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        on conflict(project_id, destination_id, kind) do update set
            enabled = excluded.enabled, updated_at = excluded.updated_at
    `)
    const listProjectionCandidatesStatement = client.query<
        ProjectionCandidateRow,
        [projectId: string]
    >(`
        select
            d.id as destinationId,
            d.project_id as projectId,
            d.recipient_actor_id as recipientActorId,
            a.subject_id as subjectId,
            d.transport_id as transportId,
            d.configuration_json as configurationJson,
            secret.id as secretId,
            s.kind
        from notification_destinations d
        inner join notification_subscriptions s
            on s.project_id = d.project_id and s.destination_id = d.id
        left join notification_destination_secrets secret
            on secret.project_id = d.project_id
           and secret.destination_id = d.id
           and secret.state = 'active'
        inner join actors a
            on a.project_id = d.project_id and a.id = d.recipient_actor_id
        where d.project_id = ?1
          and d.state = 'active'
          and s.enabled = 1
          and a.kind = 'human'
          and a.subject_id is not null
        order by d.created_at, d.id, s.kind
    `)
    const loadCursorStatement = client.query<CursorRow, [projectId: string, projection: string]>(`
        select cursor from notification_delivery_projection_cursors
        where project_id = ?1 and projection = ?2
    `)
    const insertDeliveryStatement = client.query<
        { readonly changes: number },
        [
            id: string,
            projectId: string,
            destinationId: string,
            secretId: string | null,
            sourceEventId: string,
            transportId: string,
            configurationJson: string,
            kind: NotificationKind,
            severity: NotificationDelivery['severity'],
            subjectType: string,
            subjectId: string,
            title: string,
            body: string,
            createdAt: number,
        ]
    >(`
        insert into notification_deliveries (
            id, project_id, destination_id, secret_id, source_event_id, transport_id,
            configuration_json, kind, severity, subject_type, subject_id, title, body,
            next_attempt_at, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?14)
        on conflict(project_id, destination_id, source_event_id) do nothing
    `)
    const upsertCursorStatement = client.query<
        void,
        [id: string, projectId: string, projection: string, cursor: string, updatedAt: number]
    >(`
        insert into notification_delivery_projection_cursors (
            id, project_id, projection, cursor, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?5)
        on conflict(project_id, projection) do update set
            cursor = excluded.cursor, updated_at = excluded.updated_at
    `)
    const listDeliveryStatement = client.query<DeliveryRow, [projectId: string, subjectId: string]>(
        deliverySelect(`
        where d.project_id = ?1
          and exists (
              select 1 from actors a
              inner join notification_destinations owner
                  on owner.project_id = a.project_id and owner.recipient_actor_id = a.id
              where a.project_id = d.project_id
                and a.subject_id = ?2
                and a.kind = 'human'
                and owner.id = d.destination_id
          )
        order by d.created_at desc, d.id desc
    `)
    )
    const expiredDeliveryStatement = client.query<
        ExpiredDeliveryRow,
        [now: number, transportId: string | null]
    >(`
        select id, effect_started_at as effectStartedAt, created_at as createdAt
        from notification_deliveries
        where state = 'running' and lease_expires_at <= ?1 and (?2 is null or transport_id = ?2)
        order by lease_expires_at, id
    `)
    const requeueExpiredDeliveryStatement = client.query<
        { readonly changes: number },
        [nextAttemptAt: number, updatedAt: number, id: string]
    >(`
        update notification_deliveries
        set state = 'pending', lease_token = null, lease_expires_at = null,
            next_attempt_at = ?1, updated_at = ?2
        where id = ?3 and state = 'running'
    `)
    const markExpiredAmbiguousStatement = client.query<
        { readonly changes: number },
        [ambiguousAt: number, updatedAt: number, error: string, id: string]
    >(`
        update notification_deliveries
        set state = 'ambiguous', lease_token = null, lease_expires_at = null,
            ambiguous_at = ?1, last_error = ?3, updated_at = ?2
        where id = ?4 and state = 'running'
    `)
    const claimDeliveryStatement = client.query<
        { readonly changes: number },
        [claimToken: string, leaseExpiresAt: number, now: number, transportId: string | null]
    >(`
        update notification_deliveries
        set state = 'running', lease_token = ?1, lease_expires_at = ?2,
            attempt_count = attempt_count + 1, updated_at = ?3
        where id = (
            select d.id
            from notification_deliveries d
            inner join notification_destinations destination
                on destination.project_id = d.project_id
               and destination.id = d.destination_id
            where d.state = 'pending'
              and d.next_attempt_at <= ?3
              and destination.state = 'active'
              and (?4 is null or d.transport_id = ?4)
            order by d.next_attempt_at, d.created_at, d.id
            limit 1
        )
          and state = 'pending'
    `)
    const loadClaimedDeliveryStatement = client.query<DeliveryRow, [claimToken: string]>(
        deliverySelect("where d.lease_token = ?1 and d.state = 'running'")
    )
    const startDeliveryEffectStatement = client.query<
        { readonly changes: number },
        [startedAt: number, id: string, claimToken: string]
    >(`
        update notification_deliveries
        set effect_started_at = coalesce(effect_started_at, ?1), updated_at = ?1
        where id = ?2 and state = 'running' and lease_token = ?3
    `)
    const loadCompletionDeliveryStatement = client.query<
        DeliveryRow,
        [id: string, claimToken: string]
    >(deliverySelect("where d.id = ?1 and d.state = 'running' and d.lease_token = ?2"))
    const completePublishedStatement = client.query<
        { readonly changes: number },
        [completedAt: number, externalId: string | null, id: string, claimToken: string]
    >(`
        update notification_deliveries
        set state = 'delivered', delivered_at = ?1, external_id = ?2,
            lease_token = null, lease_expires_at = null, last_error = null, updated_at = ?1
        where id = ?3 and state = 'running' and lease_token = ?4
    `)
    const completeRetryableStatement = client.query<
        { readonly changes: number },
        [nextAttemptAt: number, completedAt: number, error: string, id: string, claimToken: string]
    >(`
        update notification_deliveries
        set state = 'pending', next_attempt_at = ?1, lease_token = null,
            lease_expires_at = null, effect_started_at = null, last_error = ?3, updated_at = ?2
        where id = ?4 and state = 'running' and lease_token = ?5
    `)
    const completeFailedStatement = client.query<
        { readonly changes: number },
        [failedAt: number, error: string, id: string, claimToken: string]
    >(`
        update notification_deliveries
        set state = 'failed', failed_at = ?1, lease_token = null,
            lease_expires_at = null, last_error = ?2, updated_at = ?1
        where id = ?3 and state = 'running' and lease_token = ?4
    `)
    const completeAmbiguousStatement = client.query<
        { readonly changes: number },
        [ambiguousAt: number, error: string, id: string, claimToken: string]
    >(`
        update notification_deliveries
        set state = 'ambiguous', ambiguous_at = ?1, lease_token = null,
            lease_expires_at = null, last_error = ?2, updated_at = ?1
        where id = ?3 and state = 'running' and lease_token = ?4
    `)
    const getNextDeliveryAtStatement = client.query<
        { readonly nextAttemptAt: number | null },
        [transportId: string | null]
    >(`
        select min(case when d.state = 'running' then d.lease_expires_at else d.next_attempt_at end) as nextAttemptAt
        from notification_deliveries d
        inner join notification_destinations destination
            on destination.project_id = d.project_id and destination.id = d.destination_id
        where d.state in ('pending', 'running') and destination.state = 'active'
          and (?1 is null or d.transport_id = ?1)
    `)

    const projectTransaction = client.transaction(
        (projectId: string, limit: number): NotificationDeliveryProjectionResult => {
            const storedCursor = loadCursorStatement.get(projectId, projectionName)?.cursor ?? null
            const after = storedCursor === null ? null : parseEventJournalCursor(storedCursor)
            const events = journal.readAfter({ projectId, after, limit })
            if (events.length === 0) return { scanned: 0, created: 0, hasMore: false }

            const candidates = listProjectionCandidatesStatement.all(projectId)
            let created = 0
            for (const event of events) {
                const template = projectNotificationTemplate(event)
                if (template === null) continue

                for (const candidate of candidates) {
                    if (
                        candidate.kind !== template.kind ||
                        (transportId !== null && candidate.transportId !== transportId)
                    )
                        continue
                    const configuration = parseConfiguration(candidate.configurationJson)
                    if (
                        options.acceptDestination?.({
                            projectId,
                            subjectId: candidate.subjectId,
                            configuration,
                            cursor: event.cursor,
                        }) === false
                    )
                        continue
                    const notification = createProjectNotification({
                        id: createId(),
                        projectId,
                        recipientActorId: candidate.recipientActorId,
                        sourceEventId: event.id,
                        kind: template.kind,
                        severity: template.severity,
                        subject: event.subject,
                        title: template.title,
                        body: template.body,
                        createdAt: event.occurredAt,
                    })
                    created += insertDeliveryStatement.run(
                        notification.id,
                        projectId,
                        candidate.destinationId,
                        candidate.secretId,
                        event.id,
                        candidate.transportId,
                        JSON.stringify(configuration),
                        notification.kind,
                        notification.severity,
                        notification.subject.type,
                        notification.subject.id,
                        notification.title,
                        notification.body,
                        event.occurredAt
                    ).changes
                }
            }

            const cursor = events.at(-1)?.cursor
            if (cursor === undefined) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'notification delivery cursor is missing'
                )
            }
            upsertCursorStatement.run(
                createId(),
                projectId,
                projectionName,
                cursor,
                Math.max(requireTimestamp(now(), 'now'), events.at(-1)?.occurredAt ?? 0)
            )
            return { scanned: events.length, created, hasMore: events.length === limit }
        }
    )

    const recoverExpiredTransaction = client.transaction((at: number): ExpiredClaimRecovery => {
        const requeuedJobIds: string[] = []
        const ambiguousJobIds: string[] = []
        for (const delivery of expiredDeliveryStatement.all(at, transportId)) {
            const recoveredAt = Math.max(at, delivery.createdAt)
            if (delivery.effectStartedAt === null) {
                if (
                    requeueExpiredDeliveryStatement.run(recoveredAt, recoveredAt, delivery.id)
                        .changes === 1
                ) {
                    requeuedJobIds.push(delivery.id)
                }
                continue
            }
            if (
                markExpiredAmbiguousStatement.run(
                    Math.max(recoveredAt, delivery.effectStartedAt),
                    Math.max(recoveredAt, delivery.effectStartedAt),
                    'The notification delivery lease expired after the external-effect boundary',
                    delivery.id
                ).changes === 1
            ) {
                ambiguousJobIds.push(delivery.id)
            }
        }
        return { requeuedJobIds, ambiguousJobIds }
    })

    const store = {
        listProjectIds(): readonly string[] {
            return listProjectIdsStatement.all().map(row => row.id)
        },

        project(
            projectId: string,
            limit = defaultProjectionLimit
        ): NotificationDeliveryProjectionResult {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumProjectionLimit) {
                throw new DomainInvariantError(
                    'invalid_input',
                    `notification delivery projection limit must be between 1 and ${maximumProjectionLimit}`
                )
            }
            return projectTransaction.immediate(normalizedProjectId, limit)
        },

        createDestination(
            input: CreateNotificationDestinationInput
        ): NotificationDestination | null {
            const actor = resolveHumanActor(input.projectId, input.subjectId)
            if (actor === null) return null
            const id = requireNonBlank(input.transportId, 'transportId')
            const label = requireNonBlank(input.label, 'label')
            const configuration = parseConfiguration(input.configuration)
            const destinationId = createId()
            const timestamp = requireTimestamp(now(), 'now')
            insertDestinationStatement.run(
                destinationId,
                input.projectId,
                actor.id,
                id,
                label,
                JSON.stringify(configuration),
                timestamp
            )
            return toDestination(loadDestinationStatement.get(input.projectId, destinationId)!)
        },

        listDestinations(
            projectId: string,
            subjectId: string
        ): readonly NotificationDestination[] | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            return listDestinationsStatement
                .all(projectId)
                .filter(destination => destination.recipientActorId === actor.id)
                .map(toDestination)
        },

        setDestinationState(
            projectId: string,
            destinationId: string,
            subjectId: string,
            state: NotificationDestinationState
        ): NotificationDestination | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            const destination = loadDestinationStatement.get(
                projectId,
                requireNonBlank(destinationId, 'destinationId')
            )
            if (destination === null || destination.recipientActorId !== actor.id) return null
            updateDestinationStateStatement.run(
                state,
                Math.max(requireTimestamp(now(), 'now'), destination.createdAt),
                projectId,
                destination.id
            )
            return toDestination(loadDestinationStatement.get(projectId, destination.id)!)
        },

        subscribe(input: SubscribeNotificationDestinationInput): NotificationKind | null {
            const actor = resolveHumanActor(input.projectId, input.subjectId)
            if (actor === null) return null
            if (!notificationKinds.includes(input.kind)) {
                throw new DomainInvariantError('invalid_input', 'notification kind is invalid')
            }
            const destination = loadDestinationStatement.get(input.projectId, input.destinationId)
            if (destination === null || destination.recipientActorId !== actor.id) return null
            upsertSubscriptionStatement.run(
                createId(),
                input.projectId,
                destination.id,
                input.kind,
                input.enabled ? 1 : 0,
                Math.max(requireTimestamp(now(), 'now'), destination.createdAt)
            )
            return input.kind
        },

        recoverExpiredClaims(at: number): ExpiredClaimRecovery {
            return recoverExpiredTransaction.immediate(requireTimestamp(at, 'now'))
        },

        claimNextDueJob(input: {
            readonly actorId: string
            readonly claimToken: string
            readonly now: number
            readonly leaseExpiresAt: number
        }): NotificationDelivery | null {
            requireNonBlank(input.actorId, 'actorId')
            const claimToken = requireNonBlank(input.claimToken, 'claimToken')
            const timestamp = requireTimestamp(input.now, 'now')
            const leaseExpiresAt = requireTimestamp(input.leaseExpiresAt, 'leaseExpiresAt')
            if (leaseExpiresAt <= timestamp) {
                throw new DomainInvariantError('invalid_time', 'leaseExpiresAt must be after now')
            }
            claimDeliveryStatement.run(claimToken, leaseExpiresAt, timestamp, transportId)
            const row = loadClaimedDeliveryStatement.get(claimToken)
            return row === null ? null : toDelivery(row)
        },

        startExternalEffect(deliveryId: string, claimToken: string, at: number): boolean {
            return (
                startDeliveryEffectStatement.run(
                    requireTimestamp(at, 'effectStartedAt'),
                    requireNonBlank(deliveryId, 'deliveryId'),
                    requireNonBlank(claimToken, 'claimToken')
                ).changes === 1
            )
        },

        completeExternalEffect(input: {
            readonly jobId: string
            readonly claimToken: string
            readonly completedAt: number
            readonly outcome: ExternalEffectOutcome
            readonly retryAt?: number | null
        }): PersistedEffectOutcome | null {
            const id = requireNonBlank(input.jobId, 'jobId')
            const claimToken = requireNonBlank(input.claimToken, 'claimToken')
            const existing = loadCompletionDeliveryStatement.get(id, claimToken)
            if (existing === null) return null
            const completedAt = Math.max(
                requireTimestamp(input.completedAt, 'completedAt'),
                existing.createdAt
            )
            if (existing.effectStartedAt === null || completedAt < existing.effectStartedAt) {
                throw new DomainInvariantError(
                    'invalid_time',
                    'Completion cannot predate the external-effect boundary'
                )
            }
            if (input.outcome.type === 'published') {
                return completePublishedStatement.run(
                    completedAt,
                    input.outcome.externalId ?? null,
                    id,
                    claimToken
                ).changes === 1
                    ? 'published'
                    : null
            }
            if (
                input.outcome.type === 'retryable_failure' &&
                input.retryAt !== null &&
                input.retryAt !== undefined
            ) {
                const errorMessage = requireNonBlank(input.outcome.errorMessage, 'errorMessage')
                const retryAt = Math.max(requireTimestamp(input.retryAt, 'retryAt'), completedAt)
                return completeRetryableStatement.run(
                    retryAt,
                    completedAt,
                    errorMessage,
                    id,
                    claimToken
                ).changes === 1
                    ? 'retry_scheduled'
                    : null
            }
            if (input.outcome.type === 'ambiguous') {
                const errorMessage = requireNonBlank(input.outcome.errorMessage, 'errorMessage')
                return completeAmbiguousStatement.run(completedAt, errorMessage, id, claimToken)
                    .changes === 1
                    ? 'ambiguous'
                    : null
            }
            const errorMessage = requireNonBlank(input.outcome.errorMessage, 'errorMessage')
            return completeFailedStatement.run(completedAt, errorMessage, id, claimToken)
                .changes === 1
                ? 'failed'
                : null
        },

        list(projectId: string, subjectId: string): readonly NotificationDelivery[] | null {
            const actor = resolveHumanActor(projectId, subjectId)
            if (actor === null) return null
            return listDeliveryStatement.all(projectId, subjectId).map(toDelivery)
        },

        getNextAttemptAt(): number | null {
            return getNextDeliveryAtStatement.get(transportId)?.nextAttemptAt ?? null
        },
    }

    return store

    function resolveHumanActor(projectId: string, subjectId: string): HumanActorRow | null {
        return (
            loadHumanActorStatement.get(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(subjectId, 'subjectId')
            ) ?? null
        )
    }
}

export type NotificationDeliveryStore = ReturnType<typeof createNotificationDeliveryStore>

function destinationSelect(predicate: string): string {
    return `
        select
            d.id,
            d.project_id as projectId,
            d.recipient_actor_id as recipientActorId,
            d.transport_id as transportId,
            d.label,
            d.configuration_json as configurationJson,
            secret.version as secretVersion,
            d.state,
            d.created_at as createdAt,
            d.updated_at as updatedAt
        from notification_destinations d
        left join notification_destination_secrets secret
            on secret.project_id = d.project_id
           and secret.destination_id = d.id
           and secret.state = 'active'
        ${predicate}
    `
}

function deliverySelect(predicate: string): string {
    return `
        select
            d.id,
            d.project_id as projectId,
            d.destination_id as destinationId,
            d.secret_id as secretId,
            secret.version as secretVersion,
            d.source_event_id as sourceEventId,
            d.transport_id as transportId,
            d.configuration_json as configurationJson,
            d.kind,
            d.severity,
            d.subject_type as subjectType,
            d.subject_id as subjectId,
            d.title,
            d.body,
            d.state,
            d.attempt_count as attemptCount,
            d.next_attempt_at as nextAttemptAt,
            d.lease_token as leaseToken,
            d.lease_expires_at as leaseExpiresAt,
            d.effect_started_at as effectStartedAt,
            d.delivered_at as deliveredAt,
            d.failed_at as failedAt,
            d.ambiguous_at as ambiguousAt,
            d.external_id as externalId,
            d.last_error as lastError,
            d.created_at as createdAt,
            d.updated_at as updatedAt
        from notification_deliveries d
        left join notification_destination_secrets secret
            on secret.project_id = d.project_id and secret.id = d.secret_id
        ${predicate}
    `
}

function parseConfiguration(value: unknown): Readonly<Record<string, unknown>> {
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            throw new DomainInvariantError(
                'invalid_input',
                'notification destination configuration is invalid'
            )
        }
    }
    if (!isRecord(value)) {
        throw new DomainInvariantError(
            'invalid_input',
            'notification destination configuration must be an object'
        )
    }
    requireJsonObject(value, 'notification destination configuration')
    const serialized = JSON.stringify(value)
    if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) {
        throw new DomainInvariantError(
            'invalid_input',
            'notification destination configuration is invalid'
        )
    }
    return JSON.parse(serialized) as Readonly<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toDestination(row: DestinationRow): NotificationDestination {
    return {
        id: row.id,
        projectId: row.projectId,
        recipientActorId: row.recipientActorId,
        transportId: row.transportId,
        label: row.label,
        configuration: parseConfiguration(row.configurationJson),
        secretVersion: row.secretVersion,
        state: row.state,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toDelivery(row: DeliveryRow): NotificationDelivery {
    return {
        id: row.id,
        projectId: row.projectId,
        destinationId: row.destinationId,
        secretVersion: row.secretVersion,
        sourceEventId: row.sourceEventId,
        transportId: row.transportId,
        configuration: parseConfiguration(row.configurationJson),
        kind: row.kind,
        severity: row.severity,
        subject: { type: row.subjectType, id: row.subjectId },
        title: row.title,
        body: row.body,
        state: row.state,
        attempts: row.attemptCount,
        nextAttemptAt: row.nextAttemptAt,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
        effectStartedAt: row.effectStartedAt,
        deliveredAt: row.deliveredAt,
        failedAt: row.failedAt,
        ambiguousAt: row.ambiguousAt,
        externalId: row.externalId,
        lastError: row.lastError,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}
