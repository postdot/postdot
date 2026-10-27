import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { statSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { closeDatabase, createDatabase, runMigrations } from './index'
import { recoverLocalAccountPassword } from './local-account-recovery'
import { acquireRuntimeQuiescenceLock } from './runtime-quiescence'

const now = 1_800_000_000_000

function seedRecoveryFixture(database: ReturnType<typeof createDatabase>): void {
    database.$client.exec(`
        INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
        VALUES
            ('user-1', 'Recovery Operator', 'operator@postbot.local', 0, ${now}, ${now}),
            ('user-2', 'Other Member', 'other@postbot.local', 0, ${now}, ${now});

        INSERT INTO account (
            id, issuer, account_id, provider_id, user_id, password, created_at, updated_at
        ) VALUES ('credential-1', NULL, 'user-1', 'credential', 'user-1', 'old-hash', ${now}, ${now});

        INSERT INTO session (
            id, expires_at, token, created_at, updated_at, user_id
        ) VALUES
            ('session-1', ${now + 60_000}, 'target-session-token', ${now}, ${now}, 'user-1'),
            ('session-2', ${now + 60_000}, 'other-session-token', ${now}, ${now}, 'user-2');

        INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
        VALUES
            ('reset-1', 'reset-password:target-token', 'user-1', ${now + 60_000}, ${now}, ${now}),
            ('reset-2', 'reset-password:other-token', 'user-2', ${now + 60_000}, ${now}, ${now});

        INSERT INTO organization (id, name, slug, created_at)
        VALUES ('organization-1', 'Workspace', 'workspace', ${now});

        INSERT INTO workspaces (id, organization_id, name, slug, created_at, updated_at)
        VALUES ('workspace-1', 'organization-1', 'Workspace', 'workspace', ${now}, ${now});

        INSERT INTO projects (id, name, workspace_id, created_at, updated_at)
        VALUES ('project-1', 'Preserved project', 'workspace-1', ${now}, ${now});

        INSERT INTO actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        VALUES ('actor-1', 'project-1', 'human', 'user-1', 'Recovery Operator', ${now}, ${now});

        INSERT INTO actors (id, workspace_id, origin_actor_id, kind, subject_id, display_name, created_at, updated_at)
        VALUES ('workspace-actor-1', 'workspace-1', 'actor-1', 'human', 'user-1', 'Recovery Operator', ${now}, ${now});

        INSERT INTO publisher_credentials (
            id, workspace_id, provider_id, external_account_id, scopes, state,
            connected_by_actor_id, encryption_version, encryption_key_id,
            access_token_ciphertext, access_token_nonce, revision, created_at, updated_at
        ) VALUES (
            'publisher-credential-1', 'workspace-1', 'bluesky', 'did:plc:preserved', '[]', 'active',
            'workspace-actor-1', 1, 'publisher-key-v1', zeroblob(32), zeroblob(12), 1, ${now}, ${now}
        );

        INSERT INTO apikey (id, reference_id, key, created_at, updated_at)
        VALUES ('api-key-1', 'user-1', 'hashed-api-key', ${now}, ${now});
    `)
}

describe('offline local account password recovery', () => {
    it('backs up first, changes only the selected credential, and revokes its recovery sessions', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-account-recovery-'))
        const databaseFilename = join(directory, 'postbot.sqlite')

        try {
            const fixture = createDatabase(databaseFilename)
            runMigrations(fixture)
            seedRecoveryFixture(fixture)
            closeDatabase(fixture)

            const result = recoverLocalAccountPassword({
                databaseFilename,
                email: ' OPERATOR@POSTBOT.LOCAL ',
                passwordHash: 'new-better-auth-hash',
                now: () => now + 1,
            })

            expect(result).toMatchObject({
                databaseFilename,
                email: 'OPERATOR@POSTBOT.LOCAL',
                revokedSessionCount: 1,
                invalidatedResetTokenCount: 1,
            })
            expect(statSync(dirname(result.backupFilename)).mode & 0o777).toBe(0o700)
            expect(statSync(result.backupFilename).mode & 0o777).toBe(0o600)
            expect(await Bun.file(`${databaseFilename}.runtime.lock`).exists()).toBe(false)

            const recovered = new Database(databaseFilename, { readonly: true })
            try {
                expect(
                    recovered
                        .query<{ readonly password: string }, []>(
                            "SELECT password FROM account WHERE id = 'credential-1'"
                        )
                        .get()
                ).toEqual({ password: 'new-better-auth-hash' })
                expect(
                    recovered
                        .query<{ readonly id: string }, []>(
                            "SELECT id FROM session WHERE user_id = 'user-1'"
                        )
                        .all()
                ).toEqual([])
                expect(
                    recovered
                        .query<{ readonly id: string }, []>(
                            "SELECT id FROM verification WHERE value = 'user-1'"
                        )
                        .all()
                ).toEqual([])
                expect(
                    recovered
                        .query<{ readonly token: string }, []>(
                            "SELECT token FROM session WHERE user_id = 'user-2'"
                        )
                        .get()
                ).toEqual({ token: 'other-session-token' })
                expect(
                    recovered
                        .query<{ readonly id: string }, []>(
                            "SELECT id FROM verification WHERE value = 'user-2'"
                        )
                        .get()
                ).toEqual({ id: 'reset-2' })
                expect(
                    recovered
                        .query<{ readonly name: string }, []>(
                            "SELECT name FROM projects WHERE id = 'project-1'"
                        )
                        .get()
                ).toEqual({ name: 'Preserved project' })
                expect(
                    recovered
                        .query<
                            {
                                readonly encryption_key_id: string
                                readonly access_token_ciphertext: Uint8Array
                                readonly access_token_nonce: Uint8Array
                            },
                            []
                        >(
                            `SELECT encryption_key_id, access_token_ciphertext, access_token_nonce
                             FROM publisher_credentials WHERE id = 'publisher-credential-1'`
                        )
                        .get()
                ).toMatchObject({
                    encryption_key_id: 'publisher-key-v1',
                    access_token_ciphertext: new Uint8Array(32),
                    access_token_nonce: new Uint8Array(12),
                })
                expect(
                    recovered
                        .query<{ readonly key: string }, []>(
                            "SELECT key FROM apikey WHERE id = 'api-key-1'"
                        )
                        .get()
                ).toEqual({ key: 'hashed-api-key' })
            } finally {
                recovered.close()
            }

            const backup = new Database(result.backupFilename, { readonly: true })
            try {
                expect(
                    backup
                        .query<{ readonly password: string }, []>(
                            "SELECT password FROM account WHERE id = 'credential-1'"
                        )
                        .get()
                ).toEqual({ password: 'old-hash' })
                expect(
                    backup
                        .query<{ readonly id: string }, []>(
                            "SELECT id FROM session WHERE user_id = 'user-1'"
                        )
                        .get()
                ).toEqual({ id: 'session-1' })
            } finally {
                backup.close()
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('fails closed while a Postdot server owns the database lock', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-account-recovery-'))
        const databaseFilename = join(directory, 'postbot.sqlite')

        try {
            const fixture = createDatabase(databaseFilename)
            runMigrations(fixture)
            seedRecoveryFixture(fixture)
            closeDatabase(fixture)

            const serverLock = acquireRuntimeQuiescenceLock(databaseFilename, 'server')
            expect(() =>
                recoverLocalAccountPassword({
                    databaseFilename,
                    email: 'operator@postbot.local',
                    passwordHash: 'must-not-be-written',
                    now: () => now,
                })
            ).toThrow('already held')
            serverLock.release()

            const unchanged = new Database(databaseFilename, { readonly: true })
            try {
                expect(
                    unchanged
                        .query<{ readonly password: string }, []>(
                            "SELECT password FROM account WHERE id = 'credential-1'"
                        )
                        .get()
                ).toEqual({ password: 'old-hash' })
            } finally {
                unchanged.close()
            }
            const filenames = await readdir(directory)
            expect(
                filenames.filter(filename => filename.includes('.before-password-recovery-'))
            ).toHaveLength(0)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('does not create a backup when the account has no password credential', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postbot-account-recovery-'))
        const databaseFilename = join(directory, 'postbot.sqlite')

        try {
            const fixture = createDatabase(databaseFilename)
            runMigrations(fixture)
            fixture.$client
                .query(
                    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
                     VALUES ('oauth-user', 'OAuth User', 'oauth@postbot.local', 0, ?1, ?1)`
                )
                .run(now)
            closeDatabase(fixture)

            expect(() =>
                recoverLocalAccountPassword({
                    databaseFilename,
                    email: 'oauth@postbot.local',
                    passwordHash: 'not-used',
                    now: () => now,
                })
            ).toThrow('no email/password credential')
            expect(await Bun.file(`${databaseFilename}.runtime.lock`).exists()).toBe(false)
            const filenames = await readdir(directory)
            expect(
                filenames.filter(filename => filename.includes('.before-password-recovery-'))
            ).toHaveLength(0)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
