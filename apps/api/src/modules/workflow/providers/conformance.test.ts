import { describe, expect, it } from 'bun:test'

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

import { createBlueskyProviderAdapter, type BlueskyProviderAdapterOptions } from './bluesky'
import { createLinkedInProviderAdapter } from './linkedin'
import { createMastodonProviderAdapter } from './mastodon'
import {
    createBuiltInProviderRegistry,
    type BuiltInProviderAdapter,
    type BuiltInProviderExecutionInput,
    type ProviderMediaDeliveryPort,
    type PublisherCredentialExecutionPort,
} from './registry'

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
})
