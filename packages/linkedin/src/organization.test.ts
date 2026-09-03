import { describe, expect, it } from 'bun:test'

import { createLinkedInOrganizationClient } from './organization'

describe('LinkedIn organization client', () => {
    it('looks up the requested organization with versioned REST headers', async () => {
        let request:
            | { readonly input: string | URL | Request; readonly init?: RequestInit }
            | undefined

        const client = createLinkedInOrganizationClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async (input, init) => {
                request = { input, init }
                return Response.json({ id: 12345, localizedName: 'Tala Web' })
            },
        })

        await expect(client.getOrganization('access-token', ' 12345 ')).resolves.toEqual({
            id: '12345',
            name: 'Tala Web',
        })
        expect(String(request?.input)).toBe('https://linkedin.test/rest/organizations/12345')
        expect(request?.init?.method).toBe('GET')
        expect(request?.init?.redirect).toBe('error')
        const headers = new Headers(request?.init?.headers)
        expect(headers.get('authorization')).toBe('Bearer access-token')
        expect(headers.get('accept')).toBe('application/json')
        expect(headers.get('linkedin-version')).toBe('202608')
        expect(headers.get('x-restli-protocol-version')).toBe('2.0.0')
    })

    it('exposes only the provider status for access failures', async () => {
        const client = createLinkedInOrganizationClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async () => new Response('secret-access-token', { status: 403 }),
        })

        const error = await client
            .getOrganization('secret-access-token', '12345')
            .catch(value => value)

        expect(error).toMatchObject({
            name: 'LinkedInOrganizationError',
            status: 403,
        })
        expect(String(error)).not.toContain('secret-access-token')
    })

    it('rejects invalid identifiers and malformed responses before accepting a destination', async () => {
        let calls = 0
        const client = createLinkedInOrganizationClient({
            baseUrl: 'https://linkedin.test',
            fetcher: async () => {
                calls += 1
                return Response.json({ id: '12345', name: 'Tala Web' })
            },
        })

        await expect(client.getOrganization('   ', '12345')).rejects.toThrow(
            'access token is unavailable'
        )
        await expect(client.getOrganization('access-token', 'org-123')).rejects.toThrow(
            'positive numeric identifier'
        )
        await expect(client.getOrganization('access-token', '0')).rejects.toThrow(
            'positive numeric identifier'
        )
        await expect(client.getOrganization('access-token', '12345')).resolves.toEqual({
            id: '12345',
            name: 'Tala Web',
        })
        expect(calls).toBe(1)
    })
})
