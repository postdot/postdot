import { describe, expect, it } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createAuth } from '@postdot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createNotificationStore,
    runMigrations,
} from '@postdot/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { buildMcpTools } from './openapi-tools'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000

function createFixture(options: { mcp?: { enabled: boolean } } = {}) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(7),
        publisherEncryptionKeyId: 'test-v1',
    })
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, { baseURL, secret, access, allowAdditionalSignups: true })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        manualStore: { now: () => now },
        notifications: createNotificationStore(database, { now: () => now + 1_000 }),
        accountOrigins: ['http://localhost:5173'],
        ...options,
    })
    return { app, database }
}

type App = ReturnType<typeof createApp>

async function setup() {
    const fixture = createFixture()
    const signUp = await fixture.app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email: 'agent@postdot.local',
                name: 'Agent Owner',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    const cookie = signUp.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
    const json = (path: string, body: unknown, init: RequestInit = {}) =>
        fixture.app.handle(
            new Request(`${baseURL}${path}`, {
                method: 'POST',
                ...init,
                headers: { 'content-type': 'application/json', cookie },
                body: JSON.stringify(body),
            })
        )
    const project = async (name: string) =>
        ((await (await json('/api/projects', { name })).json()) as { project: { id: string } })
            .project.id
    const apiKey = async (body: Record<string, unknown>) =>
        ((await (await json('/api/api-keys', body)).json()) as { token: string }).token
    return { ...fixture, json, project, apiKey }
}

function connect(app: App, token: string) {
    const client = new Client({ name: 'mcp-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: (input, init) => app.handle(new Request(input as string, init)),
    })
    return { client, connected: client.connect(transport) }
}

const textOf = (result: unknown) =>
    ((result as { content: { text: string }[] }).content[0] as { text: string }).text

