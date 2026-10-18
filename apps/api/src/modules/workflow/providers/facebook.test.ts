import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import type { PublisherExecutionTarget, ProviderMediaDelivery } from '@postbot/db'
import { createFacebookPublisher, facebookChannelProfile } from '@postbot/facebook'

import { createFacebookProviderAdapter } from './facebook'
import type { BuiltInProviderExecutionInput, ProviderMediaDeliveryPort } from './registry'
const now = 1_800_000_000_000
function createTarget(overrides: Partial<PublisherExecutionTarget> = {}): PublisherExecutionTarget {
    return {
        jobId: 'job-facebook',
        projectId: 'project-facebook',
        publicationId: 'publication-facebook',
        scheduledAt: now,
        executionRevisionId: 'execution-revision-1',
        profileVersionId: 'profile-version-1',
        mediaReferenceCount: 0,
        profile: facebookChannelProfile,
        content: { text: 'Hello Facebook', media: [] },
        publisherId: 'publisher-facebook',
        channelId: 'channel-facebook',
        channelName: 'Facebook channel',
        kind: 'facebook',
        credentialId: 'credential-facebook',
        externalAccountId: '123456',
        destination: { type: 'channel', id: '123456', name: 'announcements' },
        providerId: 'facebook',
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
        Response.json(withMedia ? { id: '987', post_id: '123456_42' } : { id: '123456_42' })
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
                          projectId: 'project-facebook',
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
        providerId: 'facebook',
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
    const requests: { url: string; body: RequestInit['body'] }[] = []
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
    const adapter = createFacebookProviderAdapter({
        createPublisher: () =>
            createFacebookPublisher({
                fetcher: async (url, init) => {
                    requests.push({ url: String(url), body: init?.body })
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
                accessToken: 'synthetic-page-token',
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
        requests,
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
        externalId: '123456_42',
        externalUrl: 'https://www.facebook.com/123456_42',
    })
    expect(item.sends).toBe(1)
    expect(item.reconnects).toBe(0)
})

test('completes media delivery with the remote file identity and never resends an uploaded delivery', async () => {
    const item = fixture(true)
    expect(await item.adapter.execute(item.input)).toEqual({
        type: 'published',
        externalId: '123456_42',
        externalUrl: 'https://www.facebook.com/123456_42',
    })
    expect(item.state).toMatchObject({ state: 'uploaded', remoteMediaId: '987' })
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

test('marks invalid credentials for reconnect while preserving uncertain photo results', async () => {
    for (const [status, code] of [
        [400, 190],
        [403, 200],
        [500, 1],
    ] as const) {
        const item = fixture(true, async () => Response.json({ error: { code } }, { status }))
        expect((await item.adapter.execute(item.input)).type).toBe(
            status === 500 ? 'ambiguous' : 'permanent_failure'
        )
        expect(item.reconnects).toBe(code === 190 ? 1 : 0)
        expect(item.state.state).toBe(status === 500 ? 'ambiguous' : 'failed')
    }
})

test('preserves a rate-limit deferral and retries only a definitely rejected photo', async () => {
    let first = true
    const item = fixture(true, async () => {
        if (first) {
            first = false
            return Response.json(
                { error: { code: 4 } },
                { status: 429, headers: { 'retry-after': '12' } }
            )
        }
        return Response.json({ id: '987', post_id: '123456_42' })
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

test('a missing post identity or failed checkpoint cannot replay a published photo', async () => {
    const missing = fixture(true, async () => Response.json({ id: '987' }))
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

test('rejects future contracts, link plus photo, unsupported media and mismatched references before sending', async () => {
    for (const change of [
        (item: ReturnType<typeof fixture>) => ({
            ...item.input.target,
            profile: {
                ...facebookChannelProfile,
                execution: {
                    kind: 'built_in' as const,
                    contractId: 'facebook',
                    revision: 'future',
                },
            },
        }),
        (item: ReturnType<typeof fixture>) => ({
            ...item.input.target,
            content: { ...item.input.target.content, link: 'https://example.test' },
        }),
        (item: ReturnType<typeof fixture>) => ({ ...item.input.target, mediaReferenceCount: 2 }),
        (item: ReturnType<typeof fixture>) => ({
            ...item.input.target,
            content: { text: 'Hello', media: [{ assetId: 'another-asset' }] },
        }),
        (item: ReturnType<typeof fixture>) => ({
            ...item.input.target,
            externalAccountId: 'other-page',
        }),
        (item: ReturnType<typeof fixture>) => ({
            ...item.input.target,
            media: item.input.target.media.map(media => ({
                ...media,
                contentType: 'video/mp4',
                family: 'video' as const,
            })),
        }),
    ]) {
        const item = fixture(true)
        expect((await item.adapter.execute({ ...item.input, target: change(item) })).type).toBe(
            'permanent_failure'
        )
        expect(item.sends).toBe(0)
    }
})

test('sends a link-only publication without inventing body text', async () => {
    const item = fixture()
    expect(
        (
            await item.adapter.execute({
                ...item.input,
                target: {
                    ...item.input.target,
                    content: { link: 'https://example.test/news', media: [] },
                },
            })
        ).type
    ).toBe('published')
    expect(Object.fromEntries(item.requests[0]!.body as URLSearchParams)).toEqual({
        message: '',
        published: 'true',
        link: 'https://example.test/news',
    })
})

test('sends a photo-only publication with its frozen accessibility text', async () => {
    const item = fixture(true)
    expect(
        (
            await item.adapter.execute({
                ...item.input,
                target: {
                    ...item.input.target,
                    content: { media: [{ assetId: 'asset' }] },
                    media: item.input.target.media.map(media => ({
                        ...media,
                        accessibilityText: 'A descriptive alternative',
                    })),
                },
            })
        ).type
    ).toBe('published')
    expect((item.requests[0]!.body as FormData).get('caption')).toBe('')
    expect((item.requests[0]!.body as FormData).get('alt_text_custom')).toBe(
        'A descriptive alternative'
    )
})
