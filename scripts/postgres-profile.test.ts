import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQL } from 'bun'

/**
 * The single image runs on PostgreSQL when `POSTDOT_DATABASE_URL` is set
 * (ADR-097). Runs when `POSTDOT_TEST_POSTGRES_URL` names a server where the
 * test may create a disposable database.
 */
const serverUrl = process.env.POSTDOT_TEST_POSTGRES_URL
const repositoryRoot = join(import.meta.dir, '..')
const apiEntryPoint = join(repositoryRoot, 'apps/api/src/index.ts')
const cleanups: (() => Promise<void>)[] = []

afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
})

function freePort(): number {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() })
    const port = probe.port!
    void probe.stop(true)
    return port
}

async function waitForReady(origin: string, child: ReturnType<typeof Bun.spawn>) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`The API exited with ${child.exitCode}`)
        try {
            const response = await fetch(`${origin}/ready`)
            if (response.status === 200) return
        } catch {}
        await Bun.sleep(100)
    }
    throw new Error('The API did not become ready')
}

test.skipIf(serverUrl === undefined)(
    'the API starts on PostgreSQL, migrates it and refuses a second server',
    async () => {
        const name = `postdot_profile_${crypto.randomUUID().replaceAll('-', '')}`
        const admin = new SQL(serverUrl!, { max: 1 })
        await admin.unsafe(`create database ${name}`)
        cleanups.push(async () => {
            await admin.unsafe(`drop database if exists ${name} with (force)`)
            await admin.close()
        })
        const databaseUrl = new URL(serverUrl!)
        databaseUrl.pathname = `/${name}`
        const directory = await mkdtemp(join(tmpdir(), 'postdot-postgres-profile-'))
        cleanups.push(() => rm(directory, { recursive: true, force: true }))

        const port = freePort()
        const origin = `http://localhost:${port}`
        const environment: Record<string, string> = {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            TMPDIR: process.env.TMPDIR ?? '',
            NODE_ENV: 'test',
            PORT: String(port),
            POSTDOT_DATABASE_URL: databaseUrl.toString(),
            POSTDOT_MEDIA_DIRECTORY: join(directory, 'media'),
            BETTER_AUTH_URL: origin,
            POSTDOT_WEB_ORIGIN: 'http://localhost:5173',
            BETTER_AUTH_SECRET: 'postdot-isolated-postgres-test-auth-secret-32-characters',
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: 'postdot-isolated-postgres-test-media-secret-32-chars',
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: '34'.repeat(32),
            LOG_ENABLED: 'false',
        }
        const first = Bun.spawn([process.execPath, apiEntryPoint], {
            cwd: directory,
            env: environment,
            stdout: 'ignore',
            stderr: 'pipe',
        })
        cleanups.push(async () => {
            if (first.exitCode === null) first.kill('SIGKILL')
            await first.exited
        })
        await waitForReady(origin, first)

        const database = new SQL(databaseUrl.toString(), { max: 1 })
        try {
            const applied = await database.unsafe('select name from postdot_migrations order by id')
            expect(applied.length).toBeGreaterThan(0)
            const status = () =>
                fetch(`${origin}/api/instance/status`).then(response => response.json())
            expect(await status()).toEqual({ setupAvailable: true })
            // The first account claims the instance through Better Auth on PostgreSQL.
            const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
                body: JSON.stringify({
                    email: 'owner@postgres.local',
                    name: 'Owner',
                    password: 'correct-horse-battery-staple',
                }),
            })
            expect(signUp.status).toBe(200)
            expect(await status()).toEqual({ setupAvailable: false })
            expect(await database.unsafe('select role from "user"')).toEqual([{ role: 'admin' }])
        } finally {
            await database.close()
        }

        const second = Bun.spawn([process.execPath, apiEntryPoint], {
            cwd: directory,
            env: { ...environment, PORT: String(freePort()) },
            stdout: 'ignore',
            stderr: 'pipe',
        })
        expect(await second.exited).not.toBe(0)
        expect(await new Response(second.stderr).text()).toContain('Another Postdot server')

        first.kill('SIGTERM')
        expect(await first.exited).toBe(0)
    },
    60_000
)
