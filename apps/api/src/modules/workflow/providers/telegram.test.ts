import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import type { PublisherExecutionTarget, ProviderMediaDelivery } from '@postbot/db'
import { createTelegramPublisher, telegramChannelProfile } from '@postbot/telegram'

import type { BuiltInProviderExecutionInput, ProviderMediaDeliveryPort } from './registry'
import { createTelegramProviderAdapter } from './telegram'
const now = 1_800_000_000_000
function createTarget(overrides: Partial<PublisherExecutionTarget> = {}): PublisherExecutionTarget {
    return {
        jobId: 'job-telegram',
        projectId: 'project-telegram',
        publicationId: 'publication-telegram',
        scheduledAt: now,
        executionRevisionId: 'execution-revision-1',
        profileVersionId: 'profile-version-1',
        mediaReferenceCount: 0,
        profile: telegramChannelProfile,
        content: { text: 'Hello Telegram', media: [] },
        publisherId: 'publisher-telegram',
        channelId: 'channel-telegram',
        channelName: 'Telegram channel',
        kind: 'telegram',
        credentialId: 'credential-telegram',
        externalAccountId: '123456',
        destination: { type: 'channel', id: '-1001234567890', name: 'announcements' },
        providerId: 'telegram',
        credentialState: 'active',
        credentialExpiresAt: null,
        endpointUrl: null,
        authentication: null,
        attempt: 1,
        media: [],
        ...overrides,
    }
}

function fixture(
    withMedia = false,
    response: () => Promise<Response> = async () =>
        Response.json({
            ok: true,
            result: {
                message_id: 42,
                chat: { id: -1001234567890, type: 'channel' },
                photo: [{ file_id: 'remote-photo' }],
            },
        })
) {
    const bytes = new Uint8Array([1, 2, 3])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const target = createTarget(
        withMedia
            ? {
                  mediaReferenceCount: 1,
                  content: { text: 'Caption', media: [{ assetId: 'asset' }] },
                  media: [
                      {
                          id: 'execution-media',
                          projectId: 'project-telegram',
                          executionRevisionId: 'execution-revision-1',
                          targetRevisionMediaId: 'target-media',
                          assetId: 'asset',
                          representationId: 'representation',
                          position: 0,
                          contentPath: '/media/0',
                          role: null,
                          accessibilityText: null,
                          originalFilename: 'photo.png',
                          contentType: 'image/png',
                          family: 'image',
                          byteSize: 3,
                          sha256,
                          width: 1,
                          height: 1,
                          durationMs: null,
                          storeId: 'local',
                          objectKey: 'photo',
                      },
                  ],
              }
            : {}
    )
    let state: ProviderMediaDelivery = {
        id: 'delivery',
        projectId: target.projectId,
        executionMediaId: 'execution-media',
        publisherId: target.publisherId,
        providerId: 'telegram',
        state: 'pending',
        attempts: 0,
        remoteMediaId: null,
        remoteMediaUrl: null,
        remoteMediaExpiresAt: null,
        lastAttemptAt: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
    }
    let sends = 0
    let reconnects = 0
    let opens = 0
    let changed = false
    const ledger: ProviderMediaDeliveryPort = {
        reserve: () => state,
        retry: () => (state = { ...state, state: 'pending' }),
        start: () => (state = { ...state, state: 'uploading', attempts: state.attempts + 1 }),
        complete: input =>
            (state = { ...state, state: 'uploaded', remoteMediaId: input.remoteMediaId }),
        recordRemoteMediaId: () => {
            throw new Error('Unexpected intermediate checkpoint')
        },
        fail: input =>
            (state = {
                ...state,
                state: input.ambiguous ? 'ambiguous' : 'failed',
                errorCode: input.errorCode,
            }),
    }
    const adapter = createTelegramProviderAdapter({
        createPublisher: () =>
            createTelegramPublisher({
                fetcher: async () => {
                    sends++
                    return response()
                },
            }),
    })
    const input: BuiltInProviderExecutionInput = {
        target,
        now,
        providerMediaDeliveryStore: ledger,
        credentials: {
            resolvePublisherCredentialSecrets: async () => ({
                accessToken: '123456:synthetic-token',
                refreshToken: null,
                providerSession: null,
            }),
            replacePublisherCredentialTokens: async () => ({ kind: 'conflict' }),
            markPublisherCredentialReconnectRequired: () => {
                reconnects++
            },
        },
        media: {
            openRepresentationContent: async () => {
                opens++
                const content = changed && opens > 1 ? new Uint8Array([4, 5, 6]) : bytes
                return {
                    representation: { storeId: 'local', objectKey: 'photo' },
                    size: 3,
                    contentType: 'image/png',
                    sha256,
                    stream: new Blob([content]).stream(),
                    lastModified: now,
                }
            },
        } as unknown as NonNullable<BuiltInProviderExecutionInput['media']>,
    }
    return {
        adapter,
        input,
        get sends() {
            return sends
        },
        get reconnects() {
            return reconnects
        },
        get state() {
            return state
        },
        setChanged: () => {
            changed = true
        },
        setState: (value: ProviderMediaDelivery['state']) => {
            state = { ...state, state: value }
        },
    }
}

