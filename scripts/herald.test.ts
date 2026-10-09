import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import { runCli } from './herald'

function requestFromInput(input: string | URL | Request, init?: RequestInit) {
    return input instanceof Request ? new Request(input, init) : new Request(String(input), init)
}

describe('Herald CLI', () => {
    it('documents user API keys and machine authentication', async () => {
        const output: string[] = []

        await runCli(['--help'], {}, { output: message => output.push(message) })

        expect(output[0]).toContain('api-keys create [--name <name>]')
        expect(output[0]).not.toContain('access-tokens')
        expect(output[0]).toContain('--token <value>')
    })

    it('uses a user API key for ordinary project operations', async () => {
        const requests: Request[] = []
        const output: string[] = []

        await runCli(
            ['projects', 'list', '--token', 'herald_pat_machine-secret'],
            {},
            {
                fetcher: async (input, init) => {
                    requests.push(requestFromInput(input, init))
                    return Response.json({ projects: [{ id: 'project-1', name: 'Herald' }] })
                },
                output: message => output.push(message),
            }
        )

        expect(requests[0]?.headers.get('authorization')).toEqual(
            'Bearer herald_pat_machine-secret'
        )
        expect(requests[0]?.headers.get('cookie')).toBeNull()
        expect(output).toEqual(['project-1\tHerald'])
    })

    it('creates a user-owned API key with a selected project scope', async () => {
        const output: string[] = []
        let request: Request | null = null

        await runCli(
            ['api-keys', 'create', '--name', 'MCP server', '--projects', 'project-1,project-2'],
            { HERALD_SESSION_COOKIE: 'better-auth.session_token=session' },
            {
                fetcher: async (input, init) => {
                    request = requestFromInput(input, init)
                    return Response.json({
                        key: {
                            id: 'key-1',
                            name: 'MCP server',
                            tokenPrefix: 'herald_pat_abc',
                            projectAccess: ['project-1', 'project-2'],
                            expiresAt: null,
                            createdAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_000_000,
                        },
                        token: 'herald_pat_secret',
                    })
                },
                output: message => output.push(message),
            }
        )

        const capturedRequest = request as Request | null
        if (!capturedRequest) throw new Error('The CLI did not issue an API-key request')
        expect(capturedRequest.url).toContain('/api/api-keys')
        expect(capturedRequest.headers.get('cookie')).toBe('better-auth.session_token=session')
        expect(await capturedRequest.clone().json()).toEqual({
            name: 'MCP server',
            projectIds: ['project-1', 'project-2'],
        })
        expect(output[0]).toContain('herald_pat_secret')
    })
})

