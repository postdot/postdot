import { describe, expect, it } from 'bun:test'

import { BLUESKY_REQUIRED_SCOPES } from '@postdot/bluesky'
import type { DatabaseHandle } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import { createPublisherRuntime } from './runtime'

const now = 1_800_000_000_000

async function createUser(database: DatabaseHandle) {
    await database.sql
        .statement(
            `insert into "user" (id, name, email, email_verified, created_at, updated_at)
             values (?1, ?2, ?3, 1, ?4, ?4)`
        )
        .run('user-1', 'Postdot Operator', 'operator@postdot.test', now)
}

function createRuntime(
    database: DatabaseHandle,
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
        const database = (await openTestDatabase()).database
        await createUser(database)
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
                `http://localhost?${new URLSearchParams({ scope: BLUESKY_REQUIRED_SCOPES.join(' '), redirect_uri: 'http://127.0.0.1:3000/api/oauth/bluesky/callback' })}`
            )
            expect(resolved?.clientMetadata.application_type).toBe('native')
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rejects loopback OAuth when the dashboard and API origins are not consistent', async () => {
        const database = (await openTestDatabase()).database
        await createUser(database)
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
            await closeTestDatabase(database)
        }
    })
})
