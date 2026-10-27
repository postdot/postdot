import { expect, it } from 'bun:test'

import { createApp, createPublisherRuntime } from '../apps/api/src/index'
import { createAuth } from '../packages/auth/src/index'
import {
    createAccessStore,
    createDatabase,
    closeDatabase,
    runMigrations,
} from '../packages/db/src/index'
import { runCli } from './postdot'

it('runs sharing, transfer, cadence, scoped reads and explicit moves through the CLI process and real API', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database)
    const origin = 'http://localhost:3000'
    const app = createApp({
        database,
        access,
        auth: createAuth(database, {
            baseURL: origin,
            secret: 'cli-sharing-secret-over-thirty-two-characters',
            access,
        }),
        publisher: createPublisherRuntime(database, {
            apiOrigin: origin,
            webOrigin: origin,
            publisherEncryptionKey: new Uint8Array(32).fill(7),
            publisherEncryptionKeyId: 'cli-sharing',
        }),
    })
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: request => app.handle(request),
    })
    let cookie = ''
    const request = async (path: string, body?: unknown) => {
        const response = await app.handle(
            new Request(origin + path, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { origin, cookie, 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
        expect(response.ok).toBe(true)
        return { response, body: (await response.json()) as any }
    }
    let token = ''
    const command = async (args: string[], input?: unknown, json = true) => {
        const child = Bun.spawn(
            [process.execPath, 'scripts/postdot.ts', ...args, ...(json ? ['--json'] : [])],
            {
                cwd: new URL('..', import.meta.url).pathname,
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
        return {
            code,
            value: json ? (JSON.parse(code === 0 ? stdout : stderr) as any) : undefined,
            stderr,
        }
    }
    try {
        const signup = await request('/api/auth/sign-up/email', {
            name: 'CLI sharing',
            email: 'cli-sharing@example.test',
            password: 'cli-sharing-password-123',
        })
        cookie = signup.response.headers.get('set-cookie')!.split(';', 1)[0]!
        const source = (await request('/api/projects', { name: 'Source' })).body.project
        const target = (
            await request('/api/projects', { name: 'Target', workspaceId: source.workspaceId })
        ).body.project
        const channel = (
            await request(`/api/projects/${source.id}/channels`, { name: 'Shared newsroom' })
        ).body.channel
        const replacement = (
            await request(`/api/projects/${source.id}/channels`, { name: 'Replacement' })
        ).body.channel
        token = (
            await request('/api/api-keys', {
                name: 'Both projects',
                projectIds: [source.id, target.id],
            })
        ).body.token
        const base = ['--project', source.id, '--channel', channel.id]
        const workspaceBase = ['--workspace', source.workspaceId, '--channel', channel.id]
        const sharing = await command(['channels', 'sharing', ...base])
        expect(sharing.code).toBe(0)
        const revision = sharing.value.channel.revision
        expect(
            (
                await command([
                    'channels',
                    'attach',
                    ...base,
                    '--target-project',
                    target.id,
                    '--expected-revision',
                    String(revision),
                ])
            ).code
        ).toBe(0)
        const stale = await command([
            'channels',
            'transfer',
            ...workspaceBase,
            '--target-project',
            target.id,
            '--expected-revision',
            String(revision),
        ])
        expect(stale).toMatchObject({
            code: 1,
            value: { error: { code: 'stale_revision', status: 409 } },
        })
        expect(
            (
                await command([
                    'channels',
                    'transfer',
                    ...workspaceBase,
                    '--target-project',
                    target.id,
                    '--expected-revision',
                    String(revision + 1),
                ])
            ).code
        ).toBe(0)
        const retainedManagement = await command(
            ['channels', 'configure-cadence', ...base, '--input', '-'],
            { expectedRevision: 0, dailyMax: 1, weeklyMax: null, minimumIntervalMs: null }
        )
        // A key retaining both live project grants can manage through the new manager.
        expect(retainedManagement.code).toBe(0)
        const rules = await command(['channels', 'cadence', ...workspaceBase])
        expect(rules.value.rules).toMatchObject({ revision: 1, dailyMax: 1 })
        const scopedToken = (
            await request('/api/api-keys', {
                name: 'Only source',
                projectIds: [source.id],
                actionAccess: ['project:read', 'channel:manage', 'channel:share'],
            })
        ).body.token
        const broadToken = token
        token = scopedToken
        const scoped = await command(['channels', 'list', '--workspace', source.workspaceId])
        expect(scoped.code).toBe(0)
        expect(JSON.stringify(scoped.value)).not.toContain(target.id)
        expect(
            (
                await command(['channels', 'configure-cadence', ...base, '--input', '-'], {
                    expectedRevision: 1,
                    dailyMax: 2,
                    weeklyMax: null,
                    minimumIntervalMs: null,
                })
            ).code
        ).toBe(1)
        token = broadToken
        const at = Date.now() + 86400000
        const postInput = {
            sourceContent: { body: { format: 'plain_text', text: 'CLI move content' }, media: [] },
            publications: [{ channelId: channel.id, deliveryMode: 'manual', scheduledAt: at }],
        }
        const first = await command(
            ['posts', 'create', '--project', source.id, '--input', '-'],
            postInput
        )
        expect(first.code).toBe(0)
        const conflict = await command(
            ['posts', 'create', '--project', source.id, '--input', '-'],
            postInput
        )
        expect(conflict).toMatchObject({
            code: 1,
            value: {
                error: {
                    code: 'cadence_conflict',
                    status: 409,
                    warnings: [{ channelId: channel.id, rule: 'daily_max', maximum: 1, count: 2 }],
                },
            },
        })
        expect(conflict.value.error.confirmation).toHaveLength(64)
        const humanConflict = await command(
            ['posts', 'create', '--project', source.id, '--input', '-'],
            postInput,
            false
        )
        expect(humanConflict.code).toBe(1)
        expect(humanConflict.stderr).toContain('Cadence warnings:')
        expect(humanConflict.stderr).toContain(conflict.value.error.confirmation)
        expect(database.$client.query('select count(*) as count from posts').get()).toEqual({
            count: 1,
        })
        const confirmed = await command(
            ['posts', 'create', '--project', source.id, '--input', '-'],
            { ...postInput, cadenceConfirmation: conflict.value.error.confirmation }
        )
        expect(confirmed.code).toBe(0)
        const original = first.value.publications[0]
        const editor = (
            await command([
                'publications',
                'show',
                '--project',
                source.id,
                '--publication',
                original.id,
            ])
        ).value.editor
        const move = {
            targetChannelId: replacement.id,
            deliveryMode: 'manual',
            expectedPublicationUpdatedAt: editor.publication.updatedAt,
            expectedDraftRevision: editor.draft.revision,
            expectedSourceRevision: editor.post.sourceRevision,
            expectedTargetRevisionId: editor.publication.targetRevisionId,
            expectedScheduledAt: editor.publication.scheduledAt,
            expectedTargetProfileVersionId: replacement.profileVersionId,
        }
        const moved = await command(
            [
                'publications',
                'move',
                '--project',
                source.id,
                '--publication',
                original.id,
                '--input',
                '-',
            ],
            move
        )
        expect(moved.code).toBe(0)
        expect(moved.value.editor.publication).toMatchObject({
            postId: original.postId,
            channelId: replacement.id,
            scheduledAt: at,
        })
        expect(moved.value.editor.movement.fromPublicationId).toBe(original.id)
        expect(
            (
                await command(
                    [
                        'publications',
                        'move',
                        '--project',
                        source.id,
                        '--publication',
                        original.id,
                        '--input',
                        '-',
                    ],
                    move
                )
            ).value.error.code
        ).toBe('write_conflict')
        expect(
            (
                await command([
                    'publications',
                    'cadence',
                    '--project',
                    source.id,
                    '--publication',
                    moved.value.editor.publication.id,
                ])
            ).value
        ).toBeNull()
        expect(
            (
                await command([
                    'channels',
                    'occupancy',
                    '--project',
                    source.id,
                    '--from',
                    String(at - 1),
                    '--to',
                    String(at + 1),
                ])
            ).code
        ).toBe(0)
        const current = await command(['channels', 'sharing', ...base])
        expect(
            (
                await command([
                    'channels',
                    'withdraw',
                    ...workspaceBase,
                    '--target-project',
                    target.id,
                    '--expected-revision',
                    String(current.value.channel.revision),
                ])
            ).code
        ).toBe(0)
    } finally {
        await server.stop(true)
        closeDatabase(database)
    }
}, 30000)

it('rejects ambiguous context and missing revisions before sending a request', async () => {
    let requests = 0
    const dependencies = {
        fetcher: async () => {
            requests++
            return Response.json({})
        },
        output: () => {},
    }
    await expect(
        runCli(
            ['channels', 'list', '--project', 'p', '--workspace', 'w'],
            { POSTDOT_API_KEY: 'fake' },
            dependencies
        )
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
        runCli(
            ['channels', 'attach', '--project', 'p', '--channel', 'c', '--target-project', 'q'],
            { POSTDOT_API_KEY: 'fake' },
            dependencies
        )
    ).rejects.toThrow('--expected-revision')
    expect(requests).toBe(0)
})

for (const context of ['project', 'workspace'] as const) {
    for (const action of ['attach', 'transfer', 'withdraw', 'configure-cadence'] as const) {
        it(`sends one revision-bound ${context} ${action} request without hidden reads`, async () => {
            const requests: Request[] = []
            const input = {
                expectedRevision: 0,
                dailyMax: null,
                weeklyMax: null,
                minimumIntervalMs: null,
            }
            await runCli(
                [
                    'channels',
                    action,
                    `--${context}`,
                    'context',
                    '--channel',
                    'channel',
                    ...(action === 'configure-cadence'
                        ? ['--input', '-']
                        : [
                              '--target-project',
                              'target',
                              '--expected-revision',
                              '7',
                              '--archive-last',
                          ]),
                ],
                { POSTDOT_API_KEY: 'fake' },
                {
                    readInput: async () => JSON.stringify(input),
                    output: () => {},
                    fetcher: async (url, init) => {
                        const request = new Request(String(url), init)
                        requests.push(request)
                        return Response.json({ result: 'updated' })
                    },
                }
            )
            expect(requests).toHaveLength(1)
            const request = requests[0]!
            const prefix = `/api/${context === 'project' ? 'projects' : 'workspaces'}/context/channels/channel`
            const suffix =
                action === 'attach'
                    ? '/attachments'
                    : action === 'transfer'
                      ? '/management'
                      : action === 'configure-cadence'
                        ? '/cadence'
                        : context === 'workspace'
                          ? '/withdraw'
                          : '/attachments/target/withdraw'
            expect(new URL(request.url).pathname).toBe(prefix + suffix)
            expect(request.method).toBe(action === 'configure-cadence' ? 'PUT' : 'POST')
            expect(await request.json()).toEqual(
                action === 'configure-cadence'
                    ? input
                    : action === 'withdraw'
                      ? {
                            expectedRevision: 7,
                            lastAttachment: 'archive',
                            ...(context === 'workspace' ? { projectId: 'target' } : {}),
                        }
                      : { expectedRevision: 7, projectId: 'target' }
            )
            expect(request.headers.get('authorization')).toBe('Bearer fake')
        })
    }
}

for (const action of ['promote', 'schedule', 'retry', 'override-cadence'] as const) {
    it(`forwards explicit ${action} confirmation once and never confirms a fresh conflict`, async () => {
        const confirmation = 'a'.repeat(64)
        const requests: Request[] = []
        const warnings = [
            { channelId: 'channel', rule: 'daily_max', period: '2026-10-28', maximum: 1, count: 2 },
        ]
        await expect(
            runCli(
                [
                    'publications',
                    action,
                    '--project',
                    'project',
                    '--publication',
                    'pub',
                    '--publications',
                    'pub',
                    '--at',
                    '1800000000000',
                    '--expected-revision',
                    '1',
                    action === 'override-cadence' ? '--confirmation' : '--cadence-confirmation',
                    confirmation,
                ],
                { POSTDOT_API_KEY: 'fake' },
                {
                    output: () => {},
                    fetcher: async (url, init) => {
                        requests.push(new Request(String(url), init))
                        return Response.json(
                            {
                                error: {
                                    code: 'cadence_conflict',
                                    message: 'Review updated limits',
                                    confirmation: 'b'.repeat(64),
                                    warnings: warnings.map(warning => ({
                                        ...warning,
                                        secret: 'must-not-echo',
                                    })),
                                    secret: 'must-not-echo',
                                },
                            },
                            { status: 409 }
                        )
                    },
                }
            )
        ).rejects.toMatchObject({
            code: 'cadence_conflict',
            status: 409,
            cadence: { confirmation: 'b'.repeat(64), warnings },
        })
        expect(requests).toHaveLength(1)
        expect(await requests[0]!.json()).toMatchObject({
            [action === 'override-cadence' ? 'confirmation' : 'cadenceConfirmation']: confirmation,
        })
    })
}

it('does not expose unknown error metadata as cadence instructions', async () => {
    await expect(
        runCli(
            ['publications', 'retry', '--project', 'p', '--publication', 'pub'],
            { POSTDOT_API_KEY: 'fake' },
            {
                fetcher: async () =>
                    Response.json(
                        {
                            error: {
                                code: 'not_found',
                                message: 'Unavailable',
                                confirmation: 'a'.repeat(64),
                                warnings: [],
                                secret: 'must-not-echo',
                            },
                        },
                        { status: 404 }
                    ),
            }
        )
    ).rejects.toMatchObject({ code: 'not_found', status: 404, cadence: undefined })
})
