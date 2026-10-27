import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ChannelProfileCompiler } from '@postdot/core'
import {
    createDatabase,
    closeDatabase,
    runMigrations,
    createManualStore,
    createMediaAssetStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
} from '@postdot/db'
import { publications } from '@postdot/db/schema'
import { seedTestWorkspace } from '@postdot/db/testing'
import { createLocalMediaStore } from '@postdot/media'
import {
    createTelegramPublisher,
    telegramChannelProfile,
    telegramChannelProfileValidationAdapter,
} from '@postdot/telegram'

import { telegramPublisherConnectionPolicy } from '../../providers/telegram/connection-policy'
import { createTelegramProviderAdapter } from '../../providers/telegram/worker'
import { createBuiltInProviderRegistry } from './providers/registry'
import { createPublicationWorker } from './worker'

const scenarios = [
    { outcome: 'published', media: null },
    { outcome: 'ambiguous', media: null },
    { outcome: 'authentication', media: null },
    { outcome: 'published', media: 'photo' },
    { outcome: 'published', media: 'video' },
    { outcome: 'ambiguous', media: 'photo' },
    { outcome: 'retry', media: 'video' },
    { outcome: 'published', media: null, poll: true },
    { outcome: 'ambiguous', media: null, poll: true },
    { outcome: 'published', media: 'album' },
    { outcome: 'ambiguous', media: 'album' },
    { outcome: 'retry', media: 'album' },
] as const

