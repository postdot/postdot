import {
    assertProviderMediaDeliveryTransition,
    DomainInvariantError,
    requireNonBlank,
    requireTimestamp,
    type ProviderMediaDeliveryState,
} from '@herald/core'

import type { HeraldDatabase } from './client'

export interface ProviderMediaDelivery {
    readonly id: string
    readonly projectId: string
    readonly executionMediaId: string
    readonly publisherId: string
    readonly providerId: string
    readonly state: ProviderMediaDeliveryState
    readonly attempts: number
    readonly remoteMediaId: string | null
    readonly remoteMediaUrl: string | null
    readonly lastAttemptAt: number | null
    readonly completedAt: number | null
    readonly errorCode: string | null
    readonly errorMessage: string | null
    readonly createdAt: number
    readonly updatedAt: number
}

export interface ReserveProviderMediaDeliveryInput {
    readonly projectId: string
    readonly executionMediaId: string
    readonly publisherId: string
    readonly providerId: string
}

export interface StartProviderMediaDeliveryInput {
    readonly projectId: string
    readonly deliveryId: string
    readonly at?: number
}

export interface CompleteProviderMediaDeliveryInput {
    readonly projectId: string
    readonly deliveryId: string
    readonly remoteMediaId: string
    readonly remoteMediaUrl?: string | null
    readonly at?: number
}

export interface RecordProviderMediaDeliveryRemoteIdInput {
    readonly projectId: string
    readonly deliveryId: string
    readonly remoteMediaId: string
    readonly at?: number
}

export interface FailProviderMediaDeliveryInput {
    readonly projectId: string
    readonly deliveryId: string
    readonly errorCode: string
    readonly errorMessage: string
    readonly ambiguous?: boolean
    readonly at?: number
}

export interface RetryProviderMediaDeliveryInput {
    readonly projectId: string
    readonly deliveryId: string
    readonly at?: number
}

interface ProviderMediaDeliveryRow extends ProviderMediaDelivery {}

const deliveryColumns = `
    id,
    project_id as projectId,
    execution_media_id as executionMediaId,
    publisher_id as publisherId,
    provider_id as providerId,
    state,
    attempts,
    remote_media_id as remoteMediaId,
    remote_media_url as remoteMediaUrl,
    last_attempt_at as lastAttemptAt,
    completed_at as completedAt,
    error_code as errorCode,
    error_message as errorMessage,
    created_at as createdAt,
    updated_at as updatedAt
`

