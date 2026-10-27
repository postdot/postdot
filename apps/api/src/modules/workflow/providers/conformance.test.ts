import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import {
    blueskyChannelProfile,
    BLUESKY_REQUIRED_SCOPES,
    createBlueskyClientMetadata,
    type BlueskyPublishOutcome,
    type BlueskyPublisher,
} from '@postdot/bluesky'
import type { ChannelProfileDefinition, ExternalEffectOutcome } from '@postdot/core'
import type {
    PublisherConnectionDestination,
    PublisherExecutionMedia,
    PublisherExecutionTarget,
} from '@postdot/db'
import {
    DEVTO_PROVIDER,
    devtoChannelProfile,
    type DevtoPublishOutcome,
    type DevtoPublisher,
} from '@postdot/devto'
import {
    DISCORD_PROVIDER,
    discordChannelProfile,
    type DiscordPublishOutcome,
    type DiscordPublisher,
} from '@postdot/discord'
import {
    linkedinChannelProfile,
    type LinkedInImagePublisher,
    type LinkedInMediaUploadOutcome,
    type LinkedInPublishOutcome,
    type LinkedInTextPublisher,
} from '@postdot/linkedin'
import {
    MASTODON_PROVIDER,
    createMastodonPublisher,
    MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
    MASTODON_VIDEO_EXECUTION_CONTRACT_REVISION,
    mastodonChannelProfile,
    type MastodonPublishOutcome,
    type MastodonPublisher,
} from '@postdot/mastodon'
import { X_PROVIDER, xChannelProfile, type XPublishOutcome, type XPublisher } from '@postdot/x'

import {
    createBlueskyProviderAdapter,
    type BlueskyProviderAdapterOptions,
} from '../../../providers/bluesky/worker'
import { createDevtoProviderAdapter } from '../../../providers/devto/worker'
import { createDiscordProviderAdapter } from '../../../providers/discord/worker'
import { createLinkedInProviderAdapter } from '../../../providers/linkedin/worker'
import { createMastodonProviderAdapter } from '../../../providers/mastodon/worker'
import { createXProviderAdapter } from '../../../providers/x/worker'
import {
    createBuiltInProviderRegistry,
    type BuiltInProviderAdapter,
    type BuiltInProviderExecutionInput,
    type ProviderMediaDeliveryPort,
    type PublisherCredentialExecutionPort,
} from './registry'

const now = 1_800_000_000_000
const credentialSecret = 'conformance-secret-that-must-not-become-domain-data'
const blueskyDid = 'did:plc:postdot-conformance'
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
        clientId: 'https://postdot.test/oauth/bluesky/client-metadata.json',
        clientName: 'Postdot conformance test',
        clientUri: 'https://postdot.test',
        redirectUri: 'https://postdot.test/api/oauth/bluesky/callback',
    }),
    handleResolver: 'https://bsky.social',
}

