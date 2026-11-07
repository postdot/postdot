import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQL } from 'bun'

/**
 * PostgreSQL with S3 media allows several servers (ADR-097 §7): every server
 * serves HTTP, one elected leader runs the background runtimes, and changes
 * reach every server's streams through LISTEN/NOTIFY. Runs when
 * `POSTDOT_TEST_POSTGRES_URL` names a server where the test may create a
 * disposable database. An in-process stand-in answers the S3 protocol.
 */
const serverUrl = process.env.POSTDOT_TEST_POSTGRES_URL
const repositoryRoot = join(import.meta.dir, '..')
const apiEntryPoint = join(repositoryRoot, 'apps/api/src/index.ts')
const webOrigin = 'http://localhost:5173'
const cleanups: (() => Promise<void> | void)[] = []

afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
})

function freePort(): number {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() })
    const port = probe.port!
    void probe.stop(true)
    return port
}

interface Readiness {
    readonly status: string
    readonly checks: {
        readonly topology?: { readonly instances: string; readonly role: string }
    }
}

async function readiness(origin: string): Promise<Readiness | null> {
    try {
        return (await (await fetch(`${origin}/ready`)).json()) as Readiness
    } catch {
        return null
    }
}

async function waitFor<T>(
    read: () => Promise<T>,
    accept: (value: T) => boolean,
    timeoutMs: number,
    what: string
): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const value = await read()
        if (accept(value)) return value
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
        await Bun.sleep(100)
    }
}

/**
 * Reads a server-sent event stream. A read that loses a timeout race stays
 * pending and is reused, so no chunk is ever dropped.
 */
function streamReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder()
    let pending: ReturnType<typeof reader.read> | undefined
    const next = async (timeoutMs: number): Promise<string | null> => {
        pending ??= reader.read()
        const result = await Promise.race([pending, Bun.sleep(timeoutMs).then(() => null)])
        if (result === null || result === undefined) return null
        pending = undefined
        if (result.done) throw new Error('The stream ended')
        return decoder.decode(result.value, { stream: true })
    }
    return {
        /** Reads until the stream stays silent for `quietMs`. */
        async drain(quietMs: number) {
            while ((await next(quietMs)) !== null) {}
        },
        /** Reads until `match` holds for the text received during this call. */
        async until(match: (text: string) => boolean, timeoutMs: number): Promise<string> {
            const deadline = Date.now() + timeoutMs
            let text = ''
            while (!match(text)) {
                const remaining = deadline - Date.now()
                if (remaining <= 0) throw new Error(`No matching stream data; received: ${text}`)
                text += (await next(remaining)) ?? ''
            }
            return text
        },
    }
}

