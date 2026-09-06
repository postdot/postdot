import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import {
    blueskyChannelProfile,
    createBlueskyClientMetadata,
    type BlueskyPublishOutcome,
    type BlueskyPublisher,
} from '@herald/bluesky'
import type { ChannelProfileDefinition, ExternalEffectOutcome } from '@herald/core'
import type {
    PublisherConnectionDestination,
    PublisherExecutionMedia,
    PublisherExecutionTarget,
} from '@herald/db'
import {
    DISCORD_PROVIDER,
    discordChannelProfile,
    type DiscordPublishOutcome,
    type DiscordPublisher,
} from '@herald/discord'
import {
    linkedinChannelProfile,
    type LinkedInImagePublisher,
    type LinkedInMediaUploadOutcome,
    type LinkedInPublishOutcome,
    type LinkedInTextPublisher,
} from '@herald/linkedin'
import {
    MASTODON_PROVIDER,
    mastodonChannelProfile,
    type MastodonPublishOutcome,
    type MastodonPublisher,
} from '@herald/mastodon'
import { X_PROVIDER, xChannelProfile, type XPublishOutcome, type XPublisher } from '@herald/x'

import { createBlueskyProviderAdapter, type BlueskyProviderAdapterOptions } from './bluesky'
import { createDiscordProviderAdapter } from './discord'
import { createLinkedInProviderAdapter } from './linkedin'
import { createMastodonProviderAdapter } from './mastodon'
import {
    createBuiltInProviderRegistry,
    type BuiltInProviderAdapter,
    type BuiltInProviderExecutionInput,
    type ProviderMediaDeliveryPort,
    type PublisherCredentialExecutionPort,
} from './registry'
import { createXProviderAdapter } from './x'

const now = 1_800_000_000_000
const credentialSecret = 'conformance-secret-that-must-not-become-domain-data'
const blueskyDid = 'did:plc:herald-conformance'
const blueskySession = JSON.stringify({
    tokenSet: {
        sub: blueskyDid,
        access_token: 'bluesky-access-token',
        refresh_token: 'bluesky-refresh-token',
        expires_at: new Date(now + 3_600_000).toISOString(),
    },
})

const blueskyOAuth: NonNullable<BlueskyProviderAdapterOptions['oauth']> = {
    clientMetadata: createBlueskyClientMetadata({
        clientId: 'https://herald.test/oauth/bluesky/client-metadata.json',
        clientName: 'Herald conformance test',
        clientUri: 'https://herald.test',
        redirectUri: 'https://herald.test/api/oauth/bluesky/callback',
    }),
    handleResolver: 'https://bsky.social',
}

const outcomes = [
    { type: 'published', externalId: 'provider-publication-1' },
    {
        type: 'retryable_failure',
        effectOccurred: false,
        code: 'rate_limited',
        errorMessage: 'The provider asked Herald to retry later',
    },
    {
        type: 'permanent_failure',
        effectOccurred: false,
        code: 'invalid_input',
        errorMessage: 'The provider rejected the publication input',
    },
    {
        type: 'ambiguous',
        code: 'provider_failure',
        errorMessage: 'The provider did not confirm the publication outcome',
    },
] as const

interface AdapterConformanceCase {
    readonly name: string
    readonly providerId: string
    readonly profile: ChannelProfileDefinition
    readonly content: Readonly<Record<string, unknown>>
    readonly destination: PublisherConnectionDestination
    readonly externalAccountId: string
    readonly providerSession: string | null
    readonly endpointUrl: string | null
    createAdapter(outcome: ExternalEffectOutcome, onDispatch: () => void): BuiltInProviderAdapter
}