const outcomes = [
    { type: 'published', externalId: 'provider-publication-1' },
    {
        type: 'retryable_failure',
        effectOccurred: false,
        code: 'rate_limited',
        errorMessage: 'The provider asked Postdot to retry later',
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
    readonly providerApplicationId?: string | null
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
                async publishImages() {
                    onDispatch()
                    return outcome as LinkedInPublishOutcome
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
                async getPollLimits() {
                    return {
                        kind: 'success',
                        value: {
                            maxOptions: 4,
                            maxCharactersPerOption: 50,
                            minExpiration: 300,
                            maxExpiration: 2629746,
                        },
                    }
                },
                async getVideoLimits() {
                    return {
                        kind: 'success',
                        value: {
                            supportedMimeTypes: ['video/mp4'],
                            maxBytes: 100_000_000,
                            maxPixels: 8_294_400,
                        },
                    }
                },
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
                        value: { id: '987654321098765432', username: 'Postdot' },
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
        name: 'DEV.to',
        providerId: DEVTO_PROVIDER,
        profile: devtoChannelProfile,
        content: { title: 'A Postdot article', body_markdown: 'A conformance article', media: [] },
        destination: { type: 'account', id: '42', name: 'Postdot' },
        externalAccountId: '42',
        providerSession: null,
        endpointUrl: null,
        createAdapter(outcome, onDispatch) {
            const publisher: DevtoPublisher = {
                async getMe() {
                    return {
                        kind: 'success',
                        value: { id: '42', username: 'postdot', name: 'Postdot' },
                    }
                },
                async getArticleAnalytics() {
                    return {
                        kind: 'success',
                        value: { articleId: '1', comments: 0, reactions: 0, pageViews: 0 },
                    }
                },
                async publishArticle() {
                    onDispatch()
                    return outcome as DevtoPublishOutcome
                },
            }
            return createDevtoProviderAdapter({ createPublisher: () => publisher })
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
                    return {
                        type: 'uploaded',
                        remoteMediaId: 'provider-media-1',
                        ready: true,
                        expiresAfterSecs: null,
                    }
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
        Pick<
            PublisherExecutionTarget,
            'content' | 'destination' | 'media' | 'mediaReferenceCount' | 'providerApplicationId'
        >
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
        ...(overrides.providerApplicationId === undefined
            ? {}
            : { providerApplicationId: overrides.providerApplicationId }),
        credentialState: 'active',
        credentialExpiresAt: null,
        endpointUrl: provider.endpointUrl,
        authentication: null,
        attempt: 1,
        media,
    }
}

function fixtureCredentialRefresh(
    getPort: () => Omit<PublisherCredentialExecutionPort, 'withPublisherCredentialRefresh'>,
    expiresAt: number | null = null,
    providerApplicationId: string | null = null
): PublisherCredentialExecutionPort['withPublisherCredentialRefresh'] {
    return async (projectId, credentialId, operation) => {
        const port = getPort()
        const secrets = await port.resolvePublisherCredentialSecrets(projectId, credentialId)
        return operation(
            secrets === null
                ? null
                : {
                      credential: {
                          id: credentialId,
                          projectId,
                          providerId: 'fixture',
                          externalAccountId: 'fixture-account',
                          externalAccountName: null,
                          state: 'active',
                          scopes: [],
                          connectedByActorId: 'fixture-actor',
                          createdAt: now,
                          updatedAt: now,
                          expiresAt,
                          providerApplicationId,
                      },
                      secrets,
                      now: () => now,
                      replaceTokens: input =>
                          port.replacePublisherCredentialTokens({
                              ...input,
                              projectId,
                              credentialId,
                          }),
                      markReconnectRequired: () =>
                          port.markPublisherCredentialReconnectRequired(projectId, credentialId),
                  }
        )
    }
}

function createCredentialPort(input: {
    readonly available: boolean
    readonly providerSession: string | null
    readonly providerApplicationId?: string | null
}) {
    let resolveCalls = 0
    let reconnectCalls = 0
    const port: PublisherCredentialExecutionPort = {
        withPublisherCredentialRefresh: fixtureCredentialRefresh(
            () => port,
            null,
            input.providerApplicationId
        ),
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
                | 'content'
                | 'destination'
                | 'media'
                | 'mediaReferenceCount'
                | 'providerApplicationId'
            >
        >
    } = {}
) {
    const credentials = createCredentialPort({
        available: options.credentialsAvailable ?? true,
        providerSession: provider.providerSession,
        providerApplicationId: options.target?.providerApplicationId,
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
    it('keeps the old LinkedIn execution contract separate and rejects multiple images before upload', async () => {
        const provider = adapterCases[0]!
        const oldAdapter = createLinkedInProviderAdapter({ revision: 'member-post-v2' })
        const newAdapter = createLinkedInProviderAdapter()
        const registry = createBuiltInProviderRegistry([oldAdapter, newAdapter])
        expect(
            registry.resolve({
                providerId: 'linkedin',
                kind: 'linkedin',
                execution: { kind: 'built_in', contractId: 'linkedin', revision: 'member-post-v2' },
            })
        ).toBe(oldAdapter)
        expect(
            registry.resolve({
                providerId: 'linkedin',
                kind: 'linkedin',
                execution: provider.profile.execution,
            })
        ).toBe(newAdapter)
        const fixture = createExecutionFixture(provider, {
            target: { media: [conformanceMedia, { ...conformanceMedia, id: 'second' }] },
        })
        expect(await oldAdapter.execute(fixture.input)).toMatchObject({
            type: 'permanent_failure',
            effectOccurred: false,
        })
    })

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
                    return {
                        type: 'uploaded',
                        remoteMediaId: 'm1',
                        ready: true,
                        expiresAfterSecs: null,
                    }
                },
                async publishTweet(input) {
                    published = true
                    expect(input.accessToken).toBe('refreshed-x-token')
                    return { type: 'published', externalId: 'tweet-refreshed' }
                },
            }

            let replacedTokens = false
            const credentialPort: PublisherCredentialExecutionPort = {
                withPublisherCredentialRefresh: fixtureCredentialRefresh(
                    () => credentialPort,
                    now - 1000
                ),
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
                withPublisherCredentialRefresh: fixtureCredentialRefresh(
                    () => credentialPort,
                    now - 1000
                ),
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
            let completedExpiry: number | null | undefined
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
                        remoteMediaExpiresAt: null,
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
                        remoteMediaExpiresAt: null,
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
                        remoteMediaExpiresAt: null,
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
                    completedExpiry = input.remoteMediaExpiresAt
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
                        remoteMediaExpiresAt: input.remoteMediaExpiresAt ?? null,
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
                    return {
                        type: 'uploaded',
                        remoteMediaId: 'x-media-remote-123',
                        ready: true,
                        expiresAfterSecs: 3_600,
                    }
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
            expect(completedExpiry).toBe(now + 3_600_000)
            expect(publishedTweet).toBe(true)
            expect(outcome).toEqual({ type: 'published', externalId: 'tweet-with-media' })
        })

        it('rejects overweight post text before dispatching', async () => {
            let dispatched = false
            const publisher: XPublisher = {
                async getMe() {
                    throw new Error('must not be called')
                },
                async uploadMedia() {
                    throw new Error('must not be called')
                },
                async publishTweet() {
                    dispatched = true
                    return { type: 'published', externalId: 'tweet-overweight' }
                },
            }
            const adapter = createXProviderAdapter({ publisher })
            const credentials = createCredentialPort({ available: true, providerSession: null })

            for (const text of ['a'.repeat(281), '日'.repeat(141)]) {
                const target = createTarget(xCase, {
                    content: { text, media: [] },
                })
                const outcome = await adapter.execute({
                    target,
                    now,
                    credentials: credentials.port,
                    providerMediaDeliveryStore: createUncalledMediaDeliveryPort(),
                })
                expect(outcome).toMatchObject({ type: 'permanent_failure' })
                expect(JSON.stringify(outcome)).toContain('weighted')
            }
            expect(dispatched).toBe(false)
        })

        it('reuses a fresh uploaded checkpoint without uploading again', async () => {
            let uploads = 0
            let publishedMediaIds: readonly string[] | undefined
            const freshStore: ProviderMediaDeliveryPort = {
                reserve(input) {
                    return {
                        id: 'delivery-fresh',
                        projectId: input.projectId,
                        executionMediaId: input.executionMediaId,
                        publisherId: input.publisherId,
                        providerId: X_PROVIDER,
                        state: 'uploaded',
                        attempts: 1,
                        remoteMediaId: 'x-media-fresh',
                        remoteMediaUrl: null,
                        remoteMediaExpiresAt: now + 60_000,
                        lastAttemptAt: now - 1_000,
                        completedAt: now - 1_000,
                        errorCode: null,
                        errorMessage: null,
                        createdAt: now - 2_000,
                        updatedAt: now - 1_000,
                    }
                },
                start() {
                    throw new Error('fresh checkpoints must not restart the upload')
                },
                recordRemoteMediaId() {
                    throw new Error('fresh checkpoints must not record again')
                },
                complete() {
                    throw new Error('fresh checkpoints must not complete again')
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
                    throw new Error('must not be called')
                },
                async uploadMedia() {
                    uploads += 1
                    throw new Error('fresh checkpoints must not upload')
                },
                async publishTweet(input) {
                    publishedMediaIds = input.mediaIds
                    return { type: 'published', externalId: 'tweet-fresh-checkpoint' }
                },
            }

            const mediaPayload = new Uint8Array([9, 9, 9])
            const sha256 = createHash('sha256').update(mediaPayload).digest('hex')
            const targetMedia: PublisherExecutionMedia = { ...conformanceMedia, sha256 }
            const adapter = createXProviderAdapter({ publisher })
            const credentials = createCredentialPort({ available: true, providerSession: null })
            const target = createTarget(xCase, {
                content: { text: 'Tweet with a fresh checkpoint', media: [{ assetId: 'asset-1' }] },
                media: [targetMedia],
                mediaReferenceCount: 1,
            })
            const outcome = await adapter.execute({
                target,
                now,
                credentials: credentials.port,
                media: {
                    async openRepresentationContent() {
                        throw new Error('fresh checkpoints must not open media')
                    },
                },
                providerMediaDeliveryStore: freshStore,
            })

            expect(outcome).toEqual({ type: 'published', externalId: 'tweet-fresh-checkpoint' })
            expect(uploads).toBe(0)
            expect(publishedMediaIds).toEqual(['x-media-fresh'])
        })

        it('requires reconciliation when the provider media expiry has passed', async () => {
            let dispatched = false
            const staleStore: ProviderMediaDeliveryPort = {
                reserve(input) {
                    return {
                        id: 'delivery-stale',
                        projectId: input.projectId,
                        executionMediaId: input.executionMediaId,
                        publisherId: input.publisherId,
                        providerId: X_PROVIDER,
                        state: 'uploaded',
                        attempts: 1,
                        remoteMediaId: 'x-media-stale',
                        remoteMediaUrl: null,
                        remoteMediaExpiresAt: now - 1,
                        lastAttemptAt: now - 1_000,
                        completedAt: now - 1_000,
                        errorCode: null,
                        errorMessage: null,
                        createdAt: now - 2_000,
                        updatedAt: now - 1_000,
                    }
                },
                start() {
                    return null
                },
                recordRemoteMediaId() {
                    return null
                },
                complete() {
                    return null
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
                    throw new Error('must not be called')
                },
                async uploadMedia() {
                    throw new Error('stale checkpoints must not upload')
                },
                async publishTweet() {
                    dispatched = true
                    return { type: 'published', externalId: 'tweet-stale-checkpoint' }
                },
            }

            const mediaPayload = new Uint8Array([7, 7, 7])
            const sha256 = createHash('sha256').update(mediaPayload).digest('hex')
            const targetMedia: PublisherExecutionMedia = { ...conformanceMedia, sha256 }
            const adapter = createXProviderAdapter({ publisher })
            const credentials = createCredentialPort({ available: true, providerSession: null })
            const target = createTarget(xCase, {
                content: { text: 'Tweet with a stale checkpoint', media: [{ assetId: 'asset-1' }] },
                media: [targetMedia],
                mediaReferenceCount: 1,
            })
            const outcome = await adapter.execute({
                target,
                now,
                credentials: credentials.port,
                media: {
                    async openRepresentationContent() {
                        throw new Error('stale checkpoints must not open media')
                    },
                },
                providerMediaDeliveryStore: staleStore,
            })

            expect(outcome).toMatchObject({ type: 'ambiguous' })
            expect(JSON.stringify(outcome)).toContain('expired')
            expect(dispatched).toBe(false)
        })

        it('re-uploads after a retryable upload failure on the next attempt', async () => {
            let uploads = 0
            let published = 0
            type Row = {
                state: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'ambiguous'
                remoteMediaId: string | null
            }
            const row: Row = { state: 'pending', remoteMediaId: null }
            const baseDelivery = {
                id: 'delivery-retry',
                projectId: 'project-conformance',
                executionMediaId: 'execution-media-1',
                publisherId: 'publisher-1',
                providerId: X_PROVIDER,
                attempts: 1,
                remoteMediaUrl: null,
                remoteMediaExpiresAt: null,
                lastAttemptAt: now,
                completedAt: null,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            }
            const retryStore: ProviderMediaDeliveryPort = {
                reserve() {
                    return { ...baseDelivery, state: row.state, remoteMediaId: row.remoteMediaId }
                },
                start() {
                    row.state = 'uploading'
                    return { ...baseDelivery, state: row.state, remoteMediaId: row.remoteMediaId }
                },
                recordRemoteMediaId(input) {
                    row.remoteMediaId = input.remoteMediaId
                    return { ...baseDelivery, state: row.state, remoteMediaId: row.remoteMediaId }
                },
                complete(input) {
                    row.state = 'uploaded'
                    row.remoteMediaId = input.remoteMediaId
                    return {
                        ...baseDelivery,
                        state: row.state,
                        remoteMediaId: row.remoteMediaId,
                        completedAt: now,
                    }
                },
                fail(input) {
                    row.state = input.ambiguous === true ? 'ambiguous' : 'failed'
                    return { ...baseDelivery, state: row.state, remoteMediaId: row.remoteMediaId }
                },
                retry() {
                    row.state = 'pending'
                    return { ...baseDelivery, state: row.state, remoteMediaId: row.remoteMediaId }
                },
            }
            const publisher: XPublisher = {
                async getMe() {
                    throw new Error('must not be called')
                },
                async uploadMedia() {
                    uploads += 1
                    if (uploads === 1) {
                        return {
                            type: 'retryable_failure',
                            effectOccurred: false,
                            code: 'rate_limited',
                            errorMessage: 'Rate limit exceeded',
                        }
                    }
                    return {
                        type: 'uploaded',
                        remoteMediaId: 'x-media-retried',
                        ready: true,
                        expiresAfterSecs: null,
                    }
                },
                async publishTweet(input) {
                    published += 1
                    expect(input.mediaIds).toEqual(['x-media-retried'])
                    return { type: 'published', externalId: 'tweet-retried' }
                },
            }

            const mediaPayload = new Uint8Array([5, 5, 5, 5])
            const sha256 = createHash('sha256').update(mediaPayload).digest('hex')
            const targetMedia: PublisherExecutionMedia = { ...conformanceMedia, sha256 }
            const adapter = createXProviderAdapter({ publisher })
            const credentials = createCredentialPort({ available: true, providerSession: null })
            const target = createTarget(xCase, {
                content: { text: 'Tweet with retried upload', media: [{ assetId: 'asset-1' }] },
                media: [targetMedia],
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
                            storeId: targetMedia.storeId,
                            objectKey: targetMedia.objectKey,
                        },
                    } as any
                },
            }

            const first = await adapter.execute({
                target,
                now,
                credentials: credentials.port,
                media: mediaStore,
                providerMediaDeliveryStore: retryStore,
            })
            expect(first).toMatchObject({ type: 'retryable_failure' })
            expect(uploads).toBe(1)
            expect(published).toBe(0)

            const second = await adapter.execute({
                target,
                now,
                credentials: credentials.port,
                media: mediaStore,
                providerMediaDeliveryStore: retryStore,
            })
            expect(second).toEqual({ type: 'published', externalId: 'tweet-retried' })
            expect(uploads).toBe(2)
            expect(published).toBe(1)
        })
    })

    describe('Bluesky adapter specific behavior', () => {
        const blueskyCase = adapterCases.find(c => c.providerId === 'bluesky')!

        it('keeps old grants usable for images while requiring actual video permissions and preserving post-v1', async () => {
            let scope = 'atproto repo:app.bsky.feed.post?action=create blob:image/*'
            let dispatched = 0
            const restoreSession: NonNullable<
                BlueskyProviderAdapterOptions['restoreSession']
            > = async () => ({
                client: undefined as never,
                session: {
                    did: blueskyDid,
                    getTokenInfo: async () => ({ scope, aud: 'https://pds.example.com' }),
                } as never,
                getSession: () => undefined as never,
                getSerializedSession: () => blueskySession,
            })
            const options: BlueskyProviderAdapterOptions = {
                oauth: blueskyOAuth,
                restoreSession,
                createPublisher: () => ({
                    async publish() {
                        dispatched++
                        return { type: 'published', externalId: 'image-with-old-grant' }
                    },
                }),
                createVideoService: () => {
                    throw new Error('Unauthorized videos must not reach the video service')
                },
            }
            const fixture = createExecutionFixture(blueskyCase)
            const adapter = createBlueskyProviderAdapter(options)
            expect((await adapter.execute(fixture.input)).type).toBe('published')
            const videoInput = {
                ...fixture.input,
                target: createTarget(blueskyCase, {
                    media: [
                        {
                            ...conformanceMedia,
                            family: 'video',
                            contentType: 'video/mp4',
                            durationMs: 4000,
                        },
                    ],
                }),
            }
            expect(await adapter.execute(videoInput)).toMatchObject({
                type: 'permanent_failure',
                errorMessage: expect.stringContaining('Reconnect'),
            })
            expect(fixture.credentials.reconnectCalls).toBe(0)
            scope = BLUESKY_REQUIRED_SCOPES.join(' ')
            const historical = createBlueskyProviderAdapter({ ...options, revision: 'post-v1' })
            expect(await historical.execute(videoInput)).toMatchObject({
                type: 'permanent_failure',
                errorMessage: expect.stringContaining('historical'),
            })
            expect(dispatched).toBe(1)
        })

        it('resolves the runtime OAuth application selected by the execution target', async () => {
            let resolvedApplicationId: string | null = null
            let dispatched = false
            const restoreSession: NonNullable<
                BlueskyProviderAdapterOptions['restoreSession']
            > = async () => ({
                client: undefined as never,
                session: { did: blueskyDid } as never,
                getSession: () => undefined as never,
                getSerializedSession: () => blueskySession,
            })
            const adapter = createBlueskyProviderAdapter({
                oauth: blueskyOAuth,
                resolveOAuth: async applicationId => {
                    resolvedApplicationId = applicationId
                    return blueskyOAuth
                },
                restoreSession,
                createPublisher: () => ({
                    async publish() {
                        dispatched = true
                        return { type: 'published', externalId: 'bluesky-runtime-app' }
                    },
                }),
            })
            const fixture = createExecutionFixture(blueskyCase, {
                target: { providerApplicationId: 'bluesky-app-1' },
            })

            await expect(adapter.execute(fixture.input)).resolves.toEqual({
                type: 'published',
                externalId: 'bluesky-runtime-app',
            })
            expect(resolvedApplicationId as string | null).toBe('bluesky-app-1')
            expect(dispatched).toBe(true)
        })
    })
})

