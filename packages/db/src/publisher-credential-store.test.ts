import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'
import { projects, publisherCredentials } from './schema'

const now = 1_800_000_000_000

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)

    let timestamp = now
    let sequence = 0
    const manualStore = createManualStore(database, { now: () => timestamp })
    const project = manualStore.createProject({
        name: 'Credential Project',
        subjectId: 'user-1',
        displayName: 'Herald Operator',
    })
    const cipher = createPublisherCredentialCipher({
        keyId: 'primary',
        key: new Uint8Array(32).fill(1),
    })
    const store = createPublisherCredentialStore(database, {
        cipher,
        now: () => ++timestamp,
        createId: () => `credential-${++sequence}`,
    })

    return { database, project, cipher, store }
}

describe('publisher credential store', () => {
    it('never writes plaintext token bytes to the SQLite file', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'herald-credentials-'))
        const databasePath = join(directory, 'herald.sqlite')
        const database = createDatabase(databasePath)
        let databaseClosed = false

        try {
            runMigrations(database)
            const manualStore = createManualStore(database, { now: () => now })
            const project = manualStore.createProject({
                name: 'Credential File',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const store = createPublisherCredentialStore(database, {
                cipher: createPublisherCredentialCipher({
                    keyId: 'primary',
                    key: new Uint8Array(32).fill(1),
                }),
            })
            const accessToken = 'unique-plaintext-access-token-for-file-scan'
            const refreshToken = 'unique-plaintext-refresh-token-for-file-scan'
            const providerSession = 'unique-plaintext-provider-session-for-file-scan'

            expect(
                (
                    await store.createPublisherCredential({
                        projectId: project.project.id,
                        connectedByActorId: project.actor.id,
                        providerId: 'linkedin',
                        externalAccountId: 'member-file',
                        accessToken,
                        refreshToken,
                        providerSession,
                    })
                ).kind
            ).toBe('created')
            closeDatabase(database)
            databaseClosed = true

            const databaseBytes = Buffer.from(await Bun.file(databasePath).arrayBuffer())
            expect(databaseBytes.includes(Buffer.from(accessToken))).toBe(false)
            expect(databaseBytes.includes(Buffer.from(refreshToken))).toBe(false)
            expect(databaseBytes.includes(Buffer.from(providerSession))).toBe(false)
        } finally {
            if (!databaseClosed) closeDatabase(database)
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('stores project-owned encrypted secrets while exposing metadata separately', async () => {
        const fixture = createFixture()

        try {
            const result = await fixture.store.createPublisherCredential({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                externalAccountName: 'Herald Operator',
                scopes: ['w_member_social', 'openid'],
                accessToken: 'access-token-plaintext',
                refreshToken: 'refresh-token-plaintext',
                providerSession: '{"dpopJwk":"provider-session-plaintext"}',
                expiresAt: now + 60_000,
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return
            expect(result.credential).toMatchObject({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                scopes: ['openid', 'w_member_social'],
                state: 'active',
            })
            expect(result.credential).not.toHaveProperty('accessToken')
            expect(result.credential).not.toHaveProperty('refreshToken')
            expect(result.credential).not.toHaveProperty('ciphertext')
            expect(fixture.store.listPublisherCredentials(fixture.project.project.id)).toEqual([
                result.credential,
            ])

            const stored = fixture.database.$client
                .query<
                    {
                        accessToken: Uint8Array
                        refreshToken: Uint8Array
                        providerSession: Uint8Array
                        encryptionKeyId: string
                    },
                    []
                >(`
                    select access_token_ciphertext as accessToken,
                           refresh_token_ciphertext as refreshToken,
                           provider_session_ciphertext as providerSession,
                           encryption_key_id as encryptionKeyId
                    from publisher_credentials
                `)
                .get()
            expect(stored?.encryptionKeyId).toBe('primary')
            expect(new TextDecoder().decode(stored?.accessToken)).not.toContain(
                'access-token-plaintext'
            )
            expect(new TextDecoder().decode(stored?.refreshToken)).not.toContain(
                'refresh-token-plaintext'
            )
            expect(new TextDecoder().decode(stored?.providerSession)).not.toContain(
                'provider-session-plaintext'
            )
            expect(
                await fixture.store.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    result.credential.id
                )
            ).toEqual({
                accessToken: 'access-token-plaintext',
                refreshToken: 'refresh-token-plaintext',
                providerSession: '{"dpopJwk":"provider-session-plaintext"}',
            })

            const duplicate = await fixture.store.createPublisherCredential({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                accessToken: 'unused-token',
            })
            expect(duplicate).toEqual({
                kind: 'already_exists',
                credential: result.credential,
            })
            expect(fixture.database.select().from(publisherCredentials).all()).toHaveLength(1)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('preserves project ownership independently from application users', async () => {
        const fixture = createFixture()

        try {
            const created = await fixture.store.createPublisherCredential({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                accessToken: 'access-token',
            })
            expect(created.kind).toBe('created')
            if (created.kind !== 'created') return

            const foreignKeys = fixture.database.$client
                .query<{ table: string }, []>(`pragma foreign_key_list('publisher_credentials')`)
                .all()
                .map(row => row.table)
            expect(foreignKeys).toEqual([
                'provider_application_configurations',
                'provider_application_configurations',
                'actors',
                'actors',
                'projects',
            ])
            expect(foreignKeys).not.toContain('user')
            expect(foreignKeys).not.toContain('account')

            fixture.database
                .delete(projects)
                .where(eq(projects.id, fixture.project.project.id))
                .run()
            expect(fixture.database.select().from(publisherCredentials).all()).toEqual([])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rotates tokens atomically, preserves refresh tokens, and detects conflicts', async () => {
        const fixture = createFixture()

        try {
            const created = await fixture.store.createPublisherCredential({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                accessToken: 'access-token-1',
                refreshToken: 'refresh-token-1',
                providerSession: 'provider-session-1',
                expiresAt: now + 60_000,
            })
            expect(created.kind).toBe('created')
            if (created.kind !== 'created') return

            const updates = await Promise.all([
                fixture.store.replacePublisherCredentialTokens({
                    projectId: fixture.project.project.id,
                    credentialId: created.credential.id,
                    accessToken: 'access-token-2',
                    expiresAt: now + 120_000,
                }),
                fixture.store.replacePublisherCredentialTokens({
                    projectId: fixture.project.project.id,
                    credentialId: created.credential.id,
                    accessToken: 'access-token-competing',
                    expiresAt: now + 120_000,
                }),
            ])
            expect(updates.map(result => result.kind).sort()).toEqual(['conflict', 'updated'])

            const secrets = await fixture.store.resolvePublisherCredentialSecrets(
                fixture.project.project.id,
                created.credential.id
            )
            expect(secrets).not.toBeNull()
            if (secrets === null) throw new Error('Expected active credential secrets')
            expect(['access-token-2', 'access-token-competing']).toContain(secrets.accessToken)
            expect(secrets.refreshToken).toBe('refresh-token-1')
            expect(secrets.providerSession).toBe('provider-session-1')

            const removedRefresh = await fixture.store.replacePublisherCredentialTokens({
                projectId: fixture.project.project.id,
                credentialId: created.credential.id,
                accessToken: 'access-token-3',
                refreshToken: null,
                providerSession: 'provider-session-2',
                expiresAt: null,
            })
            expect(removedRefresh.kind).toBe('updated')
            expect(
                await fixture.store.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    created.credential.id
                )
            ).toEqual({
                accessToken: 'access-token-3',
                refreshToken: null,
                providerSession: 'provider-session-2',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('serializes concurrent connection attempts for the same external account', async () => {
        const fixture = createFixture()

        try {
            const input = {
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                accessToken: 'access-token',
            } as const
            const results = await Promise.all([
                fixture.store.createPublisherCredential(input),
                fixture.store.createPublisherCredential(input),
            ])

            expect(results.map(result => result.kind).sort()).toEqual(['already_exists', 'created'])
            expect(fixture.database.select().from(publisherCredentials).all()).toHaveLength(1)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('removes secret usability on reconnect-required and revocation states', async () => {
        const fixture = createFixture()

        try {
            const created = await fixture.store.createPublisherCredential({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                accessToken: 'access-token-1',
                refreshToken: 'refresh-token-1',
            })
            expect(created.kind).toBe('created')
            if (created.kind !== 'created') return

            expect(
                fixture.store.markPublisherCredentialReconnectRequired(
                    fixture.project.project.id,
                    created.credential.id
                )?.state
            ).toBe('reconnect_required')
            expect(
                await fixture.store.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    created.credential.id
                )
            ).toBeNull()

            const reconnected = await fixture.store.replacePublisherCredentialTokens({
                projectId: fixture.project.project.id,
                credentialId: created.credential.id,
                accessToken: 'access-token-2',
                expiresAt: now + 60_000,
            })
            expect(reconnected.kind).toBe('updated')
            expect(
                await fixture.store.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    created.credential.id
                )
            ).toEqual({
                accessToken: 'access-token-2',
                refreshToken: 'refresh-token-1',
                providerSession: null,
            })

            const revoked = fixture.store.revokePublisherCredential(
                fixture.project.project.id,
                created.credential.id
            )
            expect(revoked?.state).toBe('revoked')
            expect(
                await fixture.store.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    created.credential.id
                )
            ).toBeNull()

            const stored = fixture.database.select().from(publisherCredentials).get()
            expect(stored).toMatchObject({
                state: 'revoked',
                encryptionVersion: null,
                encryptionKeyId: null,
                accessTokenCiphertext: null,
                accessTokenNonce: null,
                refreshTokenCiphertext: null,
                refreshTokenNonce: null,
                providerSessionCiphertext: null,
                providerSessionNonce: null,
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails closed when the database envelope or deployment key is wrong', async () => {
        const fixture = createFixture()

        try {
            const created = await fixture.store.createPublisherCredential({
                projectId: fixture.project.project.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                accessToken: 'access-token',
            })
            expect(created.kind).toBe('created')
            if (created.kind !== 'created') return

            const wrongKeyStore = createPublisherCredentialStore(fixture.database, {
                cipher: createPublisherCredentialCipher({
                    keyId: 'primary',
                    key: new Uint8Array(32).fill(2),
                }),
            })
            await expect(
                wrongKeyStore.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    created.credential.id
                )
            ).rejects.toMatchObject({
                code: 'decryption_failed',
            })

            const row = fixture.database.select().from(publisherCredentials).get()
            if (row?.accessTokenCiphertext === null || row?.accessTokenCiphertext === undefined) {
                throw new Error('Expected encrypted access token')
            }
            const tampered = Buffer.from(row.accessTokenCiphertext)
            tampered[0] = (tampered[0] ?? 0) ^ 1
            fixture.database
                .update(publisherCredentials)
                .set({ accessTokenCiphertext: tampered })
                .run()

            await expect(
                fixture.store.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    created.credential.id
                )
            ).rejects.toMatchObject({
                code: 'decryption_failed',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
