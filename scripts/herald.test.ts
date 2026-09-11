import { describe, expect, it } from 'bun:test'

import { runCli } from './herald'

function requestFromInput(input: string | URL | Request, init?: RequestInit) {
    return input instanceof Request ? new Request(input, init) : new Request(String(input), init)
}

describe('Herald CLI', () => {
    it('documents project token commands and machine authentication', async () => {
        const output: string[] = []

        await runCli(['--help'], {}, { output: message => output.push(message) })

        expect(output[0]).toContain('access-tokens create --project <id> --name <name>')
        expect(output[0]).toContain('--token <value>')
    })

    it('uses a project API key for ordinary project operations', async () => {
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

    it('uses the human session for one-time token creation and never exposes it in metadata output', async () => {
        const secret = 'herald_pat_only-returned-once'
        const output: string[] = []
        let requestBody: unknown
        let requestAuthorization: string | null = null

        await runCli(
            ['access-tokens', 'create', '--project', 'project-1', '--name', 'Release agent'],
            { HERALD_SESSION_COOKIE: 'better-auth.session_token=session' },
            {
                fetcher: async (input, init) => {
                    const request = requestFromInput(input, init)
                    requestBody = await request.clone().json()
                    requestAuthorization = request.headers.get('authorization')
                    return Response.json({
                        accessToken: {
                            id: 'token-1',
                            projectId: 'project-1',
                            name: 'Release agent',
                            tokenPrefix: 'herald_pat_only-ret',
                            expiresAt: null,
                            revokedAt: null,
                            createdAt: 1_800_000_000_000,
                            updatedAt: 1_800_000_000_000,
                        },
                        token: secret,
                    })
                },
                output: message => output.push(message),
            }
        )

        expect(requestBody).toEqual({ name: 'Release agent' })
        expect(requestAuthorization).toBeNull()
        expect(output[0]).toContain(secret)

        output.length = 0
        await runCli(
            ['access-tokens', 'list', '--project', 'project-1'],
            { HERALD_SESSION_COOKIE: 'better-auth.session_token=session' },
            {
                fetcher: async () =>
                    Response.json({
                        accessTokens: [
                            {
                                id: 'token-1',
                                projectId: 'project-1',
                                name: 'Release agent',
                                tokenPrefix: 'herald_pat_only-ret',
                                expiresAt: null,
                                revokedAt: null,
                                createdAt: 1_800_000_000_000,
                                updatedAt: 1_800_000_000_000,
                            },
                        ],
                    }),
                output: message => output.push(message),
            }
        )

        expect(output[0]).not.toContain(secret)
        expect(output[0]).toContain('herald_pat_only-ret')
    })

    it('rejects token management without a human session', async () => {
        await expect(
            runCli(['access-tokens', 'list', '--project', 'project-1'], {
                HERALD_PROJECT_TOKEN: 'herald_pat_machine-secret',
            })
        ).rejects.toThrow('requires a human session')
    })
})
