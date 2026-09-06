import { describe, expect, it } from 'bun:test'

import type { DevtoFetcher } from './contract'
import { createDevtoPublisher, normalizeDevtoApiKey } from './publisher'

const API_KEY = 'devto-test-api-key-that-must-not-leak'

function jsonResponse(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function createFetcher(responses: readonly Response[]) {
    const calls: Array<{ readonly input: string | URL | Request; readonly init?: RequestInit }> = []
    let index = 0
    const fetcher: DevtoFetcher = async (input, init) => {
        calls.push({ input, init })
        const response = responses[index]
        index += 1
        if (response === undefined) throw new Error('Unexpected DEV.to request')
        return response
    }
    return { calls, fetcher }
}

describe('DEV.to API key validation', () => {
    it('trims a key and rejects whitespace', () => {
        expect(normalizeDevtoApiKey(`  ${API_KEY}  `)).toBe(API_KEY)
        expect(() => normalizeDevtoApiKey('')).toThrow()
        expect(() => normalizeDevtoApiKey('key with whitespace')).toThrow()
    })
})

describe('DEV.to publisher', () => {
    it('verifies the account with the Forem API v1 headers', async () => {
        const fixture = createFetcher([
            jsonResponse({ id: 42, username: 'herald', name: 'Herald' }),
        ])
        const publisher = createDevtoPublisher({
            baseUrl: 'https://devto.test',
            fetcher: fixture.fetcher,
        })

        await expect(publisher.getMe(API_KEY)).resolves.toEqual({
            kind: 'success',
            value: { id: '42', username: 'herald', name: 'Herald' },
        })
        expect(fixture.calls[0]?.input).toBe('https://devto.test/api/users/me')
        const headers = new Headers(fixture.calls[0]?.init?.headers)
        expect(headers.get('accept')).toBe('application/vnd.forem.api-v1+json')
        expect(headers.get('api-key')).toBe(API_KEY)
        expect(headers.get('user-agent')).toBe('Herald/0.1')
    })

    it('publishes a live Markdown article and maps the returned URL', async () => {
        let request: { input: string; init: RequestInit | undefined } | undefined
        const publisher = createDevtoPublisher({
            baseUrl: 'https://devto.test',
            fetcher: async (input, init) => {
                request = { input: input.toString(), init }
                return jsonResponse({ id: 123, url: 'https://dev.to/herald/article' }, 201)
            },
        })

        const outcome = await publisher.publishArticle({
            apiKey: API_KEY,
            title: 'A Herald article',
            bodyMarkdown: '# Hello DEV.to',
            mainImageUrl: 'https://media.herald.test/article.png',
        })

        expect(outcome).toEqual({
            type: 'published',
            externalId: '123',
            externalUrl: 'https://dev.to/herald/article',
        })
        expect(request?.input).toBe('https://devto.test/api/articles')
        expect(request?.init?.method).toBe('POST')
        expect(JSON.parse(String(request?.init?.body))).toEqual({
            article: {
                title: 'A Herald article',
                body_markdown: '# Hello DEV.to',
                published: true,
                main_image: 'https://media.herald.test/article.png',
            },
        })
        expect(JSON.stringify(outcome)).not.toContain(API_KEY)
    })

    it('classifies an authentication response without exposing the API key', async () => {
        const publisher = createDevtoPublisher({
            baseUrl: 'https://devto.test',
            fetcher: async () => jsonResponse({ error: API_KEY }, 401),
        })

        const outcome = await publisher.publishArticle({
            apiKey: API_KEY,
            title: 'A Herald article',
            bodyMarkdown: 'Body',
        })

        expect(outcome).toMatchObject({
            type: 'permanent_failure',
            code: 'authentication_required',
        })
        expect(JSON.stringify(outcome)).not.toContain(API_KEY)
    })

    it('treats an article request that reaches a server error as ambiguous', async () => {
        const publisher = createDevtoPublisher({
            baseUrl: 'https://devto.test',
            fetcher: async () => jsonResponse({ error: 'server error' }, 500),
        })

        await expect(
            publisher.publishArticle({
                apiKey: API_KEY,
                title: 'A Herald article',
                bodyMarkdown: 'Body',
            })
        ).resolves.toMatchObject({ type: 'ambiguous', code: 'provider_failure' })
    })

    it('rejects invalid input before dispatch', async () => {
        let calls = 0
        const publisher = createDevtoPublisher({
            fetcher: async () => {
                calls += 1
                return jsonResponse({})
            },
        })

        await expect(
            publisher.publishArticle({ apiKey: API_KEY, title: '', bodyMarkdown: 'Body' })
        ).resolves.toMatchObject({ type: 'permanent_failure', code: 'invalid_input' })
        expect(calls).toBe(0)
    })
})
