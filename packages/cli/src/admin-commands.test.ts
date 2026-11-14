import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { completionCandidates } from './completion'
import { createProgram } from './program'

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

async function withMockServer<T>(
    handler: (request: Request, url: URL) => Response | Promise<Response>,
    fn: (origin: string) => Promise<T>
) {
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            return handler(request, new URL(request.url))
        },
    })
    try {
        return await fn(server.url.origin)
    } finally {
        server.stop(true)
    }
}

test('completes SPEC-012 administrative commands and validates capabilities before HTTP calls', async () => {
    const program = createProgram({ jsonErrors: true })
    expect(completionCandidates(program, ['postdot', 'ins'], 1)).toEqual(['instance'])
    expect(completionCandidates(program, ['postdot', 'instance', ''], 2)).toEqual([
        'bootstrap',
        'help',
        'status',
    ])
    expect(completionCandidates(program, ['postdot', 'access', ''], 2)).toEqual([
        'help',
        'invitations',
        'members',
        'summary',
    ])
    expect(completionCandidates(program, ['postdot', 'settings', ''], 2)).toEqual([
        'email',
        'help',
        'provider-applications',
        'recovery',
    ])

    await expect(
        program.parseAsync(
            ['api-keys', 'create', '--name', 'Invalid', '--actions', 'project:read,not:real'],
            { from: 'user' }
        )
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' })
})

async function captureStdout(run: () => Promise<unknown>): Promise<string> {
    let buffer = ''
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
        buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        return true
    }) as typeof process.stdout.write
    try {
        await run()
        return buffer
    } finally {
        process.stdout.write = original
    }
}

