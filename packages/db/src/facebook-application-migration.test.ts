import { expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerApplicationPolicies } from '../../../apps/api/src/providers/registry'
import { closeDatabase, createDatabase } from './client'
import { createSecretCipher } from './encrypted-secret-crypto'
import { seedLegacyProjectChannel } from './legacy-migration-fixture'
import { defaultMigrationsFolder, runMigrations } from './migrations'
import { createAuthorizationAttemptStore } from './oauth-authorization-attempt-store'
import { createProviderApplicationStore } from './provider-application-store'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'

test('Facebook application migration preserves encrypted configurations and referenced OAuth attempts', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'postbot-facebook-migration-'))
    const database = createDatabase(':memory:')
    try {
        const journal = JSON.parse(
            readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
        ) as { entries: { idx: number; tag: string }[] }
        const previous = { ...journal, entries: journal.entries.filter(entry => entry.idx < 12) }
        mkdirSync(join(folder, 'meta'))
        writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(previous))
        for (const entry of previous.entries)
            copyFileSync(
                join(defaultMigrationsFolder, `${entry.tag}.sql`),
                join(folder, `${entry.tag}.sql`)
            )
        runMigrations(database, folder)
        const now = 1_800_000_000_000
        database.$client
            .query(
                'insert into "user" (id, name, email, email_verified, created_at, updated_at) values (?1, ?2, ?3, 1, ?4, ?4)'
            )
            .run('owner', 'Owner', 'owner@example.test', now)
        const key = new Uint8Array(32).fill(9)
        const applications = createProviderApplicationStore(database, {
            policies: providerApplicationPolicies,
            cipher: createSecretCipher({
                domain: 'postbot.provider-application',
                keyId: 'test',
                key,
            }),
            now: () => now,
        })
        const saved = await applications.createProviderApplication({
            providerId: 'linkedin',
            name: 'Existing application',
            clientId: 'existing-id',
            clientSecret: 'existing-encrypted-secret',
            createdByUserId: 'owner',
        })
        if (saved.kind !== 'created') throw new Error('Expected configuration')
        const seeded = seedLegacyProjectChannel(database, 'owner', now)
        const project = { project: seeded.project, actor: seeded.actor }
        const channel = seeded.channel
        const attempts = createAuthorizationAttemptStore(database, {
            cipher: createPublisherCredentialCipher({ keyId: 'test', key }),
            now: () => now,
            validateReturnPath: path => path,
        })
        const stateDigest = new Uint8Array(32).fill(8)
        const created = await attempts.createAuthorizationAttempt({
            projectId: project.project.id,
            channelId: channel.id,
            connectedByActorId: project.actor.id,
            providerId: 'linkedin',
            providerApplicationId: saved.configuration.id,
            callbackUri: 'https://postbot.example/callback',
            scopes: [],
            returnPath: '/dashboard',
            stateDigest,
            codeVerifier: 'a'.repeat(43),
            providerState: 'existing-pending-secret',
        })
        expect(created.kind).toBe('created')
        const before = database.$client
            .query('select * from provider_application_configurations')
            .all()
        runMigrations(database)
        expect(
            database.$client.query('select * from provider_application_configurations').all()
        ).toEqual(before)
        expect((await applications.resolveProviderApplication('linkedin'))?.clientSecret).toBe(
            'existing-encrypted-secret'
        )
        expect(attempts.getAuthorizationAttempt(stateDigest)?.providerApplicationId).toBe(
            saved.configuration.id
        )
        expect(
            await attempts.readPendingAuthorizationProviderState({
                stateDigest,
                connectedByActorId: project.actor.id,
                providerId: 'linkedin',
                callbackUri: 'https://postbot.example/callback',
            })
        ).toMatchObject({ kind: 'ready', providerState: 'existing-pending-secret' })
        expect(database.$client.query('PRAGMA foreign_key_check').all()).toEqual([])
        expect(
            (
                await applications.createProviderApplication({
                    providerId: 'facebook',
                    name: 'Facebook',
                    clientId: '123',
                    clientSecret: 'new-secret',
                    createdByUserId: 'owner',
                })
            ).kind
        ).toBe('created')
        runMigrations(database)
        expect(
            database.$client.query('select count(*) as count from __drizzle_migrations').get()
        ).toEqual({ count: journal.entries.length })
    } finally {
        closeDatabase(database)
        rmSync(folder, { recursive: true, force: true })
    }
})