it('executes a native Mastodon poll after checking advertised limits, with no upload and the retained key', async () => {
    const provider = adapterCases.find(provider => provider.providerId === 'mastodon')!
    const poll = {
        options: ['First', 'Second'],
        expiresIn: 86400,
        multiple: true,
        hideTotals: true,
    }
    let maxCharacters = 50
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const publisher = createMastodonPublisher({
        baseUrl: provider.endpointUrl!,
        fetcher: async (url, init) => {
            requests.push({ url: String(url), init })
            return Response.json(
                String(url).endsWith('/instance')
                    ? {
                          configuration: {
                              polls: {
                                  max_options: 4,
                                  max_characters_per_option: maxCharacters,
                                  min_expiration: 300,
                                  max_expiration: 2629746,
                              },
                          },
                      }
                    : {
                          id: 'poll-status',
                          url: 'https://mastodon.example/@owner/poll-status',
                          poll: { id: 'poll', options: poll.options.map(title => ({ title })) },
                      }
            )
        },
    })
    const adapter = createMastodonProviderAdapter({ createPublisher: () => publisher })
    const fixture = createExecutionFixture(provider, {
        target: { content: { text: 'Choose', media: [], poll } },
    })
    expect(await adapter.execute(fixture.input)).toMatchObject({
        type: 'published',
        externalId: 'poll-status',
    })
    expect(requests.map(request => request.url)).toEqual([
        'https://mastodon.example/api/v2/instance',
        'https://mastodon.example/api/v1/statuses',
    ])
    expect(new Headers(requests[1]!.init?.headers).get('idempotency-key')).toBe(
        'publication-conformance:execution-revision-1'
    )
    expect((requests[1]!.init!.body as URLSearchParams).getAll('poll[options][]')).toEqual(
        poll.options
    )
    requests.length = 0
    maxCharacters = 3
    expect(await adapter.execute(fixture.input)).toMatchObject({
        type: 'permanent_failure',
        effectOccurred: false,
    })
    expect(requests).toHaveLength(1)
    requests.length = 0
    const mixed = createExecutionFixture(provider, {
        target: { content: { text: 'Choose', media: [], poll }, media: [conformanceMedia] },
    })
    expect(await adapter.execute(mixed.input)).toMatchObject({
        type: 'permanent_failure',
        effectOccurred: false,
    })
    expect(requests).toHaveLength(0)
    for (const revision of [
        MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
        MASTODON_VIDEO_EXECUTION_CONTRACT_REVISION,
    ] as const) {
        expect(
            await createMastodonProviderAdapter({
                revision,
                createPublisher: () => publisher,
            }).execute(fixture.input)
        ).toMatchObject({ type: 'permanent_failure', effectOccurred: false })
    }
    expect(requests).toHaveLength(0)
})
