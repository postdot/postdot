import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth, postdotUserApiKeyConfigId } from '@postdot/auth'
import {
    acquireRuntimeQuiescenceLock,
    closeDatabase,
    closePostgresDatabase,
    createAccessStore,
    createDatabase,
    createPostgresDatabase,
    runMigrations,
} from '@postdot/db'

import { runLocalAccountBootstrap } from './local-account-bootstrap'

const postgresTestUrl = process.env.POSTDOT_TEST_POSTGRES_URL

const credentials = {
    name: 'Administrator',
    email: 'bootstrap@example.test',
    password: 'private-bootstrap-password-123',
}
async function fixture(
    run: (directory: string, database: string, input: string, args: string[]) => Promise<void>
) {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-bootstrap-'))
    const database = join(directory, 'instance.sqlite')
    const input = join(directory, 'credentials.json')
    await writeFile(input, JSON.stringify(credentials), { mode: 0o600 })
    try {
        await run(directory, database, input, [
            'account',
            'bootstrap',
            '--database',
            database,
            '--input',
            input,
        ])
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
describe('offline administrator bootstrap', () => {
    it('claims a fresh installation, closes signup, clears its temporary session and refuses a second bootstrap', async () => {
        await fixture(async (_directory, filename, input, args) => {
            await runLocalAccountBootstrap(args)
            await writeFile(
                input,
                JSON.stringify({ ...credentials, password: 'replacement-password-456' })
            )
            await expect(runLocalAccountBootstrap(args)).rejects.toThrow('already configured')
            const database = createDatabase(filename)
            try {
                const access = createAccessStore(database)
                expect((await access.getInstanceState()).state).toBe('claimed')
                expect(await access.isSignupAllowed()).toBe(false)
                expect(
                    await database.sql.statement('select count(*) as count from session').get()
                ).toEqual({ count: 0 })
                const auth = createAuth(database, {
                    baseURL: 'http://localhost:3000',
                    secret: 'test-secret-at-least-thirty-two-characters',
                    access,
                    logger: { disabled: true },
                })
                const response = await auth.handler(
                    new Request('http://localhost:3000/api/auth/sign-in/email', {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            origin: 'http://localhost:3000',
                        },
                        body: JSON.stringify(credentials),
                    })
                )
                expect(response.status).toBe(200)
                expect(((await response.json()) as { user: { role: string } }).user.role).toBe(
                    'admin'
                )
            } finally {
                closeDatabase(database)
            }
        })
    })
    it('claims an initialized unclaimed database exactly once under concurrent invocations', async () => {
        await fixture(async (_directory, filename, _input, args) => {
            const database = createDatabase(filename)
            await runMigrations(database)
            closeDatabase(database)
            const results = await Promise.allSettled([
                runLocalAccountBootstrap(args),
                runLocalAccountBootstrap(args),
            ])
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
            const claimed = createDatabase(filename)
            try {
                expect(
                    await claimed.sql.statement('select count(*) as count from "user"').get()
                ).toEqual({
                    count: 1,
                })
                expect((await createAccessStore(claimed).getInstanceState()).state).toBe('claimed')
            } finally {
                closeDatabase(claimed)
            }
        })
    })
    it('refuses an occupied runtime lock without creating a database', async () => {
        await fixture(async (_directory, database, _input, args) => {
            const lock = acquireRuntimeQuiescenceLock(database, 'recovery')
            try {
                await expect(runLocalAccountBootstrap(args)).rejects.toThrow()
                expect(existsSync(database)).toBe(false)
            } finally {
                lock.release()
            }
        })
    })
    it('rejects malformed, oversized and symlinked secret files before opening a database', async () => {
        await fixture(async (directory, database, input, args) => {
            for (const content of [
                '{invalid',
                JSON.stringify({ ...credentials, password: 'short' }),
                ' '.repeat(16_385),
            ]) {
                await writeFile(input, content)
                await expect(runLocalAccountBootstrap(args)).rejects.toThrow()
                expect(existsSync(database)).toBe(false)
            }
            const link = join(directory, 'link.json')
            await symlink(input, link)
            await expect(runLocalAccountBootstrap([...args.slice(0, -1), link])).rejects.toThrow(
                'symbolic links'
            )
            expect(existsSync(database)).toBe(false)
        })
    })
    it('issues an unrestricted API key to a private 0600 file or inline JSON without leaving sessions', async () => {
        await fixture(async (directory, filename, _input, args) => {
            const keyOutput = join(directory, 'admin.pat')
            const result = await runLocalAccountBootstrap([
                ...args,
                '--issue-api-key',
                '--api-key-name',
                'ci-deployer',
                '--api-key-output',
                keyOutput,
                '--json',
            ])
            expect(result.user.role).toBe('admin')
            expect(result.user.email).toBe(credentials.email)
            expect(result.instanceState).toBe('claimed')
            expect(result.apiKey?.name).toBe('ci-deployer')
            expect(result.apiKey?.projectAccess).toBe('all')
            expect(result.apiKey?.actionAccess).toBe('all')
            expect(result.apiKey?.outputFile).toBe(keyOutput)
            expect(result.apiKey?.token).toBeUndefined()

            const fileStat = await lstat(keyOutput)
            expect(fileStat.isFile()).toBe(true)
            expect(fileStat.mode & 0o777).toBe(0o600)
            const token = await readFile(keyOutput, 'utf8')
            expect(token.startsWith('postdot_pat_')).toBe(true)

            const database = createDatabase(filename)
            try {
                expect(
                    await database.sql.statement('select count(*) as count from session').get()
                ).toEqual({ count: 0 })
                const access = createAccessStore(database)
                const auth = createAuth(database, {
                    baseURL: 'http://localhost:3000',
                    secret: 'test-secret-at-least-thirty-two-characters',
                    access,
                    logger: { disabled: true },
                })
                const verified = await auth.api.verifyApiKey({
                    body: { configId: postdotUserApiKeyConfigId, key: token },
                })
                expect(verified.valid).toBe(true)
                expect(verified.key?.referenceId).toBe(result.user.id)
            } finally {
                closeDatabase(database)
            }
        })

        await fixture(async (_directory, _filename, _input, args) => {
            const result = await runLocalAccountBootstrap([...args, '--issue-api-key', '--json'])
            expect(result.apiKey?.token?.startsWith('postdot_pat_')).toBe(true)
            expect(result.apiKey?.outputFile).toBeUndefined()
        })
    })
    it('rejects conflicting database targets, existing key output paths, and invalid options before changing state', async () => {
        await fixture(async (directory, database, input, args) => {
            const existingFile = join(directory, 'existing.pat')
            await writeFile(existingFile, 'occupied', { mode: 0o600 })
            await expect(
                runLocalAccountBootstrap([
                    ...args,
                    '--issue-api-key',
                    '--api-key-output',
                    existingFile,
                ])
            ).rejects.toThrow('already exists')
            expect(existsSync(database)).toBe(false)

            await expect(
                runLocalAccountBootstrap([
                    ...args,
                    '--database-url',
                    'postgres://localhost/postdot',
                ])
            ).rejects.toThrow('either --database or --database-url')

            await expect(
                runLocalAccountBootstrap([
                    'account',
                    'bootstrap',
                    '--database-url',
                    'mysql://localhost/postdot',
                    '--input',
                    input,
                ])
            ).rejects.toThrow('postgres:// or postgresql://')

            await expect(
                runLocalAccountBootstrap([...args, '--api-key-name', 'orphan'])
            ).rejects.toThrow('--issue-api-key')

            expect(existsSync(database)).toBe(false)
        })
    })
    it.skipIf(!postgresTestUrl)(
        'bootstraps a clean PostgreSQL database via --database-url and issues an API key',
        async () => {
            const directory = await mkdtemp(join(tmpdir(), 'postdot-pg-bootstrap-'))
            const input = join(directory, 'credentials.json')
            await writeFile(input, JSON.stringify(credentials), { mode: 0o600 })
            const schemaName = `bootstrap_test_${crypto.randomUUID().replaceAll('-', '_')}`
            const adminDb = createPostgresDatabase(postgresTestUrl!, { max: 1 })
            try {
                await adminDb.sql.statement(`create schema if not exists "${schemaName}"`).run()
                const pgUrl = new URL(postgresTestUrl!)
                pgUrl.searchParams.set('options', `-c search_path=${schemaName}`)
                const result = await runLocalAccountBootstrap([
                    'account',
                    'bootstrap',
                    '--database-url',
                    pgUrl.toString(),
                    '--input',
                    input,
                    '--issue-api-key',
                    '--api-key-name',
                    'pg-bootstrap',
                    '--json',
                ])
                expect(result.user.role).toBe('admin')
                expect(result.instanceState).toBe('claimed')
                expect(result.apiKey?.token?.startsWith('postdot_pat_')).toBe(true)

                await expect(
                    runLocalAccountBootstrap([
                        'account',
                        'bootstrap',
                        '--database-url',
                        pgUrl.toString(),
                        '--input',
                        input,
                    ])
                ).rejects.toThrow('already configured')
            } finally {
                await adminDb.sql.statement(`drop schema if exists "${schemaName}" cascade`).run()
                await closePostgresDatabase(adminDb)
                await rm(directory, { recursive: true, force: true })
            }
        }
    )
})
