import { describe, expect, it } from 'bun:test'

import {
    createExponentialRetryPolicy,
    DomainInvariantError,
    processNextExternalEffect,
} from '@postdot/core'

import { closeDatabase, createDatabase } from './client'
import { SecretCipherError } from './encrypted-secret-crypto'
import { createEventJournalStore } from './event-journal-store'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import {
    createNotificationDeliveryStore,
    type NotificationDelivery,
} from './notification-delivery-store'
import { createNotificationDestinationSecretCipher } from './notification-destination-secret-crypto'
import { createNotificationDestinationSecretStore } from './notification-destination-secret-store'
import { createNotificationStore } from './notification-store'
import { seedTestWorkspace } from './testing'

const eventTime = 1_800_000_000_000
const operationTime = eventTime + 1_000

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let nextId = 0
    const createId = () => `generated-${++nextId}`
    const manual = createManualStore(database, { createId, now: () => eventTime - 1_000 })
    const project = manual.createProject({
        workspaceId: seedTestWorkspace(database),
        name: 'Postdot',
        subjectId: 'human-1',
        displayName: 'First human',
    })
    const journal = createEventJournalStore(database, { createId })
    const deliveries = createNotificationDeliveryStore(database, {
        createId,
        now: () => operationTime,
    })
    const secrets = createNotificationDestinationSecretStore(database, {
        cipher: createNotificationDestinationSecretCipher({
            keyId: 'notification-test-v1',
            key: new Uint8Array(32).fill(8),
        }),
        createId,
        now: () => operationTime,
    })
    const inbox = createNotificationStore(database, { createId, now: () => operationTime })
    return { database, project, journal, deliveries, secrets, inbox }
}

function appendPublicationEvent(
    fixture: ReturnType<typeof createFixture>,
    input: { readonly id: string; readonly name: string; readonly version?: number }
) {
    return fixture.journal.append({
        id: input.id,
        projectId: fixture.project.project.id,
        actorId: fixture.project.actor.id,
        name: input.name,
        version: input.version ?? 1,
        subject: { type: 'publication', id: `publication-${input.id}` },
        occurredAt: eventTime,
    })
}

function addDestination(fixture: ReturnType<typeof createFixture>, enabled = true) {
    const destination = fixture.deliveries.createDestination({
        projectId: fixture.project.project.id,
        subjectId: 'human-1',
        transportId: 'test',
        label: 'Test destination',
        configuration: { topic: 'postdot-test' },
    })
    if (destination === null) throw new Error('The notification destination is missing')
    for (const kind of [
        'publication_published',
        'publication_failed',
        'publication_ambiguous',
    ] as const) {
        fixture.deliveries.subscribe({
            projectId: fixture.project.project.id,
            subjectId: 'human-1',
            destinationId: destination.id,
            kind,
            enabled,
        })
    }
    return destination
}

