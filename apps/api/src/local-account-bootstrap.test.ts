import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@postdot/auth'
import {
    acquireRuntimeQuiescenceLock,
    closeDatabase,
    createAccessStore,
    createDatabase,
    runMigrations,
} from '@postdot/db'

import { runLocalAccountBootstrap } from './local-account-bootstrap'

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
                expect(access.getInstanceState().state).toBe('claimed')
                expect(access.isSignupAllowed()).toBe(false)
                expect(
                    database.$client.query('select count(*) as count from session').get()
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
            runMigrations(database)
            closeDatabase(database)
            const results = await Promise.allSettled([
                runLocalAccountBootstrap(args),
                runLocalAccountBootstrap(args),
            ])
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
            expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
            const claimed = createDatabase(filename)
            try {
                expect(claimed.$client.query('select count(*) as count from user').get()).toEqual({
                    count: 1,
                })
                expect(createAccessStore(claimed).getInstanceState().state).toBe('claimed')
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
})
