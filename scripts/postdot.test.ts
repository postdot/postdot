import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { runCli } from './postdot'

function requestFromInput(input: string | URL | Request, init?: RequestInit) {
    return input instanceof Request ? new Request(input, init) : new Request(String(input), init)
}

describe('Postdot CLI', () => {
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
            ['projects', 'list', '--token', 'postdot_pat_machine-secret'],
            {},
            {
                fetcher: async (input, init) => {
                    requests.push(requestFromInput(input, init))
                    return Response.json({ projects: [{ id: 'project-1', name: 'Postdot' }] })
                },
                output: message => output.push(message),
            }
        )

        expect(requests[0]?.headers.get('authorization')).toEqual(
            'Bearer postdot_pat_machine-secret'
        )
        expect(requests[0]?.headers.get('cookie')).toBeNull()
        expect(output).toEqual(['project-1\tPostdot'])
    })

    it('creates a user-owned API key with a selected project scope', async () => {
        const output: string[] = []
        let request: Request | null = null

        await runCli(
            ['api-keys', 'create', '--name', 'MCP server', '--projects', 'project-1,project-2'],
            { POSTDOT_SESSION_COOKIE: 'better-auth.session_token=session' },
            {
                fetcher: async (input, init) => {
                    request = requestFromInput(input, init)
                    return Response.json({
                        key: {
                            id: 'key-1',
                            name: 'MCP server',
                            tokenPrefix: 'postdot_pat_abc',
                            projectAccess: ['project-1', 'project-2'],
                            expiresAt: null,
                            createdAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_000_000,
                        },
                        token: 'postdot_pat_secret',
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
        expect(output[0]).toContain('postdot_pat_secret')
    })
})

// This is the CLI process + real API/store contract, not a mocked provider journey.
describe('machine publication workflow', () => {
    it('creates two destinations, saves, promotes, reschedules, inspects and cancels through a real API key', async () => {
        const { createApp, createPublisherRuntime } = await import('../apps/api/src/index')
        const { createAuth } = await import('../packages/auth/src/index')
        const { closeDatabase, createDatabase, createMediaAssetStore, runMigrations } =
            await import('../packages/db/src/index')
        const { createPostdotClient } = await import('@postdot/client')
        const root = await mkdtemp(join(tmpdir(), 'postdot-cli-media-'))
        const { createLocalMediaStore } = await import('../packages/media/src/index')
        const { createMediaUrlImporter } = await import('../apps/api/src/modules/media/url-import')
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ZkAAAAASUVORK5CYII=',
            'base64'
        )
        const database = createDatabase(':memory:')
        await runMigrations(database)
        const publisher = createPublisherRuntime(database, {
            apiOrigin: 'http://localhost:3000',
            webOrigin: 'http://localhost:5173',
            publisherEncryptionKey: new Uint8Array(32).fill(7),
            publisherEncryptionKeyId: 'cli-test',
        })
        const media = createMediaAssetStore(
            database,
            createLocalMediaStore({
                rootDirectory: join(root, 'objects'),
                storeId: 'cli-test',
                maxObjectBytes: 2_000_000,
            })
        )
        const app = createApp({
            media,
            mediaUrlImporter: createMediaUrlImporter({
                media,
                fetcher: async () => ({
                    status: 200,
                    headers: { 'content-type': 'image/png' },
                    body: png,
                    bodyTruncated: false,
                }),
            }),
            database,
            publisher,
            auth: createAuth(database, {
                baseURL: 'http://localhost:3000',
                secret: 'postdot-cli-test-secret-at-least-32-characters',
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
                        email: 'cli@postdot.local',
                        name: 'CLI test',
                        password: 'correct-horse-battery-staple',
                    }),
                })
            )
            expect(signup.status).toBe(200)
            const cookie = signup.headers.get('set-cookie')?.split(';', 1)[0]
            const client = createPostdotClient(server.url.href, { cookie })
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
                        'scripts/postdot.ts',
                        ...args,
                        '--project',
                        project.id,
                        '--json',
                    ],
                    {
                        cwd: resolve(import.meta.dir, '..'),
                        env: {
                            ...Bun.env,
                            POSTDOT_URL: server.url.href,
                            POSTDOT_API_KEY: token,
                            POSTDOT_SESSION_COOKIE: '',
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
            const publisherRead = await command(['publishers', 'list'])
            expect(publisherRead.code).toBe(0)
            const publisherState = JSON.parse(publisherRead.stdout)
            const expectedPublishers = await client.api
                .projects({ projectId: project.id })
                .publishers.get()
            expect(expectedPublishers.error).toBeNull()
            expect(publisherState).toEqual(expectedPublishers.data)
            expect(publisherState.connections).toEqual([])
            expect(publisherState.oauthReadiness).toEqual({
                linkedin: 'not_configured',
                bluesky: 'not_configured',
                x: 'not_configured',
                facebook: 'not_configured',
                instagram: 'not_configured',
            })
            const connectionChannel = await client.api
                .projects({ projectId: project.id })
                .channels.post({
                    name: 'Connection inspection',
                    profile: 'linkedin',
                })
            expect(connectionChannel.error).toBeNull()
            const connectionChannelId = (connectionChannel.data as { channel: { id: string } })
                .channel.id
            const userId = (await signup.json()).user.id as string
            const connectedByActorId = database.$client
                .query<{ id: string }, [string, string]>(
                    'select id from actors where project_id = ? and subject_id = ?'
                )
                .get(project.id, userId)!.id
            const credential = await publisher.credentialStore.createPublisherCredential({
                projectId: project.id,
                connectedByActorId,
                providerId: 'linkedin',
                externalAccountId: 'cli-account',
                externalAccountName: 'CLI connection',
                scopes: ['w_member_social'],
                accessToken: 'FAKE_CLI_PUBLISHER_SECRET',
            })
            if (credential.kind !== 'created') throw new Error('Credential fixture failed')
            const connection = await publisher.publisherStore.createPublisherConnection({
                projectId: project.id,
                channelId: connectionChannelId,
                subjectId: userId,
                kind: 'linkedin',
                credentialId: credential.credential.id,
            })
            expect(connection.kind).toBe('created')
            const connectedRead = await command(['publishers', 'list'])
            expect(connectedRead.code).toBe(0)
            expect(JSON.parse(connectedRead.stdout).connections[0]).toMatchObject({
                channelId: connectionChannelId,
                state: 'active',
                externalAccountId: 'cli-account',
            })
            expect(connectedRead.stdout).not.toContain('FAKE_CLI_PUBLISHER_SECRET')
            const profileRead = await command(['channels', 'profile', '--channel', ids[0]!])
            expect(profileRead.code).toBe(0)
            const discovered = JSON.parse(profileRead.stdout)
            const expectedProfile = await client.api
                .projects({ projectId: project.id })
                .channels({ channelId: ids[0]! })
                .profile.get()
            expect(expectedProfile.error).toBeNull()
            expect(discovered).toEqual(expectedProfile.data)
            expect(discovered.channel.id).toBe(ids[0])
            expect(discovered.active.profile.capabilities).toBeDefined()
            const missingProfile = await command([
                'channels',
                'profile',
                '--channel',
                crypto.randomUUID(),
            ])
            expect(missingProfile.code).toBe(1)
            expect(JSON.parse(missingProfile.stderr).error.status).toBe(404)
            const filePath = join(root, 'fixture.png')
            await Bun.write(filePath, png)
            const upload = await command([
                'media',
                'upload',
                '--file',
                filePath,
                '--alt',
                'CLI image',
            ])
            expect(upload.code).toBe(0)
            expect(upload.stderr).toBe('')
            const uploaded = JSON.parse(upload.stdout)
            expect(uploaded.status).toBe('ready')
            expect(uploaded.media.asset.defaultAccessibilityText).toBe('CLI image')
            const assetId = uploaded.media.asset.id
            const content = await client.api
                .projects({ projectId: project.id })
                .media({ assetId })
                .content.get()
            expect(content.error).toBeNull()
            const rawContent = await fetch(
                `${server.url}api/projects/${project.id}/media/${assetId}/content`,
                { headers: { authorization: `Bearer ${token}` } }
            )
            const bytes = new Uint8Array(await rawContent.arrayBuffer())
            expect(bytes).toEqual(new Uint8Array(png))
            expect((await command(['media', 'show', '--asset', assetId])).code).toBe(0)
            const imported = await command([
                'media',
                'import-url',
                '--url',
                'https://images.example/fixture.png',
            ])
            expect(imported.code).toBe(0)
            expect(JSON.parse(imported.stdout).status).toBe('ready')
            const mediaList = await command(['media', 'list'])
            expect(JSON.parse(mediaList.stdout).total).toBe(2)
            const badFile = join(root, 'invalid.png')
            await Bun.write(badFile, 'not a PNG')
            const badUpload = await command(['media', 'upload', '--file', badFile])
            expect(badUpload.code).toBe(1)
            const failure = JSON.parse(badUpload.stderr).error
            expect(failure.code).toBe('media_inspection_failed')
            expect(failure.media.assetId).toBeString()
            expect(failure.media.intentId).toBeString()
            const finalize = await command([
                'media',
                'finalize',
                '--intent',
                failure.media.intentId,
            ])
            expect(finalize.code).toBe(1)
            expect(JSON.parse(finalize.stderr).error.code).toBe('media_inspection_failed')
            const result = await command(['posts', 'create', '--input', '-'], {
                title: 'Machine post',
                sourceContent: {
                    body: { text: 'Source', format: 'plain_text' },
                    media: [{ assetId }],
                },
                publications: ids.map(channelId => ({
                    channelId,
                    deliveryMode: 'manual',
                    targetContent: { body: 'Destination copy', media: [{ assetId }] },
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
            const machineClient = createPostdotClient(server.url.href, { token })
            const sourceRead = await machineClient.api
                .projects({ projectId: project.id })
                .posts({ postId: createdPost.post.id })
                .get()
            expect(sourceRead.error).toBeNull()
            const addition = await machineClient.api
                .projects({ projectId: project.id })
                .posts({ postId: createdPost.post.id })
                .destinations.post({
                    expectedSourceRevision: createdPost.post.sourceRevision,
                    confirmExistingChannels: true,
                    publications: [{ channelId: ids[0]!, deliveryMode: 'manual' }],
                })
            expect(addition.error).toBeNull()
            expect(addition.status).toBe(201)
            const staleAddition = await machineClient.api
                .projects({ projectId: project.id })
                .posts({ postId: createdPost.post.id })
                .destinations.post({
                    expectedSourceRevision: 999,
                    publications: [{ channelId: ids[0]!, deliveryMode: 'manual' }],
                })
            expect(staleAddition.status).toBe(409)
            const articleChannel = await client.api
                .projects({ projectId: project.id })
                .channels.post({ name: 'Article review', profile: 'devto' })
            expect(articleChannel.error).toBeNull()
            const articleAddition = await machineClient.api
                .projects({ projectId: project.id })
                .posts({ postId: createdPost.post.id })
                .destinations.post({
                    expectedSourceRevision: createdPost.post.sourceRevision,
                    publications: [
                        {
                            channelId: (articleChannel.data as { channel: { id: string } }).channel
                                .id,
                            deliveryMode: 'manual',
                        },
                    ],
                })
            expect(articleAddition.status).toBe(201)
            expect(
                (articleAddition.data as { publications: Array<{ reviewState: string }> })
                    .publications[0]!.reviewState
            ).toBe('review_required')
            const readKey = await client.api['api-keys'].post({
                name: 'Read only',
                projectIds: [project.id],
                actionAccess: ['project:read'],
            })
            expect(readKey.error).toBeNull()
            const reader = createPostdotClient(server.url.href, {
                token: (readKey.data as { token: string }).token,
            })
            expect(
                (
                    await reader.api
                        .projects({ projectId: project.id })
                        .posts({ postId: createdPost.post.id })
                        .get()
                ).status
            ).toBe(200)
            expect(
                (
                    await reader.api
                        .projects({ projectId: project.id })
                        .posts({ postId: createdPost.post.id })
                        .destinations.post({
                            expectedSourceRevision: createdPost.post.sourceRevision,
                            confirmExistingChannels: true,
                            publications: [{ channelId: ids[0]!, deliveryMode: 'manual' }],
                        })
                ).status
            ).toBe(403)
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
            const deniedPublishers = await command(['publishers', 'list'])
            expect(deniedPublishers.code).toBe(1)
            expect(JSON.parse(deniedPublishers.stderr).error.status).toBe(401)
            expect(deniedPublishers.stderr).not.toContain(token)
        } finally {
            await server.stop(true)
            closeDatabase(database)
            await rm(root, { recursive: true, force: true })
        }
    }, 30_000)

    it('rejects malformed and oversized inputs before sending a mutation', async () => {
        for (const input of ['{', '[]', 'null', 'x'.repeat(1_048_577)]) {
            let requests = 0
            await expect(
                runCli(
                    ['posts', 'create', '--project', 'p', '--input', '-'],
                    { POSTDOT_API_KEY: 'fake' },
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
            { POSTDOT_API_KEY: 'fake' },
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
                { POSTDOT_API_KEY: 'fake' },
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

describe('CLI pending media', () => {
    it('returns pending verification once without polling or treating it as ready', async () => {
        let requests = 0
        const output: string[] = []
        await runCli(
            ['media', 'finalize', '--project', 'p', '--intent', 'intent', '--json'],
            { POSTDOT_API_KEY: 'fake' },
            {
                fetcher: async () => {
                    requests++
                    return Response.json(
                        {
                            status: 'pending',
                            media: { asset: { id: 'asset' }, intent: { id: 'intent' } },
                        },
                        { status: 202 }
                    )
                },
                output: value => output.push(value),
            }
        )
        expect(requests).toBe(1)
        expect(JSON.parse(output[0]!)).toMatchObject({
            status: 'pending',
            media: { intent: { id: 'intent' } },
        })
    })
})

describe('CLI interrupted media transfer', () => {
    it('retains the reservation and never repeats the transfer or finalizes it', async () => {
        const root = await mkdtemp(join(tmpdir(), 'postdot-cli-transfer-'))
        const path = join(root, 'image.png')
        await Bun.write(path, new Uint8Array([1, 2, 3]))
        const requests: string[] = []
        try {
            await expect(
                runCli(
                    ['media', 'upload', '--project', 'p', '--file', path],
                    { POSTDOT_API_KEY: 'fake' },
                    {
                        fetcher: async (input, init) => {
                            const request = requestFromInput(input, init)
                            requests.push(request.method)
                            if (request.method === 'GET')
                                return Response.json({
                                    allowedContentTypes: ['image/png'],
                                    maxFileSize: 100,
                                })
                            if (request.method === 'POST')
                                return Response.json(
                                    { asset: { id: 'asset' }, intent: { id: 'intent' } },
                                    { status: 201 }
                                )
                            throw new Error('Connection lost after submission')
                        },
                    }
                )
            ).rejects.toMatchObject({
                code: 'transport_error',
                media: { assetId: 'asset', intentId: 'intent' },
            })
            expect(requests).toEqual(['GET', 'POST', 'PUT'])
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})

it('requires an explicit impact fingerprint and sends project retirement once through the typed client', async () => {
    const requests: Request[] = []
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
        const request = requestFromInput(input, init)
        requests.push(request)
        return Response.json({ state: 'deleted' })
    }
    await expect(
        runCli(
            [
                'projects',
                'delete',
                '--project',
                'project-1',
                '--confirm-name',
                'Disposable',
                '--token',
                'postdot_pat_test',
            ],
            {},
            { fetcher, output: () => {} }
        )
    ).rejects.toThrow('--fingerprint')
    expect(requests).toHaveLength(0)
    await runCli(
        [
            'projects',
            'delete',
            '--project',
            'project-1',
            '--fingerprint',
            'reviewed',
            '--confirm-name',
            'Disposable',
            '--cancel-pending',
            '--acknowledge-uncertain',
            '--token',
            'postdot_pat_test',
        ],
        {},
        { fetcher, output: () => {} }
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('DELETE')
    expect(new URL(requests[0]!.url).pathname).toBe('/api/projects/project-1/lifecycle')
    expect(await requests[0]!.json()).toMatchObject({
        fingerprint: 'reviewed',
        confirmName: 'Disposable',
        cancelPending: true,
        acknowledgeUncertain: true,
    })
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer postdot_pat_test')
})

describe('SPEC-012 admin parity in scripts/postdot.ts', () => {
    it('supports API-key authentication on api-keys and workspaces commands with capability validation', async () => {
        const requests: Array<{
            method: string
            path: string
            auth: string | null
            body: unknown
        }> = []
        const output: string[] = []
        const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
            const request = requestFromInput(input, init)
            const path = new URL(request.url).pathname
            const body =
                request.method === 'GET' || request.method === 'DELETE'
                    ? null
                    : await request
                          .clone()
                          .json()
                          .catch(() => null)
            requests.push({
                method: request.method,
                path,
                auth: request.headers.get('authorization'),
                body,
            })
            if (path === '/api/api-keys' && request.method === 'POST') {
                return Response.json(
                    {
                        key: {
                            id: 'key-2',
                            name: 'Delegated',
                            tokenPrefix: 'postdot_pat_del',
                            projectAccess: 'all',
                            actionAccess: ['api_key:manage', 'workspace:manage'],
                            expiresAt: null,
                            createdAt: 1,
                            updatedAt: 1,
                        },
                        token: 'postdot_pat_secret_2',
                    },
                    { status: 201 }
                )
            }
            if (path === '/api/api-keys/key-2' && request.method === 'PATCH') {
                return Response.json({
                    key: {
                        id: 'key-2',
                        name: 'Delegated v2',
                        tokenPrefix: 'postdot_pat_del',
                        projectAccess: 'all',
                        actionAccess: 'all',
                        expiresAt: null,
                        createdAt: 1,
                        updatedAt: 2,
                    },
                })
            }
            if (path === '/api/workspaces' && request.method === 'POST') {
                return Response.json({ workspace: { id: 'ws-2', name: 'Agency' } }, { status: 201 })
            }
            if (path === '/api/workspaces' && request.method === 'GET') {
                return Response.json({ workspaces: [{ id: 'ws-2', name: 'Agency' }] })
            }
            return Response.json({ deleted: true })
        }

        await expect(
            runCli(
                ['api-keys', 'create', '--actions', 'not:a_cap', '--token', 'postdot_pat_admin'],
                {},
                { fetcher }
            )
        ).rejects.toMatchObject({ exitCode: 2, code: 'invalid_input' })
        expect(requests).toHaveLength(0)

        await runCli(
            [
                'api-keys',
                'create',
                '--name',
                'Delegated',
                '--all-projects',
                '--actions',
                'api_key:manage,workspace:manage',
                '--token',
                'postdot_pat_admin',
            ],
            {},
            { fetcher, output: line => output.push(line) }
        )
        await runCli(
            [
                'api-keys',
                'update',
                '--key-id',
                'key-2',
                '--name',
                'Delegated v2',
                '--all-actions',
                '--no-expiry',
            ],
            { POSTDOT_API_KEY: 'postdot_pat_admin' },
            { fetcher, output: line => output.push(line) }
        )
        await runCli(
            ['workspaces', 'create', '--name', 'Agency', '--token', 'postdot_pat_admin'],
            {},
            { fetcher, output: line => output.push(line) }
        )
        await runCli(
            ['workspaces', 'list', '--token', 'postdot_pat_admin'],
            {},
            { fetcher, output: line => output.push(line) }
        )

        expect(requests).toEqual([
            {
                method: 'POST',
                path: '/api/api-keys',
                auth: 'Bearer postdot_pat_admin',
                body: {
                    name: 'Delegated',
                    projectIds: null,
                    actionAccess: ['api_key:manage', 'workspace:manage'],
                },
            },
            {
                method: 'PATCH',
                path: '/api/api-keys/key-2',
                auth: 'Bearer postdot_pat_admin',
                body: {
                    name: 'Delegated v2',
                    actionAccess: null,
                    expiresAt: null,
                },
            },
            {
                method: 'POST',
                path: '/api/workspaces',
                auth: 'Bearer postdot_pat_admin',
                body: { name: 'Agency' },
            },
            {
                method: 'GET',
                path: '/api/workspaces',
                auth: 'Bearer postdot_pat_admin',
                body: null,
            },
        ])
        expect(output[0]).toContain('postdot_pat_secret_2')
        expect(output[1]).toBe('Updated API key key-2.')
        expect(output[2]).toBe('Created workspace ws-2.')
        expect(output[3]).toBe('ws-2\tAgency')
    })

    it('supports instance status/bootstrap, access, and settings commands with file-based secrets', async () => {
        const root = await mkdtemp(join(tmpdir(), 'postdot-cli-admin-'))
        const bootstrapPath = join(root, 'bootstrap.token')
        const passwordPath = join(root, 'admin.pass')
        await Bun.write(bootstrapPath, 'boot-secret-123\n')
        await Bun.write(passwordPath, 'super-secret-password\n')

        const requests: Array<{
            method: string
            path: string
            auth: string | null
            bootstrapHeader: string | null
            body: unknown
        }> = []
        const output: string[] = []
        const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
            const request = requestFromInput(input, init)
            const path = new URL(request.url).pathname
            const body =
                request.method === 'GET' || request.method === 'DELETE'
                    ? null
                    : await request
                          .clone()
                          .json()
                          .catch(() => null)
            requests.push({
                method: request.method,
                path,
                auth: request.headers.get('authorization'),
                bootstrapHeader: request.headers.get('x-postdot-bootstrap-token'),
                body,
            })
            if (path === '/api/instance/status') {
                return Response.json({ setupAvailable: true, bootstrapMode: 'token' })
            }
            if (path === '/api/instance/bootstrap') {
                return Response.json(
                    {
                        user: { id: 'u1', email: 'admin@example.test' },
                        apiKey: {
                            key: { id: 'k1', name: 'Root CLI' },
                            token: 'postdot_pat_root',
                        },
                    },
                    { status: 201 }
                )
            }
            if (path === '/api/access/members' && request.method === 'POST') {
                return Response.json(
                    { membership: { userId: 'u2', role: 'member' } },
                    { status: 201 }
                )
            }
            if (path === '/api/access/invitations/inv-1' && request.method === 'DELETE') {
                return Response.json({ revoked: true })
            }
            if (path === '/api/settings/recovery/resume') {
                return Response.json({ resumed: true })
            }
            return Response.json({ ok: true })
        }

        try {
            await runCli(['instance', 'status'], {}, { fetcher, output: line => output.push(line) })
            await runCli(
                [
                    'instance',
                    'bootstrap',
                    '--name',
                    'Admin',
                    '--email',
                    'admin@example.test',
                    '--password-file',
                    passwordPath,
                    '--bootstrap-token-file',
                    bootstrapPath,
                    '--issue-api-key',
                    '--api-key-name',
                    'Root CLI',
                    '--actions',
                    'instance:admin,api_key:manage',
                ],
                {},
                { fetcher, output: line => output.push(line) }
            )
            await runCli(
                [
                    'access',
                    'members',
                    'create',
                    '--email',
                    'agent@example.test',
                    '--name',
                    'Agent',
                    '--no-default-workspace',
                    '--token',
                    'postdot_pat_root',
                ],
                {},
                { fetcher, output: line => output.push(line) }
            )
            await runCli(
                [
                    'access',
                    'invitations',
                    'revoke',
                    '--invitation',
                    'inv-1',
                    '--token',
                    'postdot_pat_root',
                ],
                {},
                { fetcher, output: line => output.push(line) }
            )
            await runCli(
                [
                    'settings',
                    'recovery',
                    'resume',
                    '--recovery-token',
                    'rec-123',
                    '--confirm',
                    '--token',
                    'postdot_pat_root',
                ],
                {},
                { fetcher, output: line => output.push(line) }
            )

            expect(requests).toEqual([
                {
                    method: 'GET',
                    path: '/api/instance/status',
                    auth: null,
                    bootstrapHeader: null,
                    body: null,
                },
                {
                    method: 'POST',
                    path: '/api/instance/bootstrap',
                    auth: null,
                    bootstrapHeader: 'boot-secret-123',
                    body: {
                        name: 'Admin',
                        email: 'admin@example.test',
                        password: 'super-secret-password',
                        apiKey: {
                            name: 'Root CLI',
                            actionAccess: ['instance:admin', 'api_key:manage'],
                        },
                    },
                },
                {
                    method: 'POST',
                    path: '/api/access/members',
                    auth: 'Bearer postdot_pat_root',
                    bootstrapHeader: null,
                    body: {
                        email: 'agent@example.test',
                        name: 'Agent',
                        joinDefaultWorkspace: false,
                    },
                },
                {
                    method: 'DELETE',
                    path: '/api/access/invitations/inv-1',
                    auth: 'Bearer postdot_pat_root',
                    bootstrapHeader: null,
                    body: null,
                },
                {
                    method: 'POST',
                    path: '/api/settings/recovery/resume',
                    auth: 'Bearer postdot_pat_root',
                    bootstrapHeader: null,
                    body: { token: 'rec-123', confirm: true },
                },
            ])
            expect(output[0]).toBe('Setup available: true (mode: token).')
            expect(output[1]).toContain('postdot_pat_root')
            expect(output[2]).toBe('Created member u2.')
            expect(output[3]).toBe('Revoked invitation inv-1.')
            expect(output[4]).toBe('Restore recovery hold cleared.')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})
