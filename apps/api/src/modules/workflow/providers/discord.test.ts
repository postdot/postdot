import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import type { PublisherExecutionMedia, PublisherExecutionTarget } from '@herald/db'
import type { DiscordPublishOutcome, DiscordPublisher } from '@herald/discord'
import { discordChannelProfile } from '@herald/discord'

import { createDiscordProviderAdapter } from './discord'
import type {
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
    PublisherCredentialExecutionPort,
} from './registry'

const now = 1_800_000_000_000
const BOT_TOKEN = 'discord-bot-token-that-must-not-become-domain-data'
const CHANNEL_ID = '123456789012345678'
const BOT_USER_ID = '987654321098765432'

function createTarget(overrides: Partial<PublisherExecutionTarget> = {}): PublisherExecutionTarget {
    return {
        jobId: 'job-discord',
        projectId: 'project-discord',
        publicationId: 'publication-discord',
        scheduledAt: now,
        executionRevisionId: 'execution-revision-1',
        profileVersionId: 'profile-version-1',
        mediaReferenceCount: 0,
        profile: discordChannelProfile,
        content: { text: 'Hello Discord', media: [] },
        publisherId: 'publisher-discord',
        channelId: 'channel-discord',
        channelName: 'Discord channel',
        kind: 'discord',
        credentialId: 'credential-discord',
        externalAccountId: BOT_USER_ID,
        destination: { type: 'channel', id: CHANNEL_ID, name: 'announcements' },
        providerId: 'discord',
        credentialState: 'active',
        credentialExpiresAt: null,
        endpointUrl: null,
        authentication: null,
        attempt: 1,
        media: [],
        ...overrides,
    }
}

function createCredentials() {
    let reconnectCalls = 0
    const port: PublisherCredentialExecutionPort = {
        async resolvePublisherCredentialSecrets() {
            return { accessToken: BOT_TOKEN, refreshToken: null, providerSession: null }
        },
        async replacePublisherCredentialTokens() {
            return { kind: 'conflict' }
        },
        markPublisherCredentialReconnectRequired() {
            reconnectCalls += 1
        },
    }
    return {
        port,
        get reconnectCalls() {
            return reconnectCalls
        },
    }
}

function createUncalledDeliveryPort(): ProviderMediaDeliveryPort {
    const uncalled = (): never => {
        throw new Error('The media delivery port must not be called by this fixture')
    }
    return {
        reserve: uncalled,
        start: uncalled,
        recordRemoteMediaId: uncalled,
        complete: uncalled,
        fail: uncalled,
        retry: uncalled,
    }
}

function createPublisherStub(outcome: DiscordPublishOutcome, onDispatch: () => void) {
    let dispatched = false
    const publisher: DiscordPublisher = {
        async getBotUser() {
            return { kind: 'success', value: { id: BOT_USER_ID, username: 'Herald' } }
        },
        async getChannel() {
            return { kind: 'success', value: { id: CHANNEL_ID, name: 'announcements', type: 0 } }
        },
        async createMessage() {
            dispatched = true
            onDispatch()
            return outcome
        },
    }
    return {
        publisher,
        get dispatched() {
            return dispatched
        },
    }
}

function executeWith(
    target: PublisherExecutionTarget,
    publisher: DiscordPublisher,
    deliveryPort: ProviderMediaDeliveryPort = createUncalledDeliveryPort()
) {
    const credentials = createCredentials()
    const adapter = createDiscordProviderAdapter({ createPublisher: () => publisher })
    const input: BuiltInProviderExecutionInput = {
        target,
        now,
        credentials: credentials.port,
        providerMediaDeliveryStore: deliveryPort,
    }
    return { adapter, credentials, input }
}

