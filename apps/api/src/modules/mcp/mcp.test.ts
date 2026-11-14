import { describe, expect, it } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createAuth } from '@postdot/auth'
import { createAccessStore, createNotificationStore } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { buildMcpTools } from './openapi-tools'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000

async function createFixture(options: { mcp?: { enabled: boolean } } = {}) {
    const database = (await openTestDatabase()).database
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
    const fixture = await createFixture()
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

async function connect(app: App, token: string) {
    const client = new Client({ name: 'mcp-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: (input, init) => app.handle(new Request(input as string, init)),
    })
    return { client, connected: await client.connect(transport) }
}

const textOf = (result: unknown) =>
    ((result as { content: { text: string }[] }).content[0] as { text: string }).text

describe('MCP endpoint', () => {
    it('builds the tool catalog from the live OpenAPI document', async () => {
        const { app, database } = await createFixture()
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
            // Browser OAuth, invitation acceptance, binary streams, and audit logs stay outside MCP.
            const names = tools.map(tool => tool.name)
            for (const hidden of [
                'start_x_publisher_connection',
                'start_bluesky_publisher_connection',
                'accept_access_invitation',
                'list_project_audit_events',
            ])
                expect(names).not.toContain(hidden)

            for (const adminTool of [
                'list_access_members',
                'create_access_member',
                'create_user_api_key',
                'create_workspace',
                'create_provider_application_configuration',
                'save_email_settings',
                'resume_after_restore',
                'create_devto_publisher_connection',
                'create_discord_publisher_connection',
                'approve_publication_request',
            ])
                expect(names).toContain(adminTool)
        } finally {
            await closeTestDatabase(database)
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
            await closeTestDatabase(f.database)
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
            const reader = await connect(f.app, readOnly)
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

            const full = await connect(f.app, await f.apiKey({ name: 'Full', projectIds: null }))
            await full.connected
            const workspaces = await full.client.callTool({
                name: 'list_workspaces',
                arguments: {},
            })
            expect(workspaces.isError).toBe(false)
            expect(JSON.parse(textOf(workspaces)).workspaces.length).toBeGreaterThanOrEqual(1)

            const createdProject = await full.client.callTool({
                name: 'create_project',
                arguments: { name: 'MCP Created', timeZone: 'Europe/Paris' },
            })
            expect(createdProject.isError).toBe(false)
            const createdProjectId = (
                JSON.parse(textOf(createdProject)) as { project: { id: string; timeZone: string } }
            ).project.id
            expect(JSON.parse(textOf(createdProject)).project.timeZone).toBe('Europe/Paris')

            const updatedTz = await full.client.callTool({
                name: 'update_project_time_zone',
                arguments: { projectId: createdProjectId, timeZone: 'Asia/Tokyo' },
            })
            expect(updatedTz.isError).toBe(false)
            expect(JSON.parse(textOf(updatedTz)).timeZone).toBe('Asia/Tokyo')

            const invalidTz = await full.client.callTool({
                name: 'update_project_time_zone',
                arguments: { projectId: createdProjectId, timeZone: 'Mars/Olympus' },
            })
            expect(invalidTz.isError).toBe(true)

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

            const scopedManage = await connect(
                f.app,
                await f.apiKey({
                    name: 'ScopedManage',
                    projectIds: [first],
                    actionAccess: ['project:read', 'project:manage'],
                })
            )
            await scopedManage.connected
            const blockedCreate = await scopedManage.client.callTool({
                name: 'create_project',
                arguments: { name: 'Blocked' },
            })
            expect(blockedCreate.isError).toBe(true)
            const allowedTz = await scopedManage.client.callTool({
                name: 'update_project_time_zone',
                arguments: { projectId: first, timeZone: 'America/New_York' },
            })
            expect(allowedTz.isError).toBe(false)
            await scopedManage.client.close()
        } finally {
            await closeTestDatabase(f.database)
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
            const { client, connected } = await connect(
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
            await closeTestDatabase(f.database)
        }
    })

    it('exposes admin, access, workspace, API-key, provider-app, and non-OAuth connection tools with confirmation and anti-escalation', async () => {
        const f = await setup()
        try {
            const project = await f.project('Ops')
            const channel = (
                (await (
                    await f.json(`/api/projects/${project}/channels`, {
                        name: 'Webhook',
                        profile: {
                            id: 'custom-webhook',
                            version: 1,
                            profileHash: 'sha256:custom-webhook-profile-v1',
                            schemaHash: 'sha256:custom-webhook-schema-v1',
                            origin: 'custom',
                            contentSchema: {
                                $schema: 'https://json-schema.org/draft/2020-12/schema',
                                type: 'object',
                                properties: {
                                    body: { type: 'string', minLength: 1, maxLength: 1_000 },
                                },
                                required: ['body'],
                                additionalProperties: false,
                            },
                            fieldBindings: [
                                { id: 'body', semantic: 'primary_text', path: '/body' },
                            ],
                            capabilities: {
                                revision: 'custom-webhook-v1',
                                textFields: [
                                    {
                                        bindingId: 'body',
                                        acceptedSourceFormats: ['plain_text'],
                                        maxLength: 1_000,
                                    },
                                ],
                                mediaFields: [],
                                relations: [],
                            },
                            execution: {
                                kind: 'declarative_http',
                                contractId: 'custom-webhook',
                                revision: '1',
                                mode: 'postdot_webhook',
                            },
                        },
                    })
                ).json()) as { channel: { id: string } }
            ).channel.id

            const admin = await connect(
                f.app,
                await f.apiKey({ name: 'AdminAgent', projectIds: null, actionAccess: null })
            )
            await admin.connected

            const listedAdmin = (await admin.client.listTools()).tools.map(t => t.name)
            expect(listedAdmin).toContain('create_access_member')
            expect(listedAdmin).toContain('create_user_api_key')
            expect(listedAdmin).toContain('create_workspace')
            expect(listedAdmin).toContain('create_custom_http_publisher_connection')

            const unconfirmedMember = await admin.client.callTool({
                name: 'create_access_member',
                arguments: {
                    name: 'Worker Bot',
                    email: 'worker@postdot.local',
                    role: 'member',
                    apiKey: { name: 'Worker Key' },
                },
            })
            expect(unconfirmedMember.isError).toBe(true)
            expect(textOf(unconfirmedMember)).toContain('confirm:true')

            const createdMember = await admin.client.callTool({
                name: 'create_access_member',
                arguments: {
                    name: 'Worker Bot',
                    email: 'worker@postdot.local',
                    role: 'member',
                    apiKey: { name: 'Worker Key' },
                    confirm: true,
                },
            })
            expect(createdMember.isError).toBe(false)
            const createdMemberPayload = JSON.parse(textOf(createdMember)) as {
                membership: { userId: string; role: string }
                apiKey?: { token: string }
            }
            expect(createdMemberPayload.membership.role).toBe('member')
            expect(createdMemberPayload.apiKey?.token).toMatch(/^postdot_pat_/)

            const createdWorkspace = await admin.client.callTool({
                name: 'create_workspace',
                arguments: { name: 'Ops Team', confirm: true },
            })
            expect(createdWorkspace.isError).toBe(false)
            expect(JSON.parse(textOf(createdWorkspace)).workspace.name).toBe('Ops Team')

            const createdApp = await admin.client.callTool({
                name: 'create_provider_application_configuration',
                arguments: {
                    providerId: 'linkedin',
                    name: 'LinkedIn MCP App',
                    clientId: 'mcp-client-id',
                    clientSecret: 'mcp-client-secret',
                    confirm: true,
                },
            })
            expect(createdApp.isError).toBe(false)

            const connectedWebhook = await admin.client.callTool({
                name: 'create_custom_http_publisher_connection',
                arguments: {
                    projectId: project,
                    channelId: channel,
                    endpointUrl: 'https://hooks.example.test',
                    authentication: { kind: 'bearer' },
                    secret: 'webhook-signing-secret-with-at-least-32-chars',
                    confirm: true,
                },
            })
            expect(connectedWebhook.isError).toBe(false)

            // Anti-escalation through MCP: a bounded key cannot mint a wider key.
            const childKeyRes = await admin.client.callTool({
                name: 'create_user_api_key',
                arguments: {
                    name: 'Scoped Key Manager',
                    projectIds: [project],
                    actionAccess: ['project:read', 'api_key:manage'],
                    confirm: true,
                },
            })
            expect(childKeyRes.isError).toBe(false)
            const childToken = (JSON.parse(textOf(childKeyRes)) as { token: string }).token
            await admin.client.close()

            const bounded = await connect(f.app, childToken)
            await bounded.connected
            const boundedNames = (await bounded.client.listTools()).tools.map(t => t.name)
            expect(boundedNames).toContain('create_user_api_key')
            expect(boundedNames).not.toContain('list_access_members')
            expect(boundedNames).not.toContain('create_workspace')

            const escalated = await bounded.client.callTool({
                name: 'create_user_api_key',
                arguments: {
                    name: 'Escalated',
                    projectIds: null,
                    actionAccess: null,
                    confirm: true,
                },
            })
            expect(escalated.isError).toBe(true)
            await bounded.client.close()

            // A key restricted to selected projects never sees instance/workspace admin tools even with actionAccess: null.
            const selectedAll = await connect(
                f.app,
                await f.apiKey({ name: 'SelectedAll', projectIds: [project], actionAccess: null })
            )
            await selectedAll.connected
            const selectedNames = (await selectedAll.client.listTools()).tools.map(t => t.name)
            expect(selectedNames).not.toContain('list_access_members')
            expect(selectedNames).not.toContain('create_workspace')
            expect(selectedNames).not.toContain('get_workspace')
            await selectedAll.client.close()
        } finally {
            await closeTestDatabase(f.database)
        }
    })

    it('is absent when a deployment turns it off', async () => {
        const { app, database } = await createFixture({ mcp: { enabled: false } })
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
            await closeTestDatabase(database)
        }
    })
})