// This is the CLI process + real API/store contract, not a mocked provider journey.
describe('machine publication workflow', () => {
    it('creates two destinations, saves, promotes, reschedules, inspects and cancels through a real API key', async () => {
        const { createApp, createPublisherRuntime } = await import('../apps/api/src/index')
        const { createAuth } = await import('../packages/auth/src/index')
        const { closeDatabase, createDatabase, runMigrations } =
            await import('../packages/db/src/index')
        const { createHeraldClient } = await import('@herald/client')
        const database = createDatabase(':memory:')
        runMigrations(database)
        const publisher = createPublisherRuntime(database, {
            apiOrigin: 'http://localhost:3000',
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey: new Uint8Array(32).fill(7),
            publisherEncryptionKeyId: 'cli-test',
        })
        const app = createApp({
            database,
            publisher,
            auth: createAuth(database, {
                baseURL: 'http://localhost:3000',
                secret: 'herald-cli-test-secret-at-least-32-characters',
            }),
        })
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: request => app.handle(request),
        })
        try {
            const signup = await app.handle(
                new Request('http://localhost:3000/api/auth/sign-up/email', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        origin: 'http://localhost:3000',
                    },
                    body: JSON.stringify({
                        email: 'cli@herald.local',
                        name: 'CLI test',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(signup.status).toBe(200)
            const cookie = signup.headers.get('set-cookie')?.split(';', 1)[0]
            const client = createHeraldClient(server.url.href, { cookie })
            const created = await client.api.projects.post({ name: 'CLI workflow' })
            expect(created.error).toBeNull()
            const { project } = created.data as { project: { id: string } }
            const channels = await Promise.all(
                ['First', 'Second'].map(name =>
                    client.api.projects({ projectId: project.id }).channels.post({ name })
                )
            )
            const ids = channels.map(result => {
                expect(result.error).toBeNull()
                return (result.data as { channel: { id: string } }).channel.id
            })
            const key = await client.api['api-keys'].post({ name: 'CLI', projectIds: [project.id] })
            expect(key.error).toBeNull()
            const { token } = key.data as { token: string }
            async function command(args: string[], input?: unknown) {
                const child = Bun.spawn(
                    [
                        process.execPath,
                        'scripts/herald.ts',
                        ...args,
                        '--project',
                        project.id,
                        '--json',
                    ],
                    {
                        cwd: resolve(import.meta.dir, '..'),
                        env: {
                            ...Bun.env,
                            HERALD_URL: server.url.href,
                            HERALD_API_KEY: token,
                            HERALD_SESSION_COOKIE: '',
                        },
                        stdin: input === undefined ? 'ignore' : new Blob([JSON.stringify(input)]),
                        stdout: 'pipe',
                        stderr: 'pipe',
                    }
                )
                const [stdout, stderr, code] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                    child.exited,
                ])
                return { stdout, stderr, code }
            }
            const result = await command(['posts', 'create', '--input', '-'], {
                title: 'Machine post',
                sourceContent: { body: { text: 'Source', format: 'plain_text' }, media: [] },
                publications: ids.map(channelId => ({
                    channelId,
                    deliveryMode: 'manual',
                    targetContent: { body: 'Destination copy', media: [] },
                })),
            })
            expect(result.stderr).toBe('')
            expect(result.code).toBe(0)
            const createdPost = JSON.parse(result.stdout)
            expect(createdPost.publications).toHaveLength(2)
            const publicationId = createdPost.publications[0].id
            const show = await command(['publications', 'show', '--publication', publicationId])
            expect(show.code).toBe(0)
            const editor = JSON.parse(show.stdout).editor
            const save = await command(
                ['publications', 'save', '--publication', publicationId, '--input', '-'],
                {
                    expectedRevision: editor.draft.revision,
                    targetContent: { body: 'Revised destination', media: [] },
                }
            )
            expect(save.code).toBe(0)
            const revision = JSON.parse(save.stdout).editor.draft.revision
            const at = Date.now() + 3_600_000
            expect(
                (
                    await command([
                        'publications',
                        'promote',
                        '--publication',
                        publicationId,
                        '--expected-revision',
                        String(revision),
                        '--at',
                        String(at),
                    ])
                ).code
            ).toBe(0)
            expect(
                (
                    await command([
                        'publications',
                        'schedule',
                        '--publications',
                        publicationId,
                        '--at',
                        String(at + 1000),
                    ])
                ).code
            ).toBe(0)
            const listed = await command(['publications', 'list'])
            expect(listed.code).toBe(0)
            expect(JSON.parse(listed.stdout).publications).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: publicationId })])
            )
            expect(
                (await command(['publications', 'cancel', '--publications', publicationId])).code
            ).toBe(0)
            const cancelled = await command([
                'publications',
                'show',
                '--publication',
                publicationId,
            ])
            expect(JSON.parse(cancelled.stdout).editor.publication.state).toBe('cancelled')
            const retry = await command(['publications', 'retry', '--publication', publicationId])
            expect(retry.code).toBe(1)
            expect(retry.stdout).toBe('')
            expect(JSON.parse(retry.stderr).error.status).toBe(409)
            const invalid = await command(['posts', 'create', '--input', '-'], { publications: [] })
            expect(invalid.code).toBe(1)
            expect(JSON.parse(invalid.stderr).error.status).toBe(422)
            const revoked = await client.api['api-keys']({
                keyId: (key.data as { key: { id: string } }).key.id,
            }).delete()
            expect(revoked.error).toBeNull()
            const denied = await command(['publications', 'list'])
            expect(denied.code).toBe(1)
            expect(JSON.parse(denied.stderr).error.status).toBe(401)
            expect(denied.stderr).not.toContain(token)
        } finally {
            await server.stop(true)
            closeDatabase(database)
        }
    }, 30_000)

    it('rejects malformed and oversized inputs before sending a mutation', async () => {
        for (const input of ['{', '[]', 'null', 'x'.repeat(1_048_577)]) {
            let requests = 0
            await expect(
                runCli(
                    ['posts', 'create', '--project', 'p', '--input', '-'],
                    { HERALD_API_KEY: 'fake' },
                    {
                        readInput: async () => input,
                        fetcher: async () => {
                            requests++
                            return Response.json({})
                        },
                    }
                )
            ).rejects.toMatchObject({ exitCode: 2, code: 'invalid_input' })
            expect(requests).toBe(0)
        }
    })
})

describe('CLI lifecycle transport', () => {
    it('forwards retry once and retains the server response', async () => {
        let requests = 0
        const output: string[] = []
        await runCli(
            ['publications', 'retry', '--project', 'p', '--publication', 'pub', '--json'],
            { HERALD_API_KEY: 'fake' },
            {
                fetcher: async (input, init) => {
                    const request = requestFromInput(input, init)
                    expect(request.url).toEndWith('/api/projects/p/publications/pub/retry')
                    expect(request.method).toBe('POST')
                    requests++
                    return Response.json({ publication: { id: 'pub', state: 'scheduled' } })
                },
                output: value => output.push(value),
            }
        )
        expect(requests).toBe(1)
        expect(JSON.parse(output[0]!)).toEqual({ publication: { id: 'pub', state: 'scheduled' } })
    })

    it('never automatically repeats a write after a transport failure', async () => {
        let requests = 0
        await expect(
            runCli(
                ['publications', 'retry', '--project', 'p', '--publication', 'pub'],
                { HERALD_API_KEY: 'fake' },
                {
                    fetcher: async () => {
                        requests++
                        throw new Error('connection lost')
                    },
                }
            )
        ).rejects.toMatchObject({ code: 'transport_error', exitCode: 1 })
        expect(requests).toBe(1)
    })
})