describe('notification delivery store', () => {
    it('hands a claimed delivery to a recording transport without network access', async () => {
        const fixture = createFixture()
        try {
            addDestination(fixture)
            appendPublicationEvent(fixture, {
                id: 'event-recording-transport',
                name: 'publication.execution.failed',
            })
            expect(fixture.deliveries.project(fixture.project.project.id).created).toBe(1)

            const recorded: NotificationDelivery[] = []
            const result = await processNextExternalEffect({
                store: fixture.deliveries,
                actorId: 'system-worker',
                leaseDuration: 60_000,
                retryPolicy: createExponentialRetryPolicy({
                    maxAttempts: 3,
                    initialDelay: 100,
                    maximumDelay: 1_000,
                }),
                createClaimToken: () => 'recording-transport-claim',
                now: () => operationTime,
                performExternalEffect: work => {
                    recorded.push(work)
                    return {
                        type: 'published',
                        externalId: `recorded:${work.id}`,
                    }
                },
            })

            expect(result.outcome).toBe('published')
            expect(recorded).toHaveLength(1)
            expect(recorded[0]).toMatchObject({
                transportId: 'test',
                configuration: { topic: 'postdot-test' },
                kind: 'publication_failed',
                title: 'Publication failed',
            })
            expect(fixture.deliveries.list(fixture.project.project.id, 'human-1')).toMatchObject([
                {
                    state: 'delivered',
                    externalId: expect.stringContaining('recorded:'),
                },
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('binds a delivery secret to the same destination as the delivery', async () => {
        const fixture = createFixture()
        try {
            const firstDestination = addDestination(fixture)
            const secondDestination = addDestination(fixture)
            const firstSecret = await fixture.secrets.setSecret({
                projectId: fixture.project.project.id,
                subjectId: 'human-1',
                destinationId: firstDestination.id,
                material: { bearerToken: 'first-destination-secret' },
            })
            const secondSecret = await fixture.secrets.setSecret({
                projectId: fixture.project.project.id,
                subjectId: 'human-1',
                destinationId: secondDestination.id,
                material: { bearerToken: 'second-destination-secret' },
            })
            if (firstSecret === null || secondSecret === null) {
                throw new Error('The notification destination secret is missing')
            }

            appendPublicationEvent(fixture, {
                id: 'event-secret-destination-binding',
                name: 'publication.execution.failed',
            })
            expect(fixture.deliveries.project(fixture.project.project.id).created).toBe(2)

            const firstDelivery = fixture.database.$client
                .query<{ readonly id: string }, [destinationId: string]>(
                    'select id from notification_deliveries where destination_id = ?1'
                )
                .get(firstDestination.id)
            if (firstDelivery === null) throw new Error('The first delivery is missing')

            expect(() =>
                fixture.database.$client
                    .query<void, [secretId: string, deliveryId: string]>(
                        'update notification_deliveries set secret_id = ?1 where id = ?2'
                    )
                    .run(secondSecret.id, firstDelivery.id)
            ).toThrow()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('encrypts versioned secrets and pins the referenced version in delivery snapshots', async () => {
        const fixture = createFixture()
        try {
            const destination = addDestination(fixture)
            const firstSecret = await fixture.secrets.setSecret({
                projectId: fixture.project.project.id,
                subjectId: 'human-1',
                destinationId: destination.id,
                material: { bearerToken: 'notification-secret-v1' },
            })
            expect(firstSecret).toMatchObject({
                version: 1,
                state: 'active',
                encryptionKeyId: 'notification-test-v1',
            })
            expect(firstSecret).not.toHaveProperty('ciphertext')
            expect(
                fixture.deliveries.listDestinations(fixture.project.project.id, 'human-1')
            ).toMatchObject([{ secretVersion: 1 }])

            appendPublicationEvent(fixture, {
                id: 'event-secret-v1',
                name: 'publication.execution.failed',
            })
            expect(fixture.deliveries.project(fixture.project.project.id).created).toBe(1)
            const firstDelivery = fixture.deliveries.list(
                fixture.project.project.id,
                'human-1'
            )?.[0]
            if (firstDelivery === undefined) throw new Error('The first delivery is missing')
            expect(firstDelivery.secretVersion).toBe(1)
            expect(firstDelivery.configuration).toEqual({ topic: 'postdot-test' })

            const firstClaim = fixture.deliveries.claimNextDueJob({
                actorId: 'system-1',
                claimToken: 'secret-claim-v1',
                now: operationTime,
                leaseExpiresAt: operationTime + 100,
            })
            if (firstClaim === null) throw new Error('The first delivery was not claimed')
            expect(
                await fixture.secrets.resolveForClaim({
                    projectId: fixture.project.project.id,
                    deliveryId: firstClaim.id,
                    claimToken: 'secret-claim-v1',
                })
            ).toEqual({ bearerToken: 'notification-secret-v1' })
            expect(
                fixture.deliveries.startExternalEffect(
                    firstClaim.id,
                    'secret-claim-v1',
                    operationTime
                )
            ).toBe(true)
            expect(
                fixture.deliveries.completeExternalEffect({
                    jobId: firstClaim.id,
                    claimToken: 'secret-claim-v1',
                    completedAt: operationTime,
                    outcome: { type: 'published', externalId: 'provider-1' },
                })
            ).toBe('published')

            const secondSecret = await fixture.secrets.setSecret({
                projectId: fixture.project.project.id,
                subjectId: 'human-1',
                destinationId: destination.id,
                material: { bearerToken: 'notification-secret-v2' },
            })
            expect(secondSecret).toMatchObject({ version: 2, state: 'active' })
            if (secondSecret === null) throw new Error('The rotated secret is missing')

            appendPublicationEvent(fixture, {
                id: 'event-secret-v2',
                name: 'publication.execution.failed',
            })
            expect(fixture.deliveries.project(fixture.project.project.id).created).toBe(1)
            expect(
                fixture.deliveries.listDestinations(fixture.project.project.id, 'human-1')
            ).toMatchObject([{ secretVersion: 2 }])

            const deliveries = fixture.deliveries.list(fixture.project.project.id, 'human-1')
            expect(
                deliveries
                    ?.map(delivery => delivery.secretVersion)
                    .sort((left, right) => (right ?? 0) - (left ?? 0))
            ).toEqual([2, 1])

            const secondClaim = fixture.deliveries.claimNextDueJob({
                actorId: 'system-1',
                claimToken: 'secret-claim-v2',
                now: operationTime,
                leaseExpiresAt: operationTime + 100,
            })
            if (secondClaim === null) throw new Error('The second delivery was not claimed')
            expect(
                await fixture.secrets.resolveForClaim({
                    projectId: fixture.project.project.id,
                    deliveryId: secondClaim.id,
                    claimToken: 'secret-claim-v2',
                })
            ).toEqual({ bearerToken: 'notification-secret-v2' })
            expect(
                await fixture.secrets.resolveForClaim({
                    projectId: 'other-project',
                    deliveryId: secondClaim.id,
                    claimToken: 'secret-claim-v2',
                })
            ).toBeNull()

            const wrongKeyStore = createNotificationDestinationSecretStore(fixture.database, {
                cipher: createNotificationDestinationSecretCipher({
                    keyId: 'notification-test-v1',
                    key: new Uint8Array(32).fill(9),
                }),
            })
            let wrongKeyError: unknown
            try {
                await wrongKeyStore.resolveForClaim({
                    projectId: fixture.project.project.id,
                    deliveryId: secondClaim.id,
                    claimToken: 'secret-claim-v2',
                })
            } catch (error) {
                wrongKeyError = error
            }
            expect(wrongKeyError).toBeInstanceOf(SecretCipherError)

            const storedCiphertext = fixture.database.$client
                .query<{ readonly ciphertext: Uint8Array }, [id: string]>(
                    'select ciphertext from notification_destination_secrets where id = ?1'
                )
                .get(secondSecret.id)
            if (storedCiphertext === null) throw new Error('The stored secret is missing')
            const tamperedCiphertext = Uint8Array.from(storedCiphertext.ciphertext)
            tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1
            fixture.database.$client
                .query<void, [ciphertext: Uint8Array, id: string]>(
                    'update notification_destination_secrets set ciphertext = ?1 where id = ?2'
                )
                .run(tamperedCiphertext, secondSecret.id)
            let tamperingError: unknown
            try {
                await fixture.secrets.resolveForClaim({
                    projectId: fixture.project.project.id,
                    deliveryId: secondClaim.id,
                    claimToken: 'secret-claim-v2',
                })
            } catch (error) {
                tamperingError = error
            }
            expect(tamperingError).toBeInstanceOf(SecretCipherError)

            const storedSecrets = fixture.database.$client
                .query<
                    {
                        readonly state: string
                        readonly ciphertext: Uint8Array
                        readonly nonce: Uint8Array
                    },
                    []
                >(
                    'select state, ciphertext, nonce from notification_destination_secrets order by version'
                )
                .all()
            expect(storedSecrets.map(secret => secret.state)).toEqual(['retired', 'active'])
            expect(new TextDecoder().decode(storedSecrets[0]?.ciphertext)).not.toContain(
                'notification-secret-v1'
            )
            expect(new TextDecoder().decode(storedSecrets[1]?.ciphertext)).not.toContain(
                'notification-secret-v2'
            )
            expect(storedSecrets.every(secret => secret.nonce.byteLength === 12)).toBe(true)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('projects independent subscriptions for human destinations and snapshots configuration', () => {
        const fixture = createFixture()
        try {
            const destination = addDestination(fixture)
            fixture.inbox.updatePreference({
                projectId: fixture.project.project.id,
                subjectId: 'human-1',
                kind: 'publication_failed',
                inAppEnabled: false,
            })
            appendPublicationEvent(fixture, {
                id: 'event-failed',
                name: 'publication.execution.failed',
            })

            expect(fixture.deliveries.project(fixture.project.project.id)).toEqual({
                scanned: 2,
                created: 1,
                hasMore: false,
            })
            expect(fixture.deliveries.project(fixture.project.project.id).created).toBe(0)
            expect(fixture.deliveries.list(fixture.project.project.id, 'human-1')).toMatchObject([
                {
                    destinationId: destination.id,
                    transportId: 'test',
                    configuration: { topic: 'postdot-test' },
                    kind: 'publication_failed',
                    state: 'pending',
                    attempts: 0,
                },
            ])
            expect(
                fixture.inbox.list({
                    projectId: fixture.project.project.id,
                    subjectId: 'human-1',
                })?.items
            ).toEqual([])
            expect(() =>
                fixture.database.$client.run(
                    `delete from notification_destinations where id = '${destination.id}'`
                )
            ).toThrow()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps projection writes atomic and skips unsupported facts without poisoning the cursor', () => {
        const fixture = createFixture()
        try {
            addDestination(fixture)
            appendPublicationEvent(fixture, {
                id: 'event-future',
                name: 'publication.execution.failed',
                version: 2,
            })
            appendPublicationEvent(fixture, {
                id: 'event-supported',
                name: 'publication.execution.succeeded',
            })
            fixture.database.$client.run(`
                create trigger reject_delivery_cursor
                before insert on notification_delivery_projection_cursors
                begin
                    select raise(abort, 'cursor rejected');
                end
            `)

            expect(() => fixture.deliveries.project(fixture.project.project.id)).toThrow()
            expect(fixture.deliveries.list(fixture.project.project.id, 'human-1')).toEqual([])

            fixture.database.$client.run('drop trigger reject_delivery_cursor')
            expect(fixture.deliveries.project(fixture.project.project.id)).toEqual({
                scanned: 3,
                created: 1,
                hasMore: false,
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('requires a human owner and keeps destination access project-scoped', () => {
        const fixture = createFixture()
        try {
            const destination = addDestination(fixture)
            expect(
                fixture.deliveries.createDestination({
                    projectId: fixture.project.project.id,
                    subjectId: 'machine-1',
                    transportId: 'test',
                    label: 'Invalid',
                    configuration: {},
                })
            ).toBeNull()
            expect(
                fixture.deliveries.subscribe({
                    projectId: fixture.project.project.id,
                    subjectId: 'other-human',
                    destinationId: destination.id,
                    kind: 'publication_failed',
                    enabled: true,
                })
            ).toBeNull()
            expect(() =>
                fixture.deliveries.createDestination({
                    projectId: fixture.project.project.id,
                    subjectId: 'human-1',
                    transportId: 'test',
                    label: 'Invalid',
                    configuration: JSON.parse('{"__proto__": null}'),
                })
            ).not.toThrow()
            expect(() =>
                fixture.deliveries.createDestination({
                    projectId: fixture.project.project.id,
                    subjectId: 'human-1',
                    transportId: 'test',
                    label: 'Invalid',
                    configuration: 'not-an-object' as never,
                })
            ).toThrow(DomainInvariantError)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fences concurrent claims and requeues a pre-effect lease', () => {
        const fixture = createFixture()
        try {
            addDestination(fixture)
            appendPublicationEvent(fixture, {
                id: 'event-claim',
                name: 'publication.execution.failed',
            })
            fixture.deliveries.project(fixture.project.project.id)
            const secondStore = createNotificationDeliveryStore(fixture.database, {
                createId: () => crypto.randomUUID(),
                now: () => operationTime,
            })
            expect(() =>
                fixture.deliveries.claimNextDueJob({
                    actorId: 'system-1',
                    claimToken: 'claim-invalid',
                    now: operationTime,
                    leaseExpiresAt: operationTime,
                })
            ).toThrow(DomainInvariantError)
            const first = fixture.deliveries.claimNextDueJob({
                actorId: 'system-1',
                claimToken: 'claim-one',
                now: operationTime,
                leaseExpiresAt: operationTime + 100,
            })
            if (first === null) throw new Error('The delivery was not claimed')
            expect(first?.attempts).toBe(1)
            expect(
                secondStore.claimNextDueJob({
                    actorId: 'system-2',
                    claimToken: 'claim-two',
                    now: operationTime,
                    leaseExpiresAt: operationTime + 100,
                })
            ).toBeNull()
            expect(fixture.deliveries.recoverExpiredClaims(operationTime + 101)).toEqual({
                requeuedJobIds: [first.id],
                ambiguousJobIds: [],
            })
            expect(
                fixture.deliveries.claimNextDueJob({
                    actorId: 'system-1',
                    claimToken: 'claim-three',
                    now: operationTime + 101,
                    leaseExpiresAt: operationTime + 201,
                })?.attempts
            ).toBe(2)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('makes post-effect expiry ambiguous and only retries explicit no-effect failures', () => {
        const fixture = createFixture()
        try {
            addDestination(fixture)
            appendPublicationEvent(fixture, {
                id: 'event-effect',
                name: 'publication.execution.failed',
            })
            fixture.deliveries.project(fixture.project.project.id)
            const claimed = fixture.deliveries.claimNextDueJob({
                actorId: 'system-1',
                claimToken: 'claim-effect',
                now: operationTime,
                leaseExpiresAt: operationTime + 100,
            })
            if (claimed === null) throw new Error('The delivery was not claimed')
            expect(() =>
                fixture.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-effect',
                    completedAt: operationTime + 1,
                    outcome: { type: 'published' },
                })
            ).toThrow(DomainInvariantError)
            expect(
                fixture.deliveries.startExternalEffect(
                    claimed.id,
                    'claim-effect',
                    operationTime + 1
                )
            ).toBe(true)
            expect(fixture.deliveries.recoverExpiredClaims(operationTime + 101)).toEqual({
                requeuedJobIds: [],
                ambiguousJobIds: [claimed.id],
            })
            expect(fixture.deliveries.list(fixture.project.project.id, 'human-1')?.[0]?.state).toBe(
                'ambiguous'
            )

            appendPublicationEvent(fixture, {
                id: 'event-retry',
                name: 'publication.execution.ambiguous',
            })
            fixture.deliveries.project(fixture.project.project.id)
            const retryClaim = fixture.deliveries.claimNextDueJob({
                actorId: 'system-1',
                claimToken: 'claim-retry',
                now: operationTime,
                leaseExpiresAt: operationTime + 100,
            })
            if (retryClaim === null) throw new Error('The retry delivery was not claimed')
            fixture.deliveries.startExternalEffect(retryClaim.id, 'claim-retry', operationTime)
            expect(
                fixture.deliveries.completeExternalEffect({
                    jobId: retryClaim.id,
                    claimToken: 'claim-retry',
                    completedAt: operationTime + 1,
                    outcome: {
                        type: 'retryable_failure',
                        effectOccurred: false,
                        errorMessage: 'temporary',
                    },
                    retryAt: operationTime + 100,
                })
            ).toBe('retry_scheduled')
            expect(
                fixture.deliveries
                    .list(fixture.project.project.id, 'human-1')
                    ?.find(item => item.id === retryClaim.id)?.state
            ).toBe('pending')

            const retryAttempt = fixture.deliveries.claimNextDueJob({
                actorId: 'system-1',
                claimToken: 'claim-retry-attempt',
                now: operationTime + 100,
                leaseExpiresAt: operationTime + 200,
            })
            if (retryAttempt === null) throw new Error('The retry attempt was not claimed')
            expect(fixture.deliveries.recoverExpiredClaims(operationTime + 201)).toEqual({
                requeuedJobIds: [retryAttempt.id],
                ambiguousJobIds: [],
            })

            const retryPolicy = createExponentialRetryPolicy({
                maxAttempts: 3,
                initialDelay: 100,
                maximumDelay: 1_000,
            })
            expect(
                retryPolicy.nextRunAt({ attempts: retryClaim.attempts, failedAt: operationTime })
            ).toBe(operationTime + 100)
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