for (const entry of scenarios) {
    const { outcome: scenario, media: mediaKind } = entry
    const poll = 'poll' in entry && entry.poll
    test(`Telegram worker persists ${poll ? 'poll' : (mediaKind ?? 'text')} ${scenario} without replaying completed work`, async () => {
        const database = createDatabase(':memory:')
        runMigrations(database)
        const now = 1_800_000_000_000
        let clock = now
        const rootDirectory = await mkdtemp(join(tmpdir(), 'postdot-telegram-worker-'))
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                storeId: 'telegram-test',
                rootDirectory,
                maxObjectBytes: 2_000_000,
            }),
            { now: () => clock }
        )
        const store = createManualStore(database, {
            now: () => clock,
            media,
            profileCompiler: new ChannelProfileCompiler({
                validationAdapters: [telegramChannelProfileValidationAdapter],
            }),
        })
        const credentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'test',
                key: new Uint8Array(32).fill(3),
            }),
            now: () => now,
        })
        const publishers = createPublisherStore(database, {
            credentialRevoker: credentials,
            connectionPolicies: { telegram: telegramPublisherConnectionPolicy },
            now: () => now,
        })
        try {
            const project = store.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'Telegram worker',
                subjectId: 'operator',
                displayName: 'Operator',
            })!
            const channel = store.createChannel({
                projectId: project.project.id,
                subjectId: 'operator',
                name: 'Announcements',
                profile: telegramChannelProfile,
            })!
            const credential = await credentials.createPublisherCredential({
                projectId: project.project.id,
                connectedByActorId: project.actor.id,
                providerId: 'telegram',
                externalAccountId: '123456',
                accessToken: '123456:synthetic-token',
                scopes: [],
            })
            if (credential.kind !== 'created') throw new Error('Credential fixture failed')
            expect(
                publishers.createPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel.id,
                    subjectId: 'operator',
                    kind: 'telegram',
                    credentialId: credential.credential.id,
                    destination: { type: 'channel', id: '-1001234567890', name: 'Announcements' },
                }).kind
            ).toBe('created')
            const bytes =
                mediaKind === 'video'
                    ? await Bun.file(
                          new URL(
                              '../../../../../packages/db/src/fixtures/video-h264.mp4',
                              import.meta.url
                          )
                      ).bytes()
                    : new Uint8Array(
                          Buffer.from(
                              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
                              'base64'
                          )
                      )
            const references: { assetId: string }[] = []
            const members =
                mediaKind === 'album' ? ['photo', 'video'] : mediaKind ? [mediaKind] : []
            for (const member of members) {
                const memberBytes =
                    member === 'video'
                        ? await Bun.file(
                              new URL(
                                  '../../../../../packages/db/src/fixtures/video-h264.mp4',
                                  import.meta.url
                              )
                          ).bytes()
                        : bytes
                const reservation = media.reserveUpload({
                    projectId: project.project.id,
                    subjectId: 'operator',
                    originalFilename: member === 'video' ? 'clip.mp4' : 'photo.png',
                    contentType: member === 'video' ? 'video/mp4' : 'image/png',
                    expectedSize: memberBytes.length,
                })!
                expect(reservation).not.toBeNull()
                expect(
                    await media.upload({
                        projectId: project.project.id,
                        subjectId: 'operator',
                        intentId: reservation.intent.id,
                        source: new Blob([memberBytes]).stream(),
                    })
                ).toMatchObject({ kind: 'uploaded' })
                expect(
                    await media.finalizeUpload({
                        projectId: project.project.id,
                        subjectId: 'operator',
                        intentId: reservation.intent.id,
                    })
                ).toMatchObject({ kind: 'ready' })
                references.push({ assetId: reservation.asset.id })
            }
            const post = store.createPost({
                projectId: project.project.id,
                subjectId: 'operator',
                sourceContent: {
                    body: { text: 'Hello Telegram', format: 'plain_text' },
                    media: references,
                },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now,
                        targetContent: {
                            text: 'Hello Telegram',
                            media: references,
                            ...(poll
                                ? {
                                      poll: {
                                          options: ['Updates', 'Tutorials'],
                                          multiple: true,
                                          openPeriod: 3600,
                                      },
                                  }
                                : {}),
                        },
                    },
                ],
            })
            expect(post?.publications).toHaveLength(1)
            let calls = 0
            const requests: { url: string; body: RequestInit['body'] }[] = []
            const worker = createPublicationWorker({
                database,
                publisherStore: publishers,
                publisherCredentialStore: credentials,
                now: () => clock,
                media,
                retryPolicy: { nextRunAt: ({ failedAt }) => failedAt + 1000 },
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createTelegramProviderAdapter({
                        createPublisher: () =>
                            createTelegramPublisher({
                                fetcher: async (input, init) => {
                                    calls++
                                    requests.push({ url: String(input), body: init?.body })
                                    if (scenario === 'retry' && calls === 1)
                                        return Response.json(
                                            {
                                                ok: false,
                                                error_code: 429,
                                                parameters: { retry_after: 1 },
                                            },
                                            { status: 429 }
                                        )
                                    if (scenario === 'ambiguous')
                                        throw new Error('Synthetic transport loss')
                                    if (scenario === 'authentication')
                                        return Response.json(
                                            { ok: false, error_code: 401 },
                                            { status: 401 }
                                        )
                                    if (mediaKind === 'album')
                                        return Response.json({
                                            ok: true,
                                            result: members.map((member, index) => ({
                                                message_id: 42 + index,
                                                chat: { id: -1001234567890, type: 'channel' },
                                                media_group_id: 'album-42',
                                                ...(member === 'photo'
                                                    ? { photo: [{ file_id: 'remote-photo-42' }] }
                                                    : { video: { file_id: 'remote-video-43' } }),
                                            })),
                                        })
                                    return Response.json({
                                        ok: true,
                                        result: {
                                            message_id: 42,
                                            ...(poll
                                                ? {
                                                      poll: {
                                                          id: 'poll-42',
                                                          question: 'Hello Telegram',
                                                          options: [
                                                              { text: 'Updates', voter_count: 0 },
                                                              { text: 'Tutorials', voter_count: 0 },
                                                          ],
                                                          is_anonymous: true,
                                                          type: 'regular',
                                                          allows_multiple_answers: true,
                                                          is_closed: false,
                                                          total_voter_count: 0,
                                                          open_period: 3600,
                                                      },
                                                  }
                                                : {}),
                                            ...(mediaKind === 'video'
                                                ? { video: { file_id: 'remote-video-42' } }
                                                : mediaKind === 'photo'
                                                  ? { photo: [{ file_id: 'remote-photo-42' }] }
                                                  : {}),
                                            chat: { id: -1001234567890, type: 'channel' },
                                        },
                                    })
                                },
                            }),
                    }),
                ]),
            })
            try {
                await worker.processDueEvents(now)
                if (scenario === 'retry') {
                    expect(
                        database.$client
                            .query(
                                'select state, remote_media_id as remoteId from provider_media_deliveries'
                            )
                            .all()
                    ).toEqual(members.map(() => ({ state: 'failed', remoteId: null })))
                    clock += 2000
                    await worker.processDueEvents(clock)
                }
                expect(
                    database
                        .select({ state: publications.state, externalId: publications.externalId })
                        .from(publications)
                        .all()
                ).toEqual([
                    {
                        state:
                            scenario === 'authentication'
                                ? 'failed'
                                : scenario === 'retry'
                                  ? 'published'
                                  : scenario,
                        externalId:
                            scenario === 'published' || scenario === 'retry'
                                ? mediaKind === 'album'
                                    ? '-1001234567890:42,43'
                                    : '-1001234567890:42'
                                : null,
                    },
                ])
                if (mediaKind) {
                    expect(
                        database.$client
                            .query(
                                'select state, remote_media_id as remoteId from provider_media_deliveries'
                            )
                            .all()
                    ).toEqual(
                        members.map((member, index) => ({
                            state: scenario === 'ambiguous' ? 'ambiguous' : 'uploaded',
                            remoteId:
                                scenario === 'ambiguous' ? null : `remote-${member}-${42 + index}`,
                        }))
                    )
                    expect(
                        database.$client
                            .query(
                                'select count(*) as count from publication_execution_revision_media'
                            )
                            .get()
                    ).toEqual({ count: members.length })
                }
                clock = now + 60_000
                await worker.processDueEvents(clock)
                expect(calls).toBe(scenario === 'retry' ? 2 : 1)
                // Assert outside the provider callback: uncertain-response handling catches errors.
                for (const request of requests) {
                    if (mediaKind === 'album') {
                        expect(request.url.endsWith('/sendMediaGroup')).toBe(true)
                        expect(request.body).toBeInstanceOf(FormData)
                        const body = request.body as FormData
                        const attachments = JSON.parse(String(body.get('media')))
                        expect(attachments.map((item: { type: string }) => item.type)).toEqual([
                            'photo',
                            'video',
                        ])
                        expect(attachments[0].caption).toBe('Hello Telegram')
                        expect(attachments[1].caption).toBeUndefined()
                    } else if (mediaKind) {
                        expect(
                            request.url.endsWith(
                                mediaKind === 'video' ? '/sendVideo' : '/sendPhoto'
                            )
                        ).toBe(true)
                        expect(request.body).toBeInstanceOf(FormData)
                        const body = request.body as FormData
                        expect(body.get('chat_id')).toBe('-1001234567890')
                        expect(body.get('caption')).toBe('Hello Telegram')
                        const file = body.get(mediaKind) as File
                        expect(file).toBeInstanceOf(Blob)
                        expect(file.type).toBe(mediaKind === 'video' ? 'video/mp4' : 'image/png')
                        expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
                    } else if (poll) {
                        expect(request.url.endsWith('/sendPoll')).toBe(true)
                        expect(JSON.parse(String(request.body))).toEqual({
                            chat_id: '-1001234567890',
                            question: 'Hello Telegram',
                            options: [{ text: 'Updates' }, { text: 'Tutorials' }],
                            is_anonymous: true,
                            type: 'regular',
                            allows_multiple_answers: true,
                            open_period: 3600,
                        })
                    } else {
                        expect(JSON.parse(String(request.body))).toEqual({
                            chat_id: '-1001234567890',
                            text: 'Hello Telegram',
                        })
                    }
                }

                const connection = publishers.listPublisherConnections(
                    project.project.id,
                    'operator'
                )
                expect(connection?.[0]?.state).toBe(
                    scenario === 'authentication' ? 'reconnect_required' : 'active'
                )
            } finally {
                await worker.stop()
            }
        } finally {
            closeDatabase(database)
            await rm(rootDirectory, { recursive: true, force: true })
        }
    })
}