const adapterCases: readonly AdapterConformanceCase[] = [
    {
        name: 'LinkedIn',
        providerId: 'linkedin',
        profile: linkedinChannelProfile,
        content: { commentary: 'A conformance publication', media: [] },
        destination: { type: 'member', id: 'member-conformance', name: 'Conformance member' },
        externalAccountId: 'member-conformance',
        providerSession: null,
        endpointUrl: null,
        createAdapter(outcome, onDispatch) {
            const textPublisher: LinkedInTextPublisher = {
                async publishText() {
                    onDispatch()
                    return outcome as LinkedInPublishOutcome
                },
            }
            const imagePublisher: LinkedInImagePublisher = {
                async uploadImage() {
                    onDispatch()
                    const outcome: LinkedInMediaUploadOutcome = {
                        type: 'uploaded',
                        remoteMediaId: 'provider-media-1',
                    }
                    return outcome
                },
                async publishImage() {
                    onDispatch()
                    return outcome as LinkedInPublishOutcome
                },
            }
            return createLinkedInProviderAdapter({ textPublisher, imagePublisher })
        },
    },
    {
        name: 'Bluesky',
        providerId: 'bluesky',
        profile: blueskyChannelProfile,
        content: { text: 'A conformance publication', media: [] },
        destination: { type: 'account', id: blueskyDid, name: 'Conformance account' },
        externalAccountId: blueskyDid,
        providerSession: blueskySession,
        endpointUrl: null,
        createAdapter(outcome, onDispatch) {
            const restoreSession: NonNullable<
                BlueskyProviderAdapterOptions['restoreSession']
            > = async () => ({
                client: undefined as never,
                session: { did: blueskyDid } as never,
                getSession: () => undefined as never,
                getSerializedSession: () => blueskySession,
            })
            const createPublisher: NonNullable<
                BlueskyProviderAdapterOptions['createPublisher']
            > = () => {
                const publisher: BlueskyPublisher = {
                    async publish() {
                        onDispatch()
                        return outcome as BlueskyPublishOutcome
                    },
                }
                return publisher
            }
            return createBlueskyProviderAdapter({
                oauth: blueskyOAuth,
                restoreSession,
                createPublisher,
            })
        },
    },
    {
        name: 'Mastodon',
        providerId: MASTODON_PROVIDER,
        profile: mastodonChannelProfile,
        content: { text: 'A conformance publication', media: [] },
        destination: { type: 'account', id: 'mastodon-account-1', name: 'Conformance account' },
        externalAccountId: 'mastodon-account-1',
        endpointUrl: 'https://mastodon.example',
        providerSession: JSON.stringify({
            version: 1,
            instanceUrl: 'https://mastodon.example',
            clientId: 'mastodon-client-id',
            clientSecret: 'mastodon-client-secret',
        }),
        createAdapter(outcome, onDispatch) {
            const publisher: MastodonPublisher = {
                async registerApplication() {
                    return {
                        kind: 'success',
                        value: { clientId: 'client-id', clientSecret: 'client-secret' },
                    }
                },
                async verifyCredentials() {
                    return {
                        kind: 'success',
                        value: {
                            id: 'mastodon-account-1',
                            acct: 'conformance@example.social',
                            username: 'conformance',
                            displayName: 'Conformance account',
                        },
                    }
                },
                async uploadMedia() {
                    return { type: 'uploaded', remoteMediaId: 'provider-media-1', ready: true }
                },
                async getMedia() {
                    return {
                        kind: 'success',
                        value: {
                            id: 'provider-media-1',
                            type: 'image',
                            url: 'https://mastodon.example/media/provider-media-1',
                        },
                    }
                },
                async publishStatus() {
                    onDispatch()
                    return outcome as MastodonPublishOutcome
                },
            }
            return createMastodonProviderAdapter({ createPublisher: () => publisher })
        },
    },
    {
        name: 'Discord',
        providerId: DISCORD_PROVIDER,
        profile: discordChannelProfile,
        content: { text: 'A conformance publication', media: [] },
        destination: {
            type: 'channel',
            id: '123456789012345678',
            name: 'Conformance channel',
        },
        externalAccountId: '987654321098765432',
        endpointUrl: null,
        providerSession: null,
        createAdapter(outcome, onDispatch) {
            const publisher: DiscordPublisher = {
                async getBotUser() {
                    return {
                        kind: 'success',
                        value: { id: '987654321098765432', username: 'Herald' },
                    }
                },
                async getChannel() {
                    return {
                        kind: 'success',
                        value: { id: '123456789012345678', name: 'Conformance channel', type: 0 },
                    }
                },
                async createMessage() {
                    onDispatch()
                    return outcome as DiscordPublishOutcome
                },
            }
            return createDiscordProviderAdapter({ createPublisher: () => publisher })
        },
    },
    {
        name: 'X',
        providerId: X_PROVIDER,
        profile: xChannelProfile,
        content: { text: 'A conformance publication', media: [] },
        destination: { type: 'account', id: 'x-account-1', name: 'Conformance account' },
        externalAccountId: 'x-account-1',
        endpointUrl: null,
        providerSession: null,
        createAdapter(outcome, onDispatch) {
            const publisher: XPublisher = {
                async getMe() {
                    return {
                        kind: 'success',
                        value: {
                            id: 'x-account-1',
                            name: 'Conformance account',
                            username: 'conformance',
                        },
                    }
                },
                async uploadMedia() {
                    return { type: 'uploaded', remoteMediaId: 'provider-media-1', ready: true }
                },
                async publishTweet() {
                    onDispatch()
                    return outcome as XPublishOutcome
                },
            }
            return createXProviderAdapter({ publisher })
        },
    },
]

