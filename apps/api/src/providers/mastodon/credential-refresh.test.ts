import { expect, it } from 'bun:test'

import {
    closeDatabase,
    createDatabase,
    createManualStore,
    runMigrations,
    type PublisherExecutionTarget,
} from '@postdot/db'
import { mastodonChannelProfile } from '@postdot/mastodon'

import { createPublisherRuntime } from '../../modules/publishers/runtime'
import { prepareMastodonReplyAccount } from './reply'
import { createMastodonProviderAdapter } from './worker'

it('shares one renewal between publication and reply preparation and ignores stale target expiry', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const now = Date.now()
    let clock = now
    try {
        const project = createManualStore(database).createProject({
            name: 'Refresh fixture',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        const publisher = createPublisherRuntime(database, {
            now: () => clock,
            apiOrigin: 'http://127.0.0.1:3000',
            webOrigin: 'http://127.0.0.1:5173',
            publisherEncryptionKey: new Uint8Array(32).fill(1),
            publisherEncryptionKeyId: 'test',
            mastodon: {
                fetcher: async () => {
                    throw new Error('The reply must reuse the renewed credential')
                },
            },
        })
        const created = await publisher.credentialStore.createPublisherCredential({
            projectId: project.project.id,
            connectedByActorId: project.actor.id,
            providerId: 'mastodon',
            externalAccountId: '42',
            accessToken: 'expired',
            refreshToken: 'single-use',
            expiresAt: now - 1,
            providerSession: JSON.stringify({
                version: 1,
                instanceUrl: 'https://social.example.test',
                clientId: 'client',
                clientSecret: 'synthetic-client-secret',
            }),
        })
        if (created.kind !== 'created') throw new Error('Missing credential')
        const target: PublisherExecutionTarget = {
            jobId: 'job-1',
            projectId: project.project.id,
            publicationId: 'publication-1',
            scheduledAt: now,
            executionRevisionId: 'execution-1',
            profileVersionId: 'profile-1',
            mediaReferenceCount: 0,
            profile: mastodonChannelProfile,
            content: { text: 'Publication body', media: [] },
            publisherId: 'publisher-1',
            channelId: 'channel-1',
            channelName: 'Mastodon',
            kind: 'mastodon',
            credentialId: created.credential.id,
            externalAccountId: '42',
            destination: { type: 'account', id: '42', name: 'Account' },
            providerId: 'mastodon',
            credentialState: 'active',
            credentialExpiresAt: now - 1,
            endpointUrl: 'https://social.example.test',
            authentication: null,
            attempt: 1,
            media: [],
        }
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        let renewals = 0,
            sends = 0
        let replaceDuringSend = false
        const adapter = createMastodonProviderAdapter({
            refreshAccessToken: async () => {
                renewals++
                entered.resolve()
                await release.promise
                return {
                    accessToken: 'renewed-access',
                    refreshToken: 'rotated-refresh',
                    expiresInSeconds: 3600,
                    scopes: [],
                    tokenType: 'Bearer',
                }
            },
            fetcher: async (url, init) => {
                expect(new URL(String(url)).pathname).toBe('/api/v1/statuses')
                expect(new Headers(init?.headers).get('authorization')).toBe(
                    'Bearer renewed-access'
                )
                sends++
                if (replaceDuringSend) {
                    await publisher.credentialStore.replacePublisherCredentialTokens({
                        projectId: project.project.id,
                        credentialId: created.credential.id,
                        accessToken: 'new-owner-grant',
                        expiresAt: clock + 60000,
                    })
                    return Response.json(
                        { error: 'The old access token was rejected' },
                        { status: 401 }
                    )
                }
                return Response.json({
                    id: `status-${sends}`,
                    url: `https://social.example.test/@account/${sends}`,
                })
            },
        })
        const deliveries = {
            reserve: () => {
                throw new Error('No media expected')
            },
            start: () => null,
            recordRemoteMediaId: () => null,
            complete: () => null,
            fail: () => null,
            retry: () => null,
        }
        const first = adapter.execute({
            target,
            credentials: publisher.credentialStore,
            now,
            providerMediaDeliveryStore: deliveries,
        })
        await Promise.race([
            entered.promise,
            first.then(() => {
                throw new Error('The expired credential was not renewed')
            }),
        ])
        const reply = prepareMastodonReplyAccount({
            work: {
                projectId: project.project.id,
                credentialId: created.credential.id,
                instanceOrigin: 'https://social.example.test',
            },
            publisher,
            signal: new AbortController().signal,
            now,
        })
        const second = adapter.execute({
            target: { ...target, jobId: 'job-2', executionRevisionId: 'execution-2' },
            credentials: publisher.credentialStore,
            now,
            providerMediaDeliveryStore: deliveries,
        })
        release.resolve()
        const outcomes = await Promise.all([first, reply, second])
        expect(outcomes[0].type).toBe('published')
        expect(outcomes[1]).toMatchObject({ kind: 'ready', accessToken: 'renewed-access' })
        expect(outcomes[2].type).toBe('published')
        expect(renewals).toBe(1)
        expect(sends).toBe(2)
        // A later caller can still carry an old execution clock. Admission must
        // use the live credential clock when that newly issued token expires.
        clock = now + 7_200_000
        expect(
            (
                await adapter.execute({
                    target,
                    credentials: publisher.credentialStore,
                    now,
                    providerMediaDeliveryStore: deliveries,
                })
            ).type
        ).toBe('published')
        expect(renewals).toBe(2)
        expect(sends).toBe(3)
        replaceDuringSend = true
        expect(
            (
                await adapter.execute({
                    target,
                    credentials: publisher.credentialStore,
                    now,
                    providerMediaDeliveryStore: deliveries,
                })
            ).type
        ).toBe('permanent_failure')
        expect(
            publisher.credentialStore.getPublisherCredential(
                project.project.id,
                created.credential.id
            )?.state
        ).toBe('active')
        expect(
            (
                await publisher.credentialStore.resolvePublisherCredentialSecrets(
                    project.project.id,
                    created.credential.id
                )
            )?.accessToken
        ).toBe('new-owner-grant')
    } finally {
        closeDatabase(database)
    }
})
