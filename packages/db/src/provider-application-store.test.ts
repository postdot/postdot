import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createSecretCipher } from './encrypted-secret-crypto'
import { runMigrations } from './migrations'
import { createProviderApplicationStore } from './provider-application-store'

const now = 1_800_000_000_000

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    database.$client
        .query(
            `insert into "user" (id, name, email, email_verified, created_at, updated_at)
             values (?1, ?2, ?3, 1, ?4, ?4)`
        )
        .run('user-1', 'Postbot Operator', 'operator@postbot.test', now)

    let timestamp = now
    let sequence = 0
    const store = createProviderApplicationStore(database, {
        cipher: createSecretCipher({
            domain: 'postbot.provider-application',
            keyId: 'primary',
            key: new Uint8Array(32).fill(7),
        }),
        now: () => ++timestamp,
        createId: () => `application-${++sequence}`,
    })

    return { database, store }
}

describe('provider application store', () => {
    it('encrypts client secrets and only exposes safe metadata', async () => {
        const fixture = createFixture()

        try {
            const secret = 'unique-provider-client-secret-for-file-scan'
            const result = await fixture.store.createProviderApplication({
                providerId: 'linkedin',
                name: 'Postbot LinkedIn',
                clientId: 'linkedin-client-id',
                clientSecret: secret,
                createdByUserId: 'user-1',
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return
            expect(result.configuration).toMatchObject({
                providerId: 'linkedin',
                clientId: 'linkedin-client-id',
                isDefault: true,
                hasClientSecret: true,
            })
            expect(result.configuration).not.toHaveProperty('clientSecret')
            expect(fixture.store.listProviderApplicationConfigurations()).toEqual([
                result.configuration,
            ])

            const resolved = await fixture.store.resolveProviderApplication('linkedin')
            expect(resolved?.clientSecret).toBe(secret)

            const stored = fixture.database.$client
                .query<{ ciphertext: Uint8Array }, []>(
                    `select client_secret_ciphertext as ciphertext
                     from provider_application_configurations`
                )
                .get()
            expect(stored).not.toBeNull()
            expect(Buffer.from(stored?.ciphertext ?? []).includes(Buffer.from(secret))).toBe(false)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('maintains one active default and promotes a fallback when disabling it', async () => {
        const fixture = createFixture()

        try {
            const first = await fixture.store.createProviderApplication({
                providerId: 'linkedin',
                name: 'Primary LinkedIn',
                clientId: 'linkedin-client-1',
                clientSecret: 'linkedin-secret-1',
                createdByUserId: 'user-1',
            })
            const second = await fixture.store.createProviderApplication({
                providerId: 'linkedin',
                name: 'Secondary LinkedIn',
                clientId: 'linkedin-client-2',
                clientSecret: 'linkedin-secret-2',
                createdByUserId: 'user-1',
                isDefault: false,
            })

            expect(first.kind).toBe('created')
            expect(second.kind).toBe('created')
            if (first.kind !== 'created' || second.kind !== 'created') return

            await fixture.store.updateProviderApplication({
                id: second.configuration.id,
                isDefault: true,
            })
            expect((await fixture.store.resolveProviderApplication('linkedin'))?.id).toBe(
                second.configuration.id
            )

            await fixture.store.updateProviderApplication({
                id: second.configuration.id,
                state: 'disabled',
            })
            expect((await fixture.store.resolveProviderApplication('linkedin'))?.id).toBe(
                first.configuration.id
            )
            expect(
                fixture.store
                    .listProviderApplicationConfigurations('linkedin')
                    .filter(configuration => configuration.isDefault)
            ).toHaveLength(1)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('validates provider-specific configuration shapes', async () => {
        const fixture = createFixture()

        try {
            const loopback = await fixture.store.createProviderApplication({
                providerId: 'bluesky',
                name: 'Postbot Bluesky local',
                clientMetadataUrl: null,
                createdByUserId: 'user-1',
            })
            expect(loopback.kind).toBe('created')
            if (loopback.kind !== 'created') return
            expect(loopback.configuration).toMatchObject({
                providerId: 'bluesky',
                clientMetadataUrl: null,
                oauthMode: 'loopback',
                handleResolver: 'https://bsky.social/',
                hasClientSecret: false,
            })

            await expect(
                fixture.store.createProviderApplication({
                    providerId: 'bluesky',
                    name: 'Invalid Bluesky',
                    clientMetadataUrl: 'http://localhost/client-metadata.json',
                    createdByUserId: 'user-1',
                })
            ).rejects.toThrow('clientMetadataUrl must use HTTPS')

            const result = await fixture.store.createProviderApplication({
                providerId: 'bluesky',
                name: 'Postbot Bluesky',
                clientMetadataUrl: 'https://postbot.example.test/client-metadata.json',
                createdByUserId: 'user-1',
            })
            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return
            expect(result.configuration).toMatchObject({
                providerId: 'bluesky',
                clientId: null,
                clientMetadataUrl: 'https://postbot.example.test/client-metadata.json',
                oauthMode: 'web',
                handleResolver: 'https://bsky.social/',
                hasClientSecret: false,
            })

            const switched = await fixture.store.updateProviderApplication({
                id: result.configuration.id,
                clientMetadataUrl: null,
            })
            expect(switched.kind).toBe('updated')
            if (switched.kind !== 'updated') return
            expect(switched.configuration).toMatchObject({
                clientMetadataUrl: null,
                oauthMode: 'loopback',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })
})

it('encrypts Facebook application secrets and rejects non-numeric application IDs', async () => {
    const { database, store } = createFixture()
    try {
        await expect(
            store.createProviderApplication({
                providerId: 'facebook',
                name: 'Invalid',
                clientId: 'not-an-app-id',
                clientSecret: 'synthetic-secret',
                createdByUserId: 'user-1',
            })
        ).rejects.toThrow('Facebook application ID must be numeric')
        const saved = await store.createProviderApplication({
            providerId: 'facebook',
            name: 'Facebook',
            clientId: '12345',
            clientSecret: 'facebook-encrypted-secret',
            createdByUserId: 'user-1',
        })
        expect(saved.kind).toBe('created')
        expect(
            JSON.stringify(store.listProviderApplicationConfigurations('facebook'))
        ).not.toContain('facebook-encrypted-secret')
        expect((await store.resolveProviderApplication('facebook'))?.clientSecret).toBe(
            'facebook-encrypted-secret'
        )
        expect(
            JSON.stringify(
                database.$client.query('select * from provider_application_configurations').all()
            )
        ).not.toContain('facebook-encrypted-secret')
    } finally {
        closeDatabase(database)
    }
})