test('executes text through the provider and returns durable publication identity', async () => {
    const item = fixture()
    expect(await item.adapter.execute(item.input)).toEqual({
        type: 'published',
        externalId: '-1001234567890:42',
    })
    expect(item.sends).toBe(1)
    expect(item.reconnects).toBe(0)
})

test('completes media delivery with the remote file identity and never resends an uploaded delivery', async () => {
    const item = fixture(true)
    expect(await item.adapter.execute(item.input)).toEqual({
        type: 'published',
        externalId: '-1001234567890:42',
    })
    expect(item.state).toMatchObject({ state: 'uploaded', remoteMediaId: 'remote-photo' })
    expect((await item.adapter.execute(item.input)).type).toBe('ambiguous')
    expect(item.sends).toBe(1)
})

test('detects same-size media mutation after the initial verified read before any send', async () => {
    const item = fixture(true)
    item.setChanged()
    expect((await item.adapter.execute(item.input)).type).toBe('permanent_failure')
    expect(item.state).toMatchObject({ state: 'failed', errorCode: 'media_changed' })
    expect(item.sends).toBe(0)
})

test('prevents replay of uploading and ambiguous media states', async () => {
    for (const state of ['uploading', 'ambiguous'] as const) {
        const item = fixture(true)
        item.setState(state)
        expect((await item.adapter.execute(item.input)).type).toBe('ambiguous')
        expect(item.sends).toBe(0)
    }
})

test('marks only invalid credentials for reconnect and preserves uncertain media outcomes', async () => {
    for (const status of [401, 403, 500]) {
        const item = fixture(true, async () =>
            Response.json({ ok: false, error_code: status }, { status })
        )
        expect((await item.adapter.execute(item.input)).type).toBe(
            status === 500 ? 'ambiguous' : 'permanent_failure'
        )
        expect(item.reconnects).toBe(status === 401 ? 1 : 0)
        expect(item.state.state).toBe(status === 500 ? 'ambiguous' : 'failed')
    }
})

test('preserves rate-limit deferral and can retry a definitely rejected upload', async () => {
    let first = true
    const item = fixture(true, async () => {
        if (first) {
            first = false
            return Response.json(
                { ok: false, error_code: 429, parameters: { retry_after: 12 } },
                { status: 429 }
            )
        }
        return Response.json({
            ok: true,
            result: {
                message_id: 42,
                chat: { id: -1001234567890, type: 'channel' },
                photo: [{ file_id: 'remote-photo' }],
            },
        })
    })
    expect(await item.adapter.execute(item.input)).toMatchObject({
        type: 'deferred',
        resumeAfterMs: 12000,
    })
    expect(item.state.state).toBe('failed')
    expect((await item.adapter.execute(item.input)).type).toBe('published')
    expect(item.state.state).toBe('uploaded')
    expect(item.sends).toBe(2)
})

test('missing media identity and failed completion remain ambiguous without a second upload', async () => {
    const missing = fixture(true, async () =>
        Response.json({
            ok: true,
            result: { message_id: 42, chat: { id: -1001234567890, type: 'channel' } },
        })
    )
    expect((await missing.adapter.execute(missing.input)).type).toBe('ambiguous')
    expect(missing.state.state).toBe('ambiguous')
    expect((await missing.adapter.execute(missing.input)).type).toBe('ambiguous')
    expect(missing.sends).toBe(1)
    const failed = fixture(true)
    failed.input.providerMediaDeliveryStore.complete = () => null
    expect((await failed.adapter.execute(failed.input)).type).toBe('ambiguous')
    expect(failed.state.state).toBe('uploading')
    expect((await failed.adapter.execute(failed.input)).type).toBe('ambiguous')
    expect(failed.sends).toBe(1)
})
