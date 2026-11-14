import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import type { PublisherExecutionMedia, PublisherExecutionTarget } from '@postdot/db'
import type { DevtoPublishOutcome, DevtoPublisher } from '@postdot/devto'
import { devtoArticleV1ChannelProfile, devtoChannelProfile } from '@postdot/devto'

import { createDevtoAdapters } from '../../../providers/devto/module'
import { createDevtoProviderAdapter } from '../../../providers/devto/worker'
import type { ProviderWorkerContext } from '../../../providers/worker-context'
import type {
    BuiltInProviderExecutionInput,
    ProviderMediaDeliveryPort,
    PublisherCredentialExecutionPort,
} from './registry'

const now = 1_800_000_000_000
const API_KEY = 'devto-project-api-key-that-must-not-become-domain-data'

function createTarget(overrides: Partial<PublisherExecutionTarget> = {}): PublisherExecutionTarget {
    return {
        jobId: 'job-devto',
        projectId: 'project-devto',
        publicationId: 'publication-devto',
        scheduledAt: now,
        executionRevisionId: 'execution-revision-1',
        profileVersionId: 'profile-version-1',
        mediaReferenceCount: 0,
        profile: devtoChannelProfile,
        content: {
            title: 'Postdot release notes',
            body_markdown: '# A calmer publishing workflow',
            media: [],
        },
        publisherId: 'publisher-devto',
        channelId: 'channel-devto',
        channelName: 'DEV.to articles',
        kind: 'devto',
        credentialId: 'credential-devto',
        externalAccountId: '42',
        destination: { type: 'account', id: '42', name: 'Postdot' },
        providerId: 'devto',
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
        withPublisherCredentialRefresh: async () => {
            throw new Error('This provider must not renew credentials')
        },
        async resolvePublisherCredentialSecrets() {
            return { accessToken: API_KEY, refreshToken: null, providerSession: null }
        },
        async replacePublisherCredentialTokens() {
            return { kind: 'conflict' }
        },
        async markPublisherCredentialReconnectRequired() {
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
        throw new Error('DEV.to does not use provider media delivery checkpoints')
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

function createMedia(): PublisherExecutionMedia {
    const bytes = new Uint8Array([1, 2, 3, 4])
    return {
        id: 'execution-media-0',
        projectId: 'project-devto',
        executionRevisionId: 'execution-revision-1',
        targetRevisionMediaId: 'target-media-0',
        assetId: 'asset-0',
        representationId: 'representation-0',
        position: 0,
        contentPath: '/media/0',
        role: null,
        accessibilityText: 'A Postdot release notes image',
        originalFilename: 'release-notes.png',
        contentType: 'image/png',
        family: 'image',
        byteSize: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: 1,
        height: 1,
        durationMs: null,
        storeId: 'local',
        objectKey: 'projects/project-devto/media/representation-0',
    }
}

function executeWith(
    publisher: DevtoPublisher,
    target: PublisherExecutionTarget = createTarget(),
    resolveMediaUrl?: BuiltInProviderExecutionInput['resolveMediaUrl']
) {
    const credentials = createCredentials()
    const input: BuiltInProviderExecutionInput = {
        target,
        now,
        credentials: credentials.port,
        ...(resolveMediaUrl === undefined ? {} : { resolveMediaUrl }),
        providerMediaDeliveryStore: createUncalledDeliveryPort(),
    }
    return {
        adapter: createDevtoProviderAdapter({ createPublisher: () => publisher }),
        credentials,
        input,
    }
}

describe('DEV.to provider adapter', () => {
    it('publishes the article and resolves one main image through signed media delivery', async () => {
        let publishedInput: Parameters<DevtoPublisher['publishArticle']>[0] | undefined
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
            async publishArticle(input) {
                publishedInput = input
                return { type: 'published', externalId: 'article-42' }
            },
        }
        const media = createMedia()
        const { adapter, input } = executeWith(
            publisher,
            createTarget({
                content: {
                    title: 'Postdot release notes',
                    body_markdown: '# A calmer publishing workflow',
                    media: [{ assetId: media.assetId }],
                },
                media: [media],
                mediaReferenceCount: 1,
            }),
            async () => 'https://media.example/postdot/signed-image'
        )

        await expect(adapter.execute(input)).resolves.toEqual({
            type: 'published',
            externalId: 'article-42',
        })
        expect(publishedInput).toEqual({
            apiKey: API_KEY,
            title: 'Postdot release notes',
            bodyMarkdown: '# A calmer publishing workflow',
            mainImageUrl: 'https://media.example/postdot/signed-image',
        })
    })

    it('marks the project credential for reconnect on authentication failure', async () => {
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
            async publishArticle(): Promise<DevtoPublishOutcome> {
                return {
                    type: 'permanent_failure',
                    effectOccurred: false,
                    code: 'authentication_required',
                    errorMessage: 'DEV.to rejected the API key',
                }
            },
        }
        const fixture = executeWith(publisher)

        await expect(fixture.adapter.execute(fixture.input)).resolves.toMatchObject({
            type: 'permanent_failure',
            code: 'authentication_required',
        })
        expect(fixture.credentials.reconnectCalls).toBe(1)
    })

    it('fails before dispatch when the image is not an allowed type or has no public URL', async () => {
        let dispatched = false
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
                dispatched = true
                return { type: 'published', externalId: 'article-42' }
            },
        }
        const media = createMedia()
        const unsupported = executeWith(
            publisher,
            createTarget({
                content: {
                    title: 'Postdot release notes',
                    body_markdown: '# A calmer publishing workflow',
                    media: [{ assetId: media.assetId }],
                },
                media: [{ ...media, contentType: 'image/gif' }],
                mediaReferenceCount: 1,
            }),
            async () => 'https://media.example/postdot/signed-image'
        )

        await expect(unsupported.adapter.execute(unsupported.input)).resolves.toMatchObject({
            type: 'permanent_failure',
        })
        expect(dispatched).toBe(false)

        const unavailable = executeWith(
            publisher,
            createTarget({
                content: {
                    title: 'Postdot release notes',
                    body_markdown: '# A calmer publishing workflow',
                    media: [{ assetId: media.assetId }],
                },
                media: [media],
                mediaReferenceCount: 1,
            })
        )
        await expect(unavailable.adapter.execute(unavailable.input)).resolves.toMatchObject({
            type: 'permanent_failure',
        })
        expect(dispatched).toBe(false)
    })

    it('registers both article-v1 and article-v2 adapters and forwards optional Forem article fields', async () => {
        const adapters = createDevtoAdapters({} as ProviderWorkerContext)
        expect(adapters.map(item => item.revision)).toEqual(['article-v1', 'article-v2'])

        let publishedInput: Parameters<DevtoPublisher['publishArticle']>[0] | undefined
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
            async publishArticle(input) {
                publishedInput = input
                return { type: 'published', externalId: 'article-99' }
            },
        }

        const v2 = executeWith(
            publisher,
            createTarget({
                content: {
                    title: 'Postdot v2 release notes',
                    body_markdown: '# Details',
                    media: [],
                    tags: ['typescript', 'bun'],
                    canonical_url: 'https://example.com/v2-notes',
                    description: 'Release overview',
                    series: 'Postdot Releases',
                    ai_disclosure_level: 'no_ai',
                    published: false,
                    organization_id: 12,
                },
            })
        )
        await expect(v2.adapter.execute(v2.input)).resolves.toEqual({
            type: 'published',
            externalId: 'article-99',
        })
        expect(publishedInput).toEqual({
            apiKey: API_KEY,
            title: 'Postdot v2 release notes',
            bodyMarkdown: '# Details',
            tags: ['typescript', 'bun'],
            canonicalUrl: 'https://example.com/v2-notes',
            description: 'Release overview',
            series: 'Postdot Releases',
            aiDisclosureLevel: 'no_ai',
            published: false,
            organizationId: 12,
        })

        const v1 = executeWith(
            publisher,
            createTarget({
                profile: devtoArticleV1ChannelProfile,
            })
        )
        await expect(v1.adapter.execute(v1.input)).resolves.toEqual({
            type: 'published',
            externalId: 'article-99',
        })
    })

    it('rejects malformed optional DEV.to target fields before dispatch', async () => {
        let dispatched = false
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
                dispatched = true
                return { type: 'published', externalId: 'article-99' }
            },
        }

        const malformed = executeWith(
            publisher,
            createTarget({
                content: {
                    title: 'Postdot article',
                    body_markdown: '# Details',
                    media: [],
                    organization_id: 'not-a-number',
                },
            })
        )
        await expect(malformed.adapter.execute(malformed.input)).resolves.toMatchObject({
            type: 'permanent_failure',
        })
        expect(dispatched).toBe(false)
    })
})
