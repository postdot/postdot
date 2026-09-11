import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase, runMigrations } from '@herald/db'

import { createPublisherRuntime } from './runtime'

const now = 1_800_000_000_000

function createUser(database: ReturnType<typeof createDatabase>) {
    database.$client
        .query(
            `insert into "user" (id, name, email, email_verified, created_at, updated_at)
             values (?1, ?2, ?3, 1, ?4, ?4)`
        )
        .run('user-1', 'Herald Operator', 'operator@herald.test', now)
}

function createRuntime(
    database: ReturnType<typeof createDatabase>,
    origins: { readonly apiOrigin: string; readonly webOrigin: string }
) {
    return createPublisherRuntime(database, {
        ...origins,
        publisherEncryptionKey: new Uint8Array(32).fill(4),
        publisherEncryptionKeyId: 'test-v1',
    })
}

describe('publisher runtime Bluesky OAuth profiles', () => {
    it('resolves a persisted Bluesky application as an official loopback client', async () => {
        const database = createDatabase(':memory:')
        runMigrations(database)
        createUser(database)
        const runtime = createRuntime(database, {
            apiOrigin: 'http://127.0.0.1:3000',
            webOrigin: 'http://127.0.0.1:5173',
        })

        try {
            const created = await runtime.providerApplicationStore.createProviderApplication({
                providerId: 'bluesky',
                name: 'Local Bluesky',
                clientMetadataUrl: null,
                createdByUserId: 'user-1',
            })
            expect(created.kind).toBe('created')
            if (created.kind !== 'created') return

            const resolved = await runtime.resolveBlueskyApplication(created.configuration.id)
            expect(resolved).toMatchObject({
                applicationId: created.configuration.id,
                callbackUri: 'http://127.0.0.1:3000/api/oauth/bluesky/callback',
                handleResolver: 'https://bsky.social/',
                oauthMode: 'loopback',
            })
            expect(resolved?.clientMetadata.client_id).toBe(
                'http://localhost?scope=atproto+repo%3Aapp.bsky.feed.post%3Faction%3Dcreate+blob%3Aimage%2F*&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Foauth%2Fbluesky%2Fcallback'
            )
            expect(resolved?.clientMetadata.application_type).toBe('native')
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects loopback OAuth when the dashboard and API origins are not consistent', async () => {
        const database = createDatabase(':memory:')
        runMigrations(database)
        createUser(database)
        const runtime = createRuntime(database, {
            apiOrigin: 'http://localhost:3000',
            webOrigin: 'http://localhost:5173',
        })

        try {
            const created = await runtime.providerApplicationStore.createProviderApplication({
                providerId: 'bluesky',
                name: 'Invalid local origins',
                clientMetadataUrl: null,
                createdByUserId: 'user-1',
            })
            expect(created.kind).toBe('created')
            if (created.kind !== 'created') return

            await expect(
                runtime.resolveBlueskyApplication(created.configuration.id)
            ).rejects.toThrow('same loopback IP')
        } finally {
            closeDatabase(database)
        }
    })
})
