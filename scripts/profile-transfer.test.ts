import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQL } from 'bun'

/**
 * Moving an installation between storage profiles with the shipped commands
 * (ADR-097 §8): SQLite with local media to PostgreSQL with S3 and back, each
 * time starting a server on the result and reading the same account, session,
 * project and media. Runs when `POSTDOT_TEST_POSTGRES_URL` names a server where
 * the test may create a disposable database. An in-process stand-in answers
 * the S3 protocol.
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

// A 1x1 PNG.
const avatar = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64'
    )
)

test.skipIf(serverUrl === undefined)(
    'an installation moves from SQLite and local media to PostgreSQL and S3, and back',
    async () => {
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
                    headers: {
                        'content-length': String(object.byteLength),
                        'last-modified': new Date().toUTCString(),
                    },
                })
            },
        })
        cleanups.push(() => s3.stop(true))

        const name = `postdot_transfer_${crypto.randomUUID().replaceAll('-', '')}`
        const admin = new SQL(serverUrl!, { max: 1 })
        await admin.unsafe(`create database ${name}`)
        cleanups.push(async () => {
            await admin.unsafe(`drop database if exists ${name} with (force)`)
            await admin.close()
        })
        const databaseUrl = new URL(serverUrl!)
        databaseUrl.pathname = `/${name}`
        const directory = await mkdtemp(join(tmpdir(), 'postdot-profile-transfer-'))
        cleanups.push(() => rm(directory, { recursive: true, force: true }))

        const secrets = {
            BETTER_AUTH_SECRET: 'postdot-isolated-transfer-test-auth-secret-32-characters',
            POSTDOT_MEDIA_PUBLIC_URL_SECRET: 'postdot-isolated-transfer-test-media-secret-32-chars',
            POSTDOT_PUBLISHER_ENCRYPTION_KEY: '78'.repeat(32),
        }
        const base = {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            TMPDIR: process.env.TMPDIR ?? '',
            NODE_ENV: 'test',
            LOG_ENABLED: 'false',
            POSTDOT_WEB_ORIGIN: webOrigin,
            ...secrets,
        }
        const s3Media = (prefix: string) => ({
            [`${prefix}POSTDOT_MEDIA_STORE`]: 's3',
            [`${prefix}POSTDOT_MEDIA_STORE_ID`]: 'shared-media',
            [`${prefix}POSTDOT_MEDIA_S3_BUCKET`]: 'postdot',
            [`${prefix}POSTDOT_MEDIA_S3_REGION`]: 'us-east-1',
            [`${prefix}POSTDOT_MEDIA_S3_ENDPOINT`]: `http://localhost:${s3.port}`,
            [`${prefix}POSTDOT_MEDIA_S3_ACCESS_KEY_ID`]: 'stand-in',
            [`${prefix}POSTDOT_MEDIA_S3_SECRET_ACCESS_KEY`]: 'stand-in-secret',
        })
        const sqliteProfile = {
            DB_FILE_NAME: join(directory, 'postdot.sqlite'),
            POSTDOT_MEDIA_DIRECTORY: join(directory, 'media'),
        }
        const postgresProfile = {
            // The image always sets DB_FILE_NAME; the PostgreSQL URL takes precedence.
            DB_FILE_NAME: join(directory, 'unused.sqlite'),
            POSTDOT_DATABASE_URL: databaseUrl.toString(),
            ...s3Media(''),
        }
        const returnedProfile = {
            DB_FILE_NAME: join(directory, 'returned.sqlite'),
            POSTDOT_MEDIA_DIRECTORY: join(directory, 'returned-media'),
            POSTDOT_MEDIA_STORE_ID: 'local-returned',
        }

        const command = async (args: string[], profile: Record<string, string>) => {
            const child = Bun.spawn([process.execPath, apiEntryPoint, ...args], {
                cwd: directory,
                env: { ...base, ...profile },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ])
            return { stdout, stderr, exitCode }
        }
        const succeed = async (args: string[], profile: Record<string, string>) => {
            const result = await command(args, profile)
            if (result.exitCode !== 0) {
                throw new Error(`${args.join(' ')} failed: ${result.stderr}${result.stdout}`)
            }
            return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, unknown>
        }
        const serve = async (profile: Record<string, string>) => {
            const port = freePort()
            const origin = `http://localhost:${port}`
            const child = Bun.spawn([process.execPath, apiEntryPoint], {
                cwd: directory,
                env: { ...base, ...profile, PORT: String(port), BETTER_AUTH_URL: origin },
                stdout: 'ignore',
                stderr: 'pipe',
            })
            cleanups.push(async () => {
                if (child.exitCode === null) child.kill('SIGKILL')
                await child.exited
            })
            const deadline = Date.now() + 30_000
            for (;;) {
                if (child.exitCode !== null) {
                    throw new Error(`The server exited: ${await new Response(child.stderr).text()}`)
                }
                const ready = await fetch(`${origin}/ready`).then(
                    response => response.status === 200,
                    () => false
                )
                if (ready) break
                if (Date.now() > deadline) throw new Error('The server did not become ready')
                await Bun.sleep(100)
            }
            return {
                origin,
                async stop() {
                    child.kill('SIGTERM')
                    expect(await child.exited).toBe(0)
                },
            }
        }

        // An installation on SQLite with local media: an account, a project, an avatar.
        const first = await serve(sqliteProfile)
        const signUp = await fetch(`${first.origin}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: webOrigin },
            body: JSON.stringify({
                email: 'owner@transfer.local',
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
            body: JSON.stringify({ name: 'Moved project' }),
        })
        expect(created.status).toBe(201)
        const uploaded = await fetch(`${first.origin}/api/account/avatar`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', origin: webOrigin, cookie },
            body: avatar,
        })
        expect(uploaded.status).toBe(200)
        const { image } = (await uploaded.json()) as { image: string }

        const expectInstallation = async (origin: string) => {
            // The session cookie from the first server still authenticates.
            const projects = await fetch(`${origin}/api/projects`, { headers: { cookie } })
            expect(projects.status).toBe(200)
            expect(JSON.stringify(await projects.json())).toContain('Moved project')
            const picture = await fetch(`${origin}${image}`, { headers: { cookie } })
            expect(picture.status).toBe(200)
            expect(new Uint8Array(await picture.arrayBuffer())).toEqual(avatar)
        }
        await expectInstallation(first.origin)

        // Transfers refuse to run beside a server.
        const refused = await command(
            ['export', '--output', join(directory, 'refused')],
            sqliteProfile
        )
        expect(refused.exitCode).not.toBe(0)
        expect(refused.stderr).toContain('runtime lock')
        await first.stop()

        // SQLite and local media -> PostgreSQL and S3.
        expect(
            await succeed(['export', '--output', join(directory, 'to-postgres')], sqliteProfile)
        ).toMatchObject({ engine: 'sqlite' })
        expect(
            await succeed(['import', '--input', join(directory, 'to-postgres')], postgresProfile)
        ).toMatchObject({ engine: 'postgres', from: 'sqlite' })
        const toS3 = await succeed(['media', 'transfer'], {
            ...postgresProfile,
            SOURCE_POSTDOT_MEDIA_STORE: 'local',
            SOURCE_POSTDOT_MEDIA_STORE_ID: 'local-default',
            SOURCE_POSTDOT_MEDIA_DIRECTORY: sqliteProfile.POSTDOT_MEDIA_DIRECTORY,
        })
        expect(toS3).toMatchObject({ from: 'local-default', to: 'shared-media', copied: 1 })
        const second = await serve(postgresProfile)
        await expectInstallation(second.origin)
        const busy = await command(['export', '--output', join(directory, 'busy')], postgresProfile)
        expect(busy.exitCode).not.toBe(0)
        expect(busy.stderr).toContain('server is running')
        await second.stop()

        // PostgreSQL and S3 -> SQLite and local media.
        expect(
            await succeed(['export', '--output', join(directory, 'to-sqlite')], postgresProfile)
        ).toMatchObject({ engine: 'postgres' })
        expect(
            await succeed(['import', '--input', join(directory, 'to-sqlite')], returnedProfile)
        ).toMatchObject({ engine: 'sqlite', from: 'postgres' })
        expect(
            await succeed(['media', 'transfer'], { ...returnedProfile, ...s3Media('SOURCE_') })
        ).toMatchObject({ from: 'shared-media', to: 'local-returned', copied: 1 })
        const third = await serve(returnedProfile)
        await expectInstallation(third.origin)
        await third.stop()
    },
    120_000
)