const conformanceMedia: PublisherExecutionMedia = {
    id: 'execution-media-1',
    projectId: 'project-conformance',
    executionRevisionId: 'execution-revision-1',
    targetRevisionMediaId: 'target-media-1',
    assetId: 'asset-1',
    representationId: 'representation-1',
    position: 0,
    contentPath: '/media/0',
    role: null,
    accessibilityText: 'A conformance image',
    originalFilename: 'conformance.png',
    contentType: 'image/png',
    family: 'image',
    byteSize: 4,
    sha256: 'sha256:conformance',
    width: 1,
    height: 1,
    durationMs: null,
    storeId: 'local',
    objectKey: 'projects/project-conformance/media/representation-1',
}

function createTarget(
    provider: AdapterConformanceCase,
    overrides: Partial<
        Pick<PublisherExecutionTarget, 'content' | 'destination' | 'media' | 'mediaReferenceCount'>
    > = {}
): PublisherExecutionTarget {
    const media = overrides.media ?? []
    return {
        jobId: 'job-conformance',
        projectId: 'project-conformance',
        publicationId: 'publication-conformance',
        scheduledAt: now,
        executionRevisionId: 'execution-revision-1',
        profileVersionId: 'profile-version-1',
        mediaReferenceCount: overrides.mediaReferenceCount ?? media.length,
        profile: provider.profile,
        content: overrides.content ?? provider.content,
        publisherId: 'publisher-conformance',
        channelId: 'channel-conformance',
        channelName: `${provider.name} conformance channel`,
        kind: provider.providerId,
        credentialId: 'credential-conformance',
        externalAccountId: provider.externalAccountId,
        destination: overrides.destination ?? provider.destination,
        providerId: provider.providerId,
        credentialState: 'active',
        credentialExpiresAt: null,
        endpointUrl: provider.endpointUrl,
        authentication: null,
        attempt: 1,
        media,
    }
}