test.skipIf(serverUrl === undefined)(
    'two servers share PostgreSQL: one leader, cross-instance streams and failover',
    async () => {
        // A minimal S3 stand-in: objects live in memory; signatures are not checked.
        const objects = new Map<string, ArrayBuffer>()
        const s3 = Bun.serve({
            port: 0,
            async fetch(request) {
                const key = new URL(request.url).pathname
                if (request.method === 'PUT') {
                    objects.set(key, await request.arrayBuffer())
                    return new Response(null, { headers: { etag: '"stand-in"' } })
                }
                if (request.method === 'DELETE') {
                    objects.delete(key)
                    return new Response(null, { status: 204 })
                }
                const object = objects.get(key)
                if (object === undefined) return new Response(null, { status: 404 })
                return new Response(request.method === 'HEAD' ? null : object, {
                    headers: { 'content-length': String(object.byteLength) },
                })
            },
        })
        cleanups.push(() => s3.stop(true))

        const name = `postdot_multi_${crypto.randomUUID().replaceAll('-', '')}`
        const admin = new SQL(serverUrl!, { max: 1 })
        await admin.unsafe(`create database ${name}`)
        cleanups.push(async () => {
            await admin.unsafe(`drop database if exists ${name} with (force)`)
            await admin.close()
        })
        const databaseUrl = new URL(serverUrl!)
        databaseUrl.pathname = `/${name}`
        const directory = await mkdtemp(join(tmpdir(), 'postdot-multi-instance-'))
        cleanups.push(() => rm(directory, { recursive: true, force: true }))

        const start = (port: number) => {
            const origin = `http://localhost:${port}`
            const child = Bun.spawn([process.execPath, apiEntryPoint], {
                cwd: directory,
                env: {
                    PATH: process.env.PATH ?? '',
                    HOME: process.env.HOME ?? '',
                    TMPDIR: process.env.TMPDIR ?? '',
                    NODE_ENV: 'test',
                    PORT: String(port),
                    POSTDOT_DATABASE_URL: databaseUrl.toString(),
                    POSTDOT_MEDIA_STORE: 's3',
                    POSTDOT_MEDIA_STORE_ID: 'shared-media',
                    POSTDOT_MEDIA_S3_BUCKET: 'postdot',
                    POSTDOT_MEDIA_S3_REGION: 'us-east-1',
                    POSTDOT_MEDIA_S3_ENDPOINT: `http://localhost:${s3.port}`,
                    POSTDOT_MEDIA_S3_ACCESS_KEY_ID: 'stand-in',
                    POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY: 'stand-in-secret',
                    // Every server must share the instance secrets.
                    BETTER_AUTH_URL: origin,
                    POSTDOT_WEB_ORIGIN: webOrigin,
                    BETTER_AUTH_SECRET: 'postdot-isolated-multi-instance-auth-secret-32-chars',
                    POSTDOT_MEDIA_PUBLIC_URL_SECRET:
                        'postdot-isolated-multi-instance-media-secret-32-chars',
                    POSTDOT_PUBLISHER_ENCRYPTION_KEY: '56'.repeat(32),
                    LOG_ENABLED: 'false',
                },
                stdout: 'ignore',
                stderr: 'pipe',
            })
            cleanups.push(async () => {
                if (child.exitCode === null) child.kill('SIGKILL')
                await child.exited
            })
            return { origin, child }
        }

        const first = start(freePort())
        const leaderOf = (origin: string) =>
            waitFor(
                () => readiness(origin),
                ready => ready?.checks.topology?.role === 'leader' && ready.status === 'ready',
                30_000,
                `${origin} to lead`
            )
        expect((await leaderOf(first.origin))?.checks.topology?.instances).toBe('multiple')
        const second = start(freePort())
        const follower = await waitFor(
            () => readiness(second.origin),
            ready => ready?.status === 'ready',
            30_000,
            'the second server'
        )
        expect(follower?.checks.topology?.role).toBe('follower')

        // Sessions are database-backed: the first server's cookie works on the second.
        const signUp = await fetch(`${first.origin}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: webOrigin },
            body: JSON.stringify({
                email: 'owner@multi.local',
                name: 'Owner',
                password: 'correct-horse-battery-staple',
            }),
        })
        expect(signUp.status).toBe(200)
        const cookie = signUp.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ')
        const created = await fetch(`${first.origin}/api/projects`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: webOrigin, cookie },
            body: JSON.stringify({ name: 'Shared project' }),
        })
        expect(created.status).toBe(201)
        const { project } = (await created.json()) as { project: { id: string } }

        // A stream on the second server wakes for a change committed on the first,
        // well before its 15-second heartbeat would.
        const stream = await fetch(`${second.origin}/api/projects/${project.id}/events`, {
            headers: { cookie, accept: 'text/event-stream' },
        })
        expect(stream.status).toBe(200)
        const reader = stream.body!.getReader()
        cleanups.push(() => reader.cancel().catch(() => {}))
        const events = streamReader(reader)
        // Let the stream replay the journal and go quiet before the change.
        await events.drain(1_000)
        const changed = await fetch(`${first.origin}/api/projects/${project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', origin: webOrigin, cookie },
            body: JSON.stringify({ timeZone: 'Europe/Paris' }),
        })
        expect(changed.status).toBe(200)
        const startedAt = Date.now()
        await events.until(text => /^id: /m.test(text), 5_000)
        expect(Date.now() - startedAt).toBeLessThan(5_000)

        // The leader dies without draining: the follower takes over the runtimes.
        first.child.kill('SIGKILL')
        await first.child.exited
        expect((await leaderOf(second.origin))?.checks.topology?.role).toBe('leader')

        second.child.kill('SIGTERM')
        expect(await second.child.exited).toBe(0)
    },
    120_000
)
