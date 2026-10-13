import { describe, expect, it } from 'bun:test'

import { createLinkedInMemberProfileClient } from './profile'

describe('LinkedIn member profile client', () => {
    it('requests the OIDC profile with the access token and returns public metadata', async () => {
        let request:
            | { readonly input: string | URL | Request; readonly init?: RequestInit }
            | undefined

        const client = createLinkedInMemberProfileClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async (input, init) => {
                request = { input, init }
                return Response.json({ sub: 'member-42', name: 'Postbot Operator' })
            },
        })

        await expect(client.getProfile('access-token')).resolves.toEqual({
            id: 'member-42',
            name: 'Postbot Operator',
        })
        expect(String(request?.input)).toBe('https://linkedin.test/v2/userinfo')
        expect(new Headers(request?.init?.headers).get('authorization')).toBe('Bearer access-token')
        expect(request?.init?.method).toBe('GET')
    })

    it('rejects malformed profiles and provider responses without leaking the token', async () => {
        const client = createLinkedInMemberProfileClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async () => Response.json({ name: 'Missing subject' }),
        })

        await expect(client.getProfile('secret-access-token')).rejects.toThrow(
            'did not contain a member id'
        )

        const rejectedClient = createLinkedInMemberProfileClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async () => new Response('provider failure', { status: 401 }),
        })
        const error = await rejectedClient.getProfile('secret-access-token').catch(value => value)

        expect(String(error)).toContain('HTTP 401')
        expect(String(error)).not.toContain('secret-access-token')
    })

    it('normalizes an absent display name and rejects blank access tokens', async () => {
        let calls = 0
        const client = createLinkedInMemberProfileClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async () => {
                calls += 1
                return Response.json({ sub: 'member-42', name: '   ' })
            },
        })

        await expect(client.getProfile('access-token')).resolves.toEqual({
            id: 'member-42',
            name: null,
        })
        await expect(client.getProfile('   ')).rejects.toThrow('access token is unavailable')
        expect(calls).toBe(1)
    })

    it('turns an aborted provider request into a timeout error', async () => {
        const client = createLinkedInMemberProfileClient({
            baseUrl: 'https://linkedin.test',
            timeoutMs: 1,
            fetcher: async (_input, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
                }),
        })

        await expect(client.getProfile('access-token')).rejects.toThrow('request timed out')
    })
})