describe('Discord provider adapter', () => {
    it('publishes text and keeps the Bot token out of the outcome', async () => {
        const stub = createPublisherStub(
            { type: 'published', externalId: '111111111111111111' },
            () => undefined
        )
        const { adapter, input } = executeWith(createTarget(), stub.publisher)

        const outcome = await adapter.execute(input)

        expect(outcome).toEqual({ type: 'published', externalId: '111111111111111111' })
        expect(stub.dispatched).toBe(true)
        expect(JSON.stringify(outcome)).not.toContain(BOT_TOKEN)
    })

    it('marks the credential for reconnect on authentication failures only', async () => {
        const unauthorized = createPublisherStub(
            {
                type: 'permanent_failure',
                effectOccurred: false,
                code: 'authentication_required',
                errorMessage: 'Unauthorized',
            },
            () => undefined
        )
        const first = executeWith(createTarget(), unauthorized.publisher)
        await expect(first.adapter.execute(first.input)).resolves.toMatchObject({
            type: 'permanent_failure',
        })
        expect(first.credentials.reconnectCalls).toBe(1)

        const forbidden = createPublisherStub(
            {
                type: 'permanent_failure',
                effectOccurred: false,
                code: 'forbidden',
                errorMessage: 'Missing permissions',
            },
            () => undefined
        )
        const second = executeWith(createTarget(), forbidden.publisher)
        await expect(second.adapter.execute(second.input)).resolves.toMatchObject({
            type: 'permanent_failure',
        })
        expect(second.credentials.reconnectCalls).toBe(0)
    })

    it('rejects Discord media violations before dispatch', async () => {
        const cases: Array<{ readonly name: string; readonly target: PublisherExecutionTarget }> = [
            {
                name: 'too many attachments',
                target: createTarget({
                    content: { text: 'Hello', media: [] },
                    media: Array.from({ length: 11 }, (_, index) => mediaFixture(index).media),
                    mediaReferenceCount: 11,
                }),
            },
            {
                name: 'unsupported family',
                target: createTarget({
                    content: { text: 'Hello', media: [] },
                    media: [{ ...mediaFixture(0).media, family: 'video' as const }],
                    mediaReferenceCount: 1,
                }),
            },
            {
                name: 'oversize image',
                target: createTarget({
                    content: { text: 'Hello', media: [] },
                    media: [{ ...mediaFixture(0).media, byteSize: 11 * 1024 * 1024 }],
                    mediaReferenceCount: 1,
                }),
            },
            {
                name: 'missing accessibility text',
                target: createTarget({
                    content: { text: 'Hello', media: [] },
                    media: [{ ...mediaFixture(0).media, accessibilityText: null }],
                    mediaReferenceCount: 1,
                }),
            },
        ]

        for (const testCase of cases) {
            let dispatched = false
            const stub = createPublisherStub(
                { type: 'published', externalId: '222222222222222222' },
                () => {
                    dispatched = true
                }
            )
            const { adapter, input } = executeWith(testCase.target, stub.publisher)
            await expect(adapter.execute(input), testCase.name).resolves.toMatchObject({
                type: 'permanent_failure',
            })
            expect(dispatched, testCase.name).toBe(false)
        }
    })

    it('completes the durable media checkpoint when the message publishes', async () => {
        const fixture = mediaFixture(0)
        const deliveries = createRecordingDeliveryPort()
        const media = createMediaStoreStub(new Uint8Array([1, 2, 3, 4]))
        let dispatched = false
        const stub = createPublisherStub(
            {
                type: 'published',
                externalId: '333333333333333333',
                attachmentIds: ['444444444444444444'],
            },
            () => {
                dispatched = true
            }
        )
        const credentials = createCredentials()
        const adapter = createDiscordProviderAdapter({ createPublisher: () => stub.publisher })
        const input: BuiltInProviderExecutionInput = {
            target: createTarget({
                content: { text: 'Release notes', media: [] },
                media: [fixture.media],
                mediaReferenceCount: 1,
            }),
            now,
            credentials: credentials.port,
            media,
            providerMediaDeliveryStore: deliveries.port,
        }

        const outcome = await adapter.execute(input)

        expect(outcome).toMatchObject({
            type: 'published',
            externalId: '333333333333333333',
        })
        expect((outcome as { readonly attachmentIds?: readonly string[] }).attachmentIds).toEqual([
            '444444444444444444',
        ])
        expect(dispatched).toBe(true)
        expect(deliveries.completed).toEqual([
            { deliveryId: expect.any(String), remoteMediaId: '444444444444444444' },
        ])
        expect(JSON.stringify(outcome)).not.toContain(BOT_TOKEN)
    })

    it('marks deliveries ambiguous when the message outcome is unknown', async () => {
        const fixture = mediaFixture(0)
        const deliveries = createRecordingDeliveryPort()
        const media = createMediaStoreStub(new Uint8Array([1, 2, 3, 4]))
        const stub = createPublisherStub(
            {
                type: 'ambiguous',
                code: 'provider_failure',
                errorMessage: 'Discord did not confirm the message',
            },
            () => undefined
        )
        const credentials = createCredentials()
        const adapter = createDiscordProviderAdapter({ createPublisher: () => stub.publisher })
        const input: BuiltInProviderExecutionInput = {
            target: createTarget({
                content: { text: 'Hello', media: [] },
                media: [fixture.media],
                mediaReferenceCount: 1,
            }),
            now,
            credentials: credentials.port,
            media,
            providerMediaDeliveryStore: deliveries.port,
        }

        const outcome = await adapter.execute(input)

        expect(outcome).toMatchObject({ type: 'ambiguous' })
        expect(deliveries.failed[0]?.ambiguous).toBe(true)
    })
})