test('instance bootstrap reads secrets from files cleanly and sends X-Postdot-Bootstrap-Token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postdot-cli-admin-'))
    const configDir = join(dir, 'config')
    const tokenFile = join(dir, 'bootstrap-token')
    const passwordFile = join(dir, 'admin-password')
    writeFileSync(tokenFile, '  bootstrap-secret-123  \n')
    writeFileSync(passwordFile, 'admin-password-with-length\n')

    const seen: Array<{ path: string; header: string | null; body: unknown }> = []
    try {
        await withMockServer(
            async (request, url) => {
                if (url.pathname === '/api/instance/status') {
                    return jsonResponse({ setupAvailable: true, bootstrapMode: 'token_required' })
                }
                if (url.pathname === '/api/instance/bootstrap') {
                    seen.push({
                        path: url.pathname,
                        header: request.headers.get('x-postdot-bootstrap-token'),
                        body: await request.json(),
                    })
                    return jsonResponse(
                        {
                            user: {
                                id: 'user-1',
                                email: 'dot@postdot.local',
                                name: 'Dot Agent',
                            },
                            instance: {
                                id: 'default',
                                state: 'claimed',
                                claimedByUserId: 'user-1',
                                claimedAt: 1_800_000_000_000,
                                updatedAt: 1_800_000_000_000,
                            },
                            apiKey: {
                                key: {
                                    id: 'key-1',
                                    name: 'Bootstrap Key',
                                    tokenPrefix: 'postdot_pat_boot',
                                    projectAccess: 'all',
                                    actionAccess: ['project:read', 'instance:admin'],
                                    expiresAt: null,
                                    createdAt: 1_800_000_000_000,
                                    updatedAt: 1_800_000_000_000,
                                },
                                token: 'postdot_pat_boot_secret',
                            },
                        },
                        201
                    )
                }
                return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
            },
            async origin => {
                const statusOut = await captureStdout(() =>
                    createProgram({ jsonErrors: true }).parseAsync(
                        [
                            '--config-dir',
                            configDir,
                            '--base-url',
                            origin,
                            '--json',
                            'instance',
                            'status',
                        ],
                        { from: 'user' }
                    )
                )
                expect(JSON.parse(statusOut)).toEqual({
                    setupAvailable: true,
                    bootstrapMode: 'token_required',
                })

                const bootOut = await captureStdout(() =>
                    createProgram({ jsonErrors: true }).parseAsync(
                        [
                            '--config-dir',
                            configDir,
                            '--base-url',
                            origin,
                            '--json',
                            'instance',
                            'bootstrap',
                            '--name',
                            'Dot Agent',
                            '--email',
                            'dot@postdot.local',
                            '--password-file',
                            passwordFile,
                            '--bootstrap-token-file',
                            tokenFile,
                            '--issue-api-key',
                            '--api-key-name',
                            'Bootstrap Key',
                            '--actions',
                            'project:read,instance:admin',
                        ],
                        { from: 'user' }
                    )
                )
                expect(seen).toEqual([
                    {
                        path: '/api/instance/bootstrap',
                        header: 'bootstrap-secret-123',
                        body: {
                            name: 'Dot Agent',
                            email: 'dot@postdot.local',
                            password: 'admin-password-with-length',
                            apiKey: {
                                name: 'Bootstrap Key',
                                actionAccess: ['project:read', 'instance:admin'],
                            },
                        },
                    },
                ])
                expect(JSON.parse(bootOut).apiKey.token).toBe('postdot_pat_boot_secret')
            }
        )
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test('admin commands operate access, api-keys, workspaces, and settings with Bearer token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postdot-cli-admin-env-'))
    const configDir = join(dir, 'config')
    const previousKey = process.env.POSTDOT_API_KEY
    process.env.POSTDOT_API_KEY = 'postdot_pat_admin_key'

    const calls: string[] = []
    try {
        await withMockServer(
            async (request, url) => {
                calls.push(`${request.method} ${url.pathname}`)
                expect(request.headers.get('authorization')).toBe('Bearer postdot_pat_admin_key')
                if (request.method === 'GET' && url.pathname === '/api/access') {
                    return jsonResponse({
                        instance: {
                            id: 'default',
                            state: 'claimed',
                            claimedByUserId: 'user-1',
                            claimedAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_000_000,
                        },
                        membership: {
                            id: 'm-1',
                            userId: 'user-1',
                            email: 'admin@postdot.local',
                            name: 'Admin',
                            role: 'admin',
                            state: 'enabled',
                            createdAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_000_000,
                        },
                        isAdmin: true,
                    })
                }
                if (
                    request.method === 'DELETE' &&
                    url.pathname === '/api/access/invitations/inv-1'
                ) {
                    return jsonResponse({
                        invitation: {
                            id: 'inv-1',
                            targetEmail: 'bob@postdot.local',
                            instanceRole: 'member',
                            state: 'revoked',
                            createdByUserId: 'user-1',
                            expiresAt: 1_800_100_000_000,
                            acceptedAt: null,
                            acceptedByUserId: null,
                            revokedAt: 1_800_000_010_000,
                            createdAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_010_000,
                        },
                    })
                }
                if (request.method === 'PATCH' && url.pathname === '/api/api-keys/key-1') {
                    return jsonResponse({
                        key: {
                            id: 'key-1',
                            name: 'Renamed',
                            tokenPrefix: 'postdot_pat_123',
                            projectAccess: 'all',
                            actionAccess: ['project:read', 'api_key:manage'],
                            expiresAt: null,
                            createdAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_010_000,
                        },
                    })
                }
                if (request.method === 'POST' && url.pathname === '/api/workspaces') {
                    return jsonResponse({ workspace: { id: 'ws-2', name: 'Ops' } }, 201)
                }
                if (request.method === 'POST' && url.pathname === '/api/settings/recovery/resume') {
                    return jsonResponse({ held: false, hold: null })
                }
                return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
            },
            async origin => {
                const run = (args: string[]) =>
                    createProgram({ jsonErrors: true, writeOut: () => {} }).parseAsync(
                        ['--config-dir', configDir, '--base-url', origin, '--json', ...args],
                        { from: 'user' }
                    )
                await run(['access', 'summary'])
                await run(['access', 'invitations', 'revoke', '--invitation', 'inv-1'])
                await run([
                    'api-keys',
                    'update',
                    '--key-id',
                    'key-1',
                    '--name',
                    'Renamed',
                    '--actions',
                    'project:read,api_key:manage',
                    '--no-expiry',
                ])
                await run(['workspaces', 'create', '--name', 'Ops'])
                await run([
                    'settings',
                    'recovery',
                    'resume',
                    '--token',
                    'hold-token-1',
                    '--confirm',
                ])
                expect(calls).toEqual([
                    'GET /api/access',
                    'DELETE /api/access/invitations/inv-1',
                    'PATCH /api/api-keys/key-1',
                    'POST /api/workspaces',
                    'POST /api/settings/recovery/resume',
                ])
            }
        )
    } finally {
        if (previousKey === undefined) delete process.env.POSTDOT_API_KEY
        else process.env.POSTDOT_API_KEY = previousKey
        rmSync(dir, { recursive: true, force: true })
    }
})
