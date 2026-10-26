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

const instagramMigrationPrefix = '0016_'

test('Instagram application migration preserves existing encrypted configurations and referenced OAuth attempts', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'postbot-instagram-migration-'))
    const database = createDatabase(':memory:')
    try {
        const journal = JSON.parse(
            readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
        ) as { entries: { idx: number; tag: string }[] }
        const instagramMigrationIndex = journal.entries.findIndex(entry =>
            entry.tag.startsWith(instagramMigrationPrefix)
        )
        if (instagramMigrationIndex < 1) throw new Error('Expected an Instagram migration entry')
        const previous = {
            ...journal,
            entries: journal.entries.slice(0, instagramMigrationIndex),
        }
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
            providerId: 'facebook',
            name: 'Existing Facebook application',
            clientId: '12345',
            clientSecret: 'existing-facebook-encrypted-secret',
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
            providerId: 'facebook',
            providerApplicationId: saved.configuration.id,
            callbackUri: 'https://postbot.example/callback',
            scopes: [],
            returnPath: '/dashboard',
            stateDigest,
            codeVerifier: 'a'.repeat(43),
            providerState: 'existing-pending-secret',
        })
        expect(created.kind).toBe('created')
        await expect(
            applications.createProviderApplication({
                providerId: 'instagram',
                name: 'Instagram before migration',
                clientId: '10001',
                clientSecret: 'premature-secret',
                createdByUserId: 'owner',
            })
        ).rejects.toThrow()
        const before = database.$client
            .query('select * from provider_application_configurations')
            .all()
        const attemptsBefore = database.$client
            .query('select * from oauth_authorization_attempts')
            .all()

        runMigrations(database)

        expect(
            database.$client.query('select * from provider_application_configurations').all()
        ).toEqual(before)
        expect(database.$client.query('select * from oauth_authorization_attempts').all()).toEqual(
            attemptsBefore
        )
        expect((await applications.resolveProviderApplication('facebook'))?.id).toBe(
            saved.configuration.id
        )
        expect((await applications.resolveProviderApplication('facebook'))?.clientSecret).toBe(
            'existing-facebook-encrypted-secret'
        )
        expect(attempts.getAuthorizationAttempt(stateDigest)?.providerApplicationId).toBe(
            saved.configuration.id
        )
        expect(
            await attempts.readPendingAuthorizationProviderState({
                stateDigest,
                connectedByActorId: project.actor.id,
                providerId: 'facebook',
                callbackUri: 'https://postbot.example/callback',
            })
        ).toMatchObject({ kind: 'ready', providerState: 'existing-pending-secret' })
        expect(database.$client.query('PRAGMA foreign_key_check').all()).toEqual([])

        const instagram = await applications.createProviderApplication({
            providerId: 'instagram',
            name: 'Postdot Instagram',
            clientId: '17841400000000000',
            clientSecret: 'instagram-encrypted-secret',
            createdByUserId: 'owner',
        })
        expect(instagram.kind).toBe('created')
        if (instagram.kind !== 'created') return
        expect(instagram.configuration).toMatchObject({
            providerId: 'instagram',
            clientId: '17841400000000000',
            hasClientSecret: true,
        })
        expect((await applications.resolveProviderApplication('instagram'))?.clientSecret).toBe(
            'instagram-encrypted-secret'
        )
        expect(
            JSON.stringify(
                database.$client.query('select * from provider_application_configurations').all()
            )
        ).not.toContain('instagram-encrypted-secret')
        expect(
            database.$client.query('select count(*) as count from __drizzle_migrations').get()
        ).toEqual({ count: journal.entries.length })
    } finally {
        closeDatabase(database)
        rmSync(folder, { recursive: true, force: true })
    }
})