function mediaFixture(index: number): { readonly media: PublisherExecutionMedia } {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return {
        media: {
            id: `execution-media-${index}`,
            projectId: 'project-discord',
            executionRevisionId: 'execution-revision-1',
            targetRevisionMediaId: `target-media-${index}`,
            assetId: `asset-${index}`,
            representationId: `representation-${index}`,
            position: index,
            contentPath: `/media/${index}`,
            role: null,
            accessibilityText: 'A Discord image',
            originalFilename: `image-${index}.png`,
            contentType: 'image/png',
            family: 'image',
            byteSize: bytes.byteLength,
            sha256,
            width: 1,
            height: 1,
            durationMs: null,
            storeId: 'local',
            objectKey: `projects/project-discord/media/representation-${index}`,
        },
    }
}

function createMediaStoreStub(bytes: Uint8Array) {
    return {
        async openRepresentationContent() {
            return {
                representation: {
                    storeId: 'local',
                    objectKey: 'projects/project-discord/media/representation-0',
                },
                size: bytes.byteLength,
                contentType: 'image/png',
                sha256: createHash('sha256').update(bytes).digest('hex'),
                lastModified: now,
                stream: new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(bytes)
                        controller.close()
                    },
                }),
            }
        },
    } as unknown as NonNullable<BuiltInProviderExecutionInput['media']>
}

function createRecordingDeliveryPort() {
    const completed: Array<{ readonly deliveryId: string; readonly remoteMediaId: string }> = []
    const failed: Array<{ readonly deliveryId: string; readonly ambiguous: boolean }> = []
    let sequence = 0
    const port: ProviderMediaDeliveryPort = {
        reserve(input) {
            sequence += 1
            return {
                id: `delivery-${sequence}`,
                projectId: input.projectId,
                executionMediaId: input.executionMediaId,
                publisherId: input.publisherId,
                providerId: 'discord',
                state: 'pending',
                attempts: 0,
                remoteMediaId: null,
                remoteMediaUrl: null,
                lastAttemptAt: null,
                completedAt: null,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            }
        },
        start(input) {
            return {
                id: input.deliveryId,
                projectId: input.projectId,
                executionMediaId: 'execution-media-0',
                publisherId: 'publisher-discord',
                providerId: 'discord',
                state: 'uploading',
                attempts: 1,
                remoteMediaId: null,
                remoteMediaUrl: null,
                lastAttemptAt: now,
                completedAt: null,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            }
        },
        recordRemoteMediaId(input) {
            return {
                id: input.deliveryId,
                projectId: input.projectId,
                executionMediaId: 'execution-media-0',
                publisherId: 'publisher-discord',
                providerId: 'discord',
                state: 'uploading',
                attempts: 1,
                remoteMediaId: input.remoteMediaId,
                remoteMediaUrl: null,
                lastAttemptAt: now,
                completedAt: null,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            }
        },
        complete(input) {
            completed.push({ deliveryId: input.deliveryId, remoteMediaId: input.remoteMediaId })
            return {
                id: input.deliveryId,
                projectId: input.projectId,
                executionMediaId: 'execution-media-0',
                publisherId: 'publisher-discord',
                providerId: 'discord',
                state: 'uploaded',
                attempts: 1,
                remoteMediaId: input.remoteMediaId,
                remoteMediaUrl: null,
                lastAttemptAt: now,
                completedAt: now,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            }
        },
        fail(input) {
            failed.push({ deliveryId: input.deliveryId, ambiguous: input.ambiguous ?? false })
            return {
                id: input.deliveryId,
                projectId: input.projectId,
                executionMediaId: 'execution-media-0',
                publisherId: 'publisher-discord',
                providerId: 'discord',
                state: input.ambiguous === true ? ('ambiguous' as const) : ('failed' as const),
                attempts: 1,
                remoteMediaId: null,
                remoteMediaUrl: null,
                lastAttemptAt: now,
                completedAt: null,
                errorCode: input.errorCode,
                errorMessage: input.errorMessage,
                createdAt: now,
                updatedAt: now,
            }
        },
        retry(input) {
            return {
                id: input.deliveryId,
                projectId: input.projectId,
                executionMediaId: 'execution-media-0',
                publisherId: 'publisher-discord',
                providerId: 'discord',
                state: 'pending',
                attempts: 1,
                remoteMediaId: null,
                remoteMediaUrl: null,
                lastAttemptAt: now,
                completedAt: null,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            }
        },
    }
    return { port, completed, failed }
}