function createCredentialPort(input: {
    readonly available: boolean
    readonly providerSession: string | null
}) {
    let resolveCalls = 0
    let reconnectCalls = 0
    const port: PublisherCredentialExecutionPort = {
        async resolvePublisherCredentialSecrets() {
            resolveCalls += 1
            if (!input.available) return null
            return {
                accessToken: credentialSecret,
                refreshToken: null,
                providerSession: input.providerSession,
            }
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
        get resolveCalls() {
            return resolveCalls
        },
        get reconnectCalls() {
            return reconnectCalls
        },
    }
}

function createUncalledMediaDeliveryPort(): ProviderMediaDeliveryPort {
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

function createExecutionFixture(
    provider: AdapterConformanceCase,
    options: {
        readonly credentialsAvailable?: boolean
        readonly target?: Partial<
            Pick<
                PublisherExecutionTarget,
                'content' | 'destination' | 'media' | 'mediaReferenceCount'
            >
        >
    } = {}
) {
    const credentials = createCredentialPort({
        available: options.credentialsAvailable ?? true,
        providerSession: provider.providerSession,
    })
    const input: BuiltInProviderExecutionInput = {
        target: createTarget(provider, options.target),
        now,
        credentials: credentials.port,
        providerMediaDeliveryStore: createUncalledMediaDeliveryPort(),
    }
    return { credentials, input }
}

describe('built-in provider adapter conformance', () => {
    it('registers each adapter under its exact provider and execution identity', () => {
        const adapters = adapterCases.map(provider =>
            provider.createAdapter(outcomes[0]!, () => undefined)
        )
        const registry = createBuiltInProviderRegistry(adapters)

        for (const [index, provider] of adapterCases.entries()) {
            const adapter = adapters[index]!
            expect(
                registry.resolve({
                    providerId: provider.providerId,
                    kind: provider.providerId,
                    execution: provider.profile.execution,
                })
            ).toBe(adapter)
        }
    })

    for (const provider of adapterCases) {
        describe(`${provider.name} adapter`, () => {
            it('forwards published, retryable, permanent, and ambiguous outcomes', async () => {
                for (const outcome of outcomes) {
                    let dispatched = false
                    const adapter = provider.createAdapter(outcome, () => {
                        dispatched = true
                    })
                    const fixture = createExecutionFixture(provider)

                    await expect(adapter.execute(fixture.input)).resolves.toEqual(outcome)
                    expect(dispatched).toBe(true)
                    expect(fixture.credentials.resolveCalls).toBe(1)
                    expect(JSON.stringify(outcome)).not.toContain(credentialSecret)
                }
            })

            it('fails closed when the project credential is unavailable', async () => {
                let dispatched = false
                const adapter = provider.createAdapter(outcomes[0]!, () => {
                    dispatched = true
                })
                const fixture = createExecutionFixture(provider, {
                    credentialsAvailable: false,
                })

                await expect(adapter.execute(fixture.input)).resolves.toMatchObject({
                    type: 'permanent_failure',
                })
                expect(dispatched).toBe(false)
                expect(fixture.credentials.resolveCalls).toBe(1)
            })

            it('fails closed when the publication destination is unavailable', async () => {
                let dispatched = false
                const adapter = provider.createAdapter(outcomes[0]!, () => {
                    dispatched = true
                })
                const fixture = createExecutionFixture(provider, {
                    target: {
                        destination: {
                            type: 'account',
                            id: 'invalid-destination',
                            name: 'Invalid destination',
                        },
                    },
                })

                await expect(adapter.execute(fixture.input)).resolves.toMatchObject({
                    type: 'permanent_failure',
                })
                expect(dispatched).toBe(false)
            })

            it('requires the media lifecycle service before dispatching media', async () => {
                let dispatched = false
                const adapter = provider.createAdapter(outcomes[0]!, () => {
                    dispatched = true
                })
                const fixture = createExecutionFixture(provider, {
                    target: {
                        content: {
                            ...provider.content,
                            media: [{ assetId: conformanceMedia.assetId }],
                        },
                        media: [conformanceMedia],
                        mediaReferenceCount: 1,
                    },
                })

                await expect(adapter.execute(fixture.input)).resolves.toMatchObject({
                    type: 'permanent_failure',
                })
                expect(dispatched).toBe(false)
                expect(fixture.credentials.resolveCalls).toBe(1)
            })
        })
    }

    describe('X adapter specific behavior', () => {
        const xCase = adapterCases.find(c => c.providerId === X_PROVIDER)!

        it('refreshes expired credentials before dispatching', async () => {
            let refreshed = false
            let published = false
            const fakeRefresh: NonNullable<
                Parameters<typeof createXProviderAdapter>[0]
            >['refreshAccessToken'] = async () => {
                refreshed = true
                return {
                    accessToken: 'refreshed-x-token',
                    refreshToken: 'new-x-refresh-token',
                    expiresInSeconds: 7200,
                    scopes: ['tweet.read', 'tweet.write'],
                    tokenType: 'bearer',
                }
            }

            const publisher: XPublisher = {
                async getMe() {
                    return {
                        kind: 'success',
                        value: { id: 'x-account-1', name: 'User', username: 'user' },
                    }
                },
                async uploadMedia() {
                    return { type: 'uploaded', remoteMediaId: 'm1', ready: true }
                },
                async publishTweet(input) {
                    published = true
                    expect(input.accessToken).toBe('refreshed-x-token')
                    return { type: 'published', externalId: 'tweet-refreshed' }
                },
            }

            let replacedTokens = false
            const credentialPort: PublisherCredentialExecutionPort = {
                async resolvePublisherCredentialSecrets() {
                    return {
                        accessToken: 'expired-token',
                        refreshToken: 'valid-refresh-token',
                        providerSession: null,
                    }
                },
                async replacePublisherCredentialTokens(input) {
                    expect(input.accessToken).toBe('refreshed-x-token')
                    expect(input.refreshToken).toBe('new-x-refresh-token')
                    replacedTokens = true
                    return {
                        kind: 'updated',
                        credential: {
                            id: 'cred-1',
                            projectId: 'p-1',
                            providerId: X_PROVIDER,
                            externalAccountId: 'x-account-1',
                            externalAccountName: '@user',
                            scopes: ['tweet.read', 'tweet.write'],
                            state: 'active',
                            expiresAt: now + 7200 * 1000,
                            connectedByActorId: 'actor-conformance',
                            createdAt: now,
                            updatedAt: now,
                        },
                    }
                },
                markPublisherCredentialReconnectRequired() {},
            }

            const adapter = createXProviderAdapter({
                oauth: {
                    authorizationServer: {
                        issuer: 'https://twitter.com',
                        authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
                        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
                    },
                    clientId: 'test-client-id',
                    clientAuthentication: () => {},
                },
                publisher,
                refreshAccessToken: fakeRefresh,
            })

            const target = createTarget(xCase)
            const result = await adapter.execute({
                target: { ...target, credentialExpiresAt: now - 1000 },
                now,
                credentials: credentialPort,
                providerMediaDeliveryStore: createUncalledMediaDeliveryPort(),
            })

            expect(refreshed).toBe(true)
            expect(replacedTokens).toBe(true)
            expect(published).toBe(true)
            expect(result).toEqual({ type: 'published', externalId: 'tweet-refreshed' })
        })

        it('marks reconnect required when token refresh fails', async () => {
            let markedReconnect = false
            const fakeRefresh: NonNullable<
                Parameters<typeof createXProviderAdapter>[0]
            >['refreshAccessToken'] = async () => {
                throw new Error('Refresh failed')
            }

            const credentialPort: PublisherCredentialExecutionPort = {
                async resolvePublisherCredentialSecrets() {
                    return {
                        accessToken: 'expired-token',
                        refreshToken: 'bad-refresh-token',
                        providerSession: null,
                    }
                },
                async replacePublisherCredentialTokens() {
                    return { kind: 'conflict' }
                },
                markPublisherCredentialReconnectRequired() {
                    markedReconnect = true
                },
            }

            const adapter = createXProviderAdapter({
                oauth: {
                    authorizationServer: {
                        issuer: 'https://twitter.com',
                        authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
                        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
                    },
                    clientId: 'test-client-id',
                    clientAuthentication: () => {},
                },
                refreshAccessToken: fakeRefresh,
            })

            const target = createTarget(xCase)
            const result = await adapter.execute({
                target: { ...target, credentialExpiresAt: now - 1000 },
                now,
                credentials: credentialPort,
                providerMediaDeliveryStore: createUncalledMediaDeliveryPort(),
            })

            expect(markedReconnect).toBe(true)
            expect(result).toMatchObject({
                type: 'permanent_failure',
                errorMessage: 'The X publisher credential could not be refreshed',
            })
        })

        it('executes media upload checkpoints and publishes tweet with media ID', async () => {
            let reserved = false
            let started = false
            let recordedCheckpoint = false
            let completed = false
            let publishedTweet = false

            const mockMediaDeliveryStore: ProviderMediaDeliveryPort = {
                reserve(input) {
                    reserved = true
                    return {
                        id: 'delivery-1',
                        projectId: input.projectId,
                        executionMediaId: input.executionMediaId,
                        publisherId: input.publisherId,
                        providerId: X_PROVIDER,
                        state: 'pending',
                        attempts: 0,
                        remoteMediaId: null,
                        remoteMediaUrl: null,
                        lastAttemptAt: null,
                        completedAt: null,
                        errorCode: null,
                        errorMessage: null,
                        createdAt: input.at ?? now,
                        updatedAt: input.at ?? now,
                    }
                },
                start(input) {
                    started = true
                    return {
                        id: input.deliveryId,
                        projectId: input.projectId,
                        executionMediaId: 'execution-media-1',
                        publisherId: 'publisher-1',
                        providerId: X_PROVIDER,
                        state: 'uploading',
                        attempts: 1,
                        remoteMediaId: null,
                        remoteMediaUrl: null,
                        lastAttemptAt: input.at ?? now,
                        completedAt: null,
                        errorCode: null,
                        errorMessage: null,
                        createdAt: input.at ?? now,
                        updatedAt: input.at ?? now,
                    }
                },
                recordRemoteMediaId(input) {
                    recordedCheckpoint = true
                    expect(input.remoteMediaId).toBe('x-media-remote-123')
                    return {
                        id: input.deliveryId,
                        projectId: input.projectId,
                        executionMediaId: 'execution-media-1',
                        publisherId: 'publisher-1',
                        providerId: X_PROVIDER,
                        state: 'uploading',
                        attempts: 1,
                        remoteMediaId: input.remoteMediaId,
                        remoteMediaUrl: null,
                        lastAttemptAt: input.at ?? now,
                        completedAt: null,
                        errorCode: null,
                        errorMessage: null,
                        createdAt: input.at ?? now,
                        updatedAt: input.at ?? now,
                    }
                },
                complete(input) {
                    completed = true
                    return {
                        id: input.deliveryId,
                        projectId: input.projectId,
                        executionMediaId: 'execution-media-1',
                        publisherId: 'publisher-1',
                        providerId: X_PROVIDER,
                        state: 'uploaded',
                        attempts: 1,
                        remoteMediaId: input.remoteMediaId,
                        remoteMediaUrl: null,
                        lastAttemptAt: input.at ?? now,
                        completedAt: input.at ?? now,
                        errorCode: null,
                        errorMessage: null,
                        createdAt: input.at ?? now,
                        updatedAt: input.at ?? now,
                    }
                },
                fail() {
                    return null
                },
                retry() {
                    return null
                },
            }

            const publisher: XPublisher = {
                async getMe() {
                    return {
                        kind: 'success',
                        value: { id: 'x-account-1', name: 'User', username: 'user' },
                    }
                },
                async uploadMedia(_token, input) {
                    expect(input.contentType).toBe('image/png')
                    return { type: 'uploaded', remoteMediaId: 'x-media-remote-123', ready: true }
                },
                async publishTweet(input) {
                    publishedTweet = true
                    expect(input.mediaIds).toEqual(['x-media-remote-123'])
                    return { type: 'published', externalId: 'tweet-with-media' }
                },
            }

            const mediaPayload = new Uint8Array([1, 2, 3, 4])
            const sha256 = createHash('sha256').update(mediaPayload).digest('hex')
            const targetMediaWithSha: PublisherExecutionMedia = {
                ...conformanceMedia,
                sha256,
            }

            const adapter = createXProviderAdapter({ publisher })
            const credentials = createCredentialPort({ available: true, providerSession: null })
            const target = createTarget(xCase, {
                content: {
                    text: 'Tweet with media',
                    media: [{ assetId: targetMediaWithSha.assetId }],
                },
                media: [targetMediaWithSha],
                mediaReferenceCount: 1,
            })

            const mediaStore = {
                async openRepresentationContent() {
                    return {
                        stream: new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(mediaPayload)
                                controller.close()
                            },
                        }),
                        size: mediaPayload.byteLength,
                        contentType: 'image/png' as const,
                        sha256,
                        representation: {
                            storeId: targetMediaWithSha.storeId,
                            objectKey: targetMediaWithSha.objectKey,
                        },
                    } as any
                },
            }

            const outcome = await adapter.execute({
                target,
                now,
                credentials: credentials.port,
                media: mediaStore,
                providerMediaDeliveryStore: mockMediaDeliveryStore,
            })

            expect(reserved).toBe(true)
            expect(started).toBe(true)
            expect(recordedCheckpoint).toBe(true)
            expect(completed).toBe(true)
            expect(publishedTweet).toBe(true)
            expect(outcome).toEqual({ type: 'published', externalId: 'tweet-with-media' })
        })
    })
})
