import { describe, expect, it } from 'bun:test'

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