export function createProviderMediaDeliveryStore(
    database: HeraldDatabase,
    options: { readonly now?: () => number; readonly createId?: () => string } = {}
) {
    const client = database.$client
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())

    const loadStatement = client.query<
        ProviderMediaDeliveryRow,
        [projectId: string, deliveryId: string]
    >(`
        select ${deliveryColumns}
        from provider_media_deliveries
        where project_id = ?1
          and id = ?2
    `)
    const listByExecutionMediaStatement = client.query<
        ProviderMediaDeliveryRow,
        [projectId: string, executionMediaId: string]
    >(`
        select ${deliveryColumns}
        from provider_media_deliveries
        where project_id = ?1
          and execution_media_id = ?2
        order by created_at, id
    `)
    const insertStatement = client.query<void, [string, string, string, string, string, number]>(`
        insert into provider_media_deliveries (
            id,
            project_id,
            execution_media_id,
            publisher_id,
            provider_id,
            state,
            attempts,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6)
        on conflict(project_id, execution_media_id, publisher_id, provider_id) do nothing
    `)
    const startStatement = client.query<{ changes: number }, [number, string, string]>(`
        update provider_media_deliveries
        set state = 'uploading',
            attempts = attempts + 1,
            last_attempt_at = ?1,
            completed_at = null,
            error_code = null,
            error_message = null,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state = 'pending'
    `)
    const completeStatement = client.query<
        { changes: number },
        [number, string, string | null, string, string]
    >(`
        update provider_media_deliveries
        set state = 'uploaded',
            remote_media_id = ?2,
            remote_media_url = ?3,
            completed_at = ?1,
            error_code = null,
            error_message = null,
            updated_at = ?1
        where project_id = ?4
          and id = ?5
          and state in ('uploading', 'ambiguous')
    `)
    const recordRemoteMediaIdStatement = client.query<
        { changes: number },
        [number, string, string, string]
    >(`
        update provider_media_deliveries
        set remote_media_id = ?2,
            updated_at = ?1
        where project_id = ?3
          and id = ?4
          and state = 'uploading'
          and (remote_media_id is null or remote_media_id = ?2)
    `)
    const failStatement = client.query<
        { changes: number },
        [number, string, string, string, string, string]
    >(`
        update provider_media_deliveries
        set state = ?2,
            completed_at = ?1,
            remote_media_id = case when ?2 = 'ambiguous' then remote_media_id else null end,
            remote_media_url = case when ?2 = 'ambiguous' then remote_media_url else null end,
            error_code = ?3,
            error_message = ?4,
            updated_at = ?1
        where project_id = ?5
          and id = ?6
          and state in ('uploading', 'ambiguous')
    `)
    const retryStatement = client.query<{ changes: number }, [number, string, string]>(`
        update provider_media_deliveries
        set state = 'pending',
            completed_at = null,
            error_code = null,
            error_message = null,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state = 'failed'
    `)

    return {
        reserve(input: ReserveProviderMediaDeliveryInput): ProviderMediaDelivery {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const executionMediaId = requireNonBlank(input.executionMediaId, 'executionMediaId')
            const publisherId = requireNonBlank(input.publisherId, 'publisherId')
            const providerId = requireNonBlank(input.providerId, 'providerId')
            const timestamp = requireTimestamp(now(), 'now')
            insertStatement.run(
                createId(),
                projectId,
                executionMediaId,
                publisherId,
                providerId,
                timestamp
            )
            const delivery = client
                .query<ProviderMediaDeliveryRow, [string, string, string, string]>(`
                    select ${deliveryColumns}
                    from provider_media_deliveries
                    where project_id = ?1
                      and execution_media_id = ?2
                      and publisher_id = ?3
                      and provider_id = ?4
                `)
                .get(projectId, executionMediaId, publisherId, providerId)
            if (delivery === null) {
                throw new DomainInvariantError(
                    'invalid_input',
                    'Provider media delivery could not be persisted'
                )
            }
            return delivery
        },

        start(input: StartProviderMediaDeliveryInput): ProviderMediaDelivery | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const deliveryId = requireNonBlank(input.deliveryId, 'deliveryId')
            const delivery = loadStatement.get(projectId, deliveryId)
            if (delivery === null) return null
            if (delivery.state !== 'pending') return delivery
            assertProviderMediaDeliveryTransition(delivery.state, 'uploading')
            const timestamp = requireTimestamp(input.at ?? now(), 'at')
            if (startStatement.run(timestamp, projectId, deliveryId).changes !== 1) {
                return loadStatement.get(projectId, deliveryId)
            }
            return loadStatement.get(projectId, deliveryId)
        },

        recordRemoteMediaId(
            input: RecordProviderMediaDeliveryRemoteIdInput
        ): ProviderMediaDelivery | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const deliveryId = requireNonBlank(input.deliveryId, 'deliveryId')
            const remoteMediaId = requireNonBlank(input.remoteMediaId, 'remoteMediaId')
            const delivery = loadStatement.get(projectId, deliveryId)
            if (delivery === null) return null
            if (delivery.remoteMediaId !== null && delivery.remoteMediaId !== remoteMediaId) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Provider media delivery ${deliveryId} already has another remote media ID`
                )
            }
            if (delivery.state !== 'uploading') return delivery
            const timestamp = requireTimestamp(input.at ?? now(), 'at')
            if (
                recordRemoteMediaIdStatement.run(timestamp, remoteMediaId, projectId, deliveryId)
                    .changes !== 1
            ) {
                return loadStatement.get(projectId, deliveryId)
            }
            return loadStatement.get(projectId, deliveryId)
        },

        complete(input: CompleteProviderMediaDeliveryInput): ProviderMediaDelivery | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const deliveryId = requireNonBlank(input.deliveryId, 'deliveryId')
            const remoteMediaId = requireNonBlank(input.remoteMediaId, 'remoteMediaId')
            const remoteMediaUrl =
                input.remoteMediaUrl == null
                    ? null
                    : requireNonBlank(input.remoteMediaUrl, 'remoteMediaUrl')
            const delivery = loadStatement.get(projectId, deliveryId)
            if (delivery === null) return null
            if (delivery.remoteMediaId !== null && delivery.remoteMediaId !== remoteMediaId) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Provider media delivery ${deliveryId} already has another remote media ID`
                )
            }
            if (delivery.state === 'uploaded') {
                return delivery
            }
            if (delivery.state !== 'uploading' && delivery.state !== 'ambiguous') {
                return delivery
            }
            assertProviderMediaDeliveryTransition(delivery.state, 'uploaded')
            const timestamp = requireTimestamp(input.at ?? now(), 'at')
            if (
                completeStatement.run(
                    timestamp,
                    remoteMediaId,
                    remoteMediaUrl,
                    projectId,
                    deliveryId
                ).changes !== 1
            ) {
                return loadStatement.get(projectId, deliveryId)
            }
            return loadStatement.get(projectId, deliveryId)
        },

        fail(input: FailProviderMediaDeliveryInput): ProviderMediaDelivery | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const deliveryId = requireNonBlank(input.deliveryId, 'deliveryId')
            const errorCode = requireNonBlank(input.errorCode, 'errorCode')
            const errorMessage = requireNonBlank(input.errorMessage, 'errorMessage')
            const delivery = loadStatement.get(projectId, deliveryId)
            if (delivery === null) return null
            if (delivery.state !== 'uploading' && delivery.state !== 'ambiguous') {
                return delivery
            }
            const nextState: 'failed' | 'ambiguous' = input.ambiguous ? 'ambiguous' : 'failed'
            assertProviderMediaDeliveryTransition(delivery.state, nextState)
            const timestamp = requireTimestamp(input.at ?? now(), 'at')
            if (
                failStatement.run(
                    timestamp,
                    nextState,
                    errorCode,
                    errorMessage,
                    projectId,
                    deliveryId
                ).changes !== 1
            ) {
                return loadStatement.get(projectId, deliveryId)
            }
            return loadStatement.get(projectId, deliveryId)
        },

        retry(input: RetryProviderMediaDeliveryInput): ProviderMediaDelivery | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const deliveryId = requireNonBlank(input.deliveryId, 'deliveryId')
            const delivery = loadStatement.get(projectId, deliveryId)
            if (delivery === null) return null
            if (delivery.state !== 'failed') return delivery
            assertProviderMediaDeliveryTransition(delivery.state, 'pending')
            const timestamp = requireTimestamp(input.at ?? now(), 'at')
            if (retryStatement.run(timestamp, projectId, deliveryId).changes !== 1) {
                return loadStatement.get(projectId, deliveryId)
            }
            return loadStatement.get(projectId, deliveryId)
        },

        get(projectId: string, deliveryId: string): ProviderMediaDelivery | null {
            return loadStatement.get(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(deliveryId, 'deliveryId')
            )
        },

        listByExecutionMedia(
            projectId: string,
            executionMediaId: string
        ): readonly ProviderMediaDelivery[] {
            return listByExecutionMediaStatement.all(
                requireNonBlank(projectId, 'projectId'),
                requireNonBlank(executionMediaId, 'executionMediaId')
            )
        },
    }
}
