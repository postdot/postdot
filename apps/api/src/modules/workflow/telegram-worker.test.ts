import { expect, test } from 'bun:test'

import { ChannelProfileCompiler } from '@postbot/core'
import {
    createDatabase,
    closeDatabase,
    runMigrations,
    createManualStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
} from '@postbot/db'
import { publications } from '@postbot/db/schema'
import {
    createTelegramPublisher,
    telegramChannelProfile,
    telegramChannelProfileValidationAdapter,
} from '@postbot/telegram'

import { telegramPublisherConnectionPolicy } from '../publishers/providers/telegram'
import { createBuiltInProviderRegistry } from './providers/registry'
import { createTelegramProviderAdapter } from './providers/telegram'
import { createPublicationWorker } from './worker'

for (const scenario of ['published', 'ambiguous', 'authentication'] as const) {
    test(`Telegram worker persists ${scenario} without replaying completed work`, async () => {
        const database = createDatabase(':memory:')
        runMigrations(database)
        const now = 1_800_000_000_000
        const store = createManualStore(database, {
            now: () => now,
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
            const post = store.createPost({
                projectId: project.project.id,
                subjectId: 'operator',
                sourceContent: {
                    body: { text: 'Hello Telegram', format: 'plain_text' },
                    media: [],
                },
                publications: [
                    {
                        channelId: channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now,
                        targetContent: { text: 'Hello Telegram', media: [] },
                    },
                ],
            })
            expect(post?.publications).toHaveLength(1)
            let calls = 0
            const worker = createPublicationWorker({
                database,
                publisherStore: publishers,
                publisherCredentialStore: credentials,
                now: () => now,
                builtInProviderRegistry: createBuiltInProviderRegistry([
                    createTelegramProviderAdapter({
                        createPublisher: () =>
                            createTelegramPublisher({
                                fetcher: async (_input, init) => {
                                    calls++
                                    expect(JSON.parse(String(init?.body))).toEqual({
                                        chat_id: '-1001234567890',
                                        text: 'Hello Telegram',
                                    })
                                    if (scenario === 'ambiguous')
                                        throw new Error('Synthetic transport loss')
                                    if (scenario === 'authentication')
                                        return Response.json(
                                            { ok: false, error_code: 401 },
                                            { status: 401 }
                                        )
                                    return Response.json({
                                        ok: true,
                                        result: {
                                            message_id: 42,
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
                expect(
                    database
                        .select({ state: publications.state, externalId: publications.externalId })
                        .from(publications)
                        .all()
                ).toEqual([
                    {
                        state: scenario === 'authentication' ? 'failed' : scenario,
                        externalId: scenario === 'published' ? '-1001234567890:42' : null,
                    },
                ])
                await worker.processDueEvents(now + 60_000)
                expect(calls).toBe(1)
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
        }
    })
}
