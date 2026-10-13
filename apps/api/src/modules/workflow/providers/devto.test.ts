import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import type { PublisherExecutionMedia, PublisherExecutionTarget } from '@postbot/db'
import type { DevtoPublishOutcome, DevtoPublisher } from '@postbot/devto'
import { devtoChannelProfile } from '@postbot/devto'

import { createDevtoProviderAdapter } from './devto'
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
            title: 'Postbot release notes',
            body_markdown: '# A calmer publishing workflow',
            media: [],
        },
        publisherId: 'publisher-devto',
        channelId: 'channel-devto',
        channelName: 'DEV.to articles',
        kind: 'devto',
        credentialId: 'credential-devto',
        externalAccountId: '42',
        destination: { type: 'account', id: '42', name: 'Postbot' },
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
        async resolvePublisherCredentialSecrets() {
            return { accessToken: API_KEY, refreshToken: null, providerSession: null }
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
        accessibilityText: 'A Postbot release notes image',
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
                    value: { id: '42', username: 'postbot', name: 'Postbot' },
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
                    title: 'Postbot release notes',
                    body_markdown: '# A calmer publishing workflow',
                    media: [{ assetId: media.assetId }],
                },
                media: [media],
                mediaReferenceCount: 1,
            }),
            async () => 'https://media.example/postbot/signed-image'
        )

        await expect(adapter.execute(input)).resolves.toEqual({
            type: 'published',
            externalId: 'article-42',
        })
        expect(publishedInput).toEqual({
            apiKey: API_KEY,
            title: 'Postbot release notes',
            bodyMarkdown: '# A calmer publishing workflow',
            mainImageUrl: 'https://media.example/postbot/signed-image',
        })
    })

    it('marks the project credential for reconnect on authentication failure', async () => {
        const publisher: DevtoPublisher = {
            async getMe() {
                return {
                    kind: 'success',
                    value: { id: '42', username: 'postbot', name: 'Postbot' },
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
                    value: { id: '42', username: 'postbot', name: 'Postbot' },
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
                    title: 'Postbot release notes',
                    body_markdown: '# A calmer publishing workflow',
                    media: [{ assetId: media.assetId }],
                },
                media: [{ ...media, contentType: 'image/gif' }],
                mediaReferenceCount: 1,
            }),
            async () => 'https://media.example/postbot/signed-image'
        )

        await expect(unsupported.adapter.execute(unsupported.input)).resolves.toMatchObject({
            type: 'permanent_failure',
        })
        expect(dispatched).toBe(false)

        const unavailable = executeWith(
            publisher,
            createTarget({
                content: {
                    title: 'Postbot release notes',
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
})