describe('MCP endpoint', () => {
    it('builds the tool catalog from the live OpenAPI document', async () => {
        const { app, database } = createFixture()
        try {
            const document = await (await app.handle(new Request(`${baseURL}/openapi/json`))).json()
            const tools = buildMcpTools(document as Record<string, unknown>)
            expect(tools.length).toBeGreaterThan(50)
            expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length)
            // Everything that can reach a destination is gated; reads are never.
            for (const tool of tools) {
                if (tool.capability === 'publication:dispatch')
                    expect(tool.requiresConfirmation({})).toBe(true)
                if (tool.method === 'GET') {
                    expect(tool.annotations.readOnlyHint).toBe(true)
                    expect(tool.requiresConfirmation({})).toBe(false)
                }
            }
            // Session-only surfaces never become tools.
            const names = tools.map(tool => tool.name)
            for (const hidden of [
                'create_user_api_key',
                'list_access_members',
                'save_email_settings',
                'start_x_publisher_connection',
            ])
                expect(names).not.toContain(hidden)
        } finally {
            closeDatabase(database)
        }
    })

    it('refuses callers without a valid key, browser origins and streams', async () => {
        const f = await setup()
        try {
            const initialize = {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: { name: 'x', version: '1' },
                },
            }
            const post = (headers: Record<string, string>) =>
                f.app.handle(
                    new Request(`${baseURL}/mcp`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', ...headers },
                        body: JSON.stringify(initialize),
                    })
                )
            const anonymous = await post({})
            expect(anonymous.status).toBe(401)
            expect(anonymous.headers.get('www-authenticate')).toContain('Bearer')
            expect((await post({ authorization: 'Bearer postdot_pat_invalid' })).status).toBe(401)

            const token = await f.apiKey({ name: 'Agent', projectIds: null })
            expect((await post({ authorization: `Bearer ${token}` })).status).toBe(200)
            expect(
                (await post({ authorization: `Bearer ${token}`, origin: 'https://evil.example' }))
                    .status
            ).toBe(403)
            expect(
                (await post({ authorization: `Bearer ${token}`, origin: 'http://localhost:5173' }))
                    .status
            ).toBe(200)
            for (const method of ['GET', 'DELETE'])
                expect((await f.app.handle(new Request(`${baseURL}/mcp`, { method }))).status).toBe(
                    405
                )
            // A session cookie alone never authenticates this surface.
            const cookie = (
                await f.app.handle(
                    new Request(`${baseURL}/api/auth/sign-in/email`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', origin: baseURL },
                        body: JSON.stringify({
                            email: 'agent@postdot.local',
                            password: 'correct-horse-battery-staple',
                        }),
                    })
                )
            ).headers.get('set-cookie')
            expect((await post({ cookie: cookie?.split(';', 1)[0] ?? '' })).status).toBe(401)
        } finally {
            closeDatabase(f.database)
        }
    })

    it('lists only the tools a key may use and runs them as the key owner', async () => {
        const f = await setup()
        try {
            const first = await f.project('First')
            const second = await f.project('Second')
            const readOnly = await f.apiKey({
                name: 'Reader',
                projectIds: [first],
                actionAccess: ['project:read'],
            })
            const reader = connect(f.app, readOnly)
            await reader.connected
            const listed = (await reader.client.listTools()).tools
            expect(listed.length).toBeGreaterThan(10)
            expect(listed.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true)

            const projects = await reader.client.callTool({ name: 'list_projects', arguments: {} })
            expect(projects.isError).toBe(false)
            const visible = (JSON.parse(textOf(projects)) as { projects: { id: string }[] })
                .projects
            expect(visible.map(project => project.id)).toEqual([first])

            // A project outside the key's scope answers as if it did not exist.
            const hidden = await reader.client.callTool({
                name: 'list_project_channels',
                arguments: { projectId: second },
            })
            expect(hidden.isError).toBe(true)
            expect(textOf(hidden)).toContain('not_found')
            // A tool the key lacks is not callable even by name.
            await expect(
                reader.client.callTool({
                    name: 'create_project_channel',
                    arguments: { projectId: first, name: 'Nope' },
                })
            ).rejects.toThrow()
            await reader.client.close()

            const full = connect(f.app, await f.apiKey({ name: 'Full', projectIds: null }))
            await full.connected
            const created = await full.client.callTool({
                name: 'create_project_channel',
                arguments: { projectId: second, name: 'Agent channel' },
            })
            expect(created.isError).toBe(false)
            const channels = await full.client.callTool({
                name: 'list_project_channels',
                arguments: { projectId: second },
            })
            expect(textOf(channels)).toContain('Agent channel')
            // Bad input is rejected locally and by the API contract.
            const unknown = await full.client.callTool({
                name: 'list_project_channels',
                arguments: { projectId: second, surprise: true },
            })
            expect(unknown.isError).toBe(true)
            await full.client.close()
        } finally {
            closeDatabase(f.database)
        }
    })

    it('does nothing for a call that can change delivery until it is confirmed', async () => {
        const f = await setup()
        try {
            const project = await f.project('Publishing')
            const channel = (
                (await (
                    await f.json(`/api/projects/${project}/channels`, { name: 'Destination' })
                ).json()) as { channel: { id: string } }
            ).channel.id
            const { client, connected } = connect(
                f.app,
                await f.apiKey({ name: 'Publisher', projectIds: null })
            )
            await connected
            const post = (confirm?: true) => ({
                name: 'create_post',
                arguments: {
                    projectId: project,
                    title: 'Launch',
                    sourceContent: { body: { format: 'plain_text', text: 'Launch' }, media: [] },
                    publications: [
                        {
                            channelId: channel,
                            deliveryMode: 'manual',
                            scheduledAt: now + 48 * 3_600_000,
                        },
                    ],
                    ...(confirm === undefined ? {} : { confirm }),
                },
            })
            const refused = await client.callTool(post())
            expect(refused.isError).toBe(true)
            expect(textOf(refused)).toContain('confirm:true')
            const none = await client.callTool({
                name: 'list_publication_summaries',
                arguments: { projectId: project },
            })
            expect(JSON.parse(textOf(none)).publications).toEqual([])

            const accepted = await client.callTool(post(true))
            expect(accepted.isError).toBe(false)
            const after = await client.callTool({
                name: 'list_publication_summaries',
                arguments: { projectId: project },
            })
            expect(JSON.parse(textOf(after)).publications).toHaveLength(1)

            // A draft needs no confirmation.
            const draft = await client.callTool({
                name: 'create_post',
                arguments: {
                    projectId: project,
                    title: 'Draft',
                    sourceContent: { body: { format: 'plain_text', text: 'Draft' }, media: [] },
                    publications: [{ channelId: channel, deliveryMode: 'manual' }],
                },
            })
            expect(draft.isError).toBe(false)
            await client.close()
        } finally {
            closeDatabase(f.database)
        }
    })

    it('is absent when a deployment turns it off', async () => {
        const { app, database } = createFixture({ mcp: { enabled: false } })
        try {
            const response = await app.handle(
                new Request(`${baseURL}/mcp`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{}',
                })
            )
            expect(response.status).toBe(404)
        } finally {
            closeDatabase(database)
        }
    })
})
