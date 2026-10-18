import { expect, test } from 'bun:test'

import {
    closeDatabase,
    createDatabase,
    runMigrations,
    createManualStore,
    createAuthorizationAttemptStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
} from '@postbot/db'
import {
    createFacebookOAuth,
    createFacebookPublisher,
    facebookChannelProfile,
    FACEBOOK_PUBLISH_PERMISSIONS,
} from '@postbot/facebook'

import { createFacebookConnectionFlow } from './facebook-connection-flow'

const callbackUri = 'https://postbot.example/api/oauth/facebook/callback'
function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let timestamp = 1_800_000_000_000
    let editor = true
    let permitted = true
    let failConnection = false
    let requests = 0
    const now = () => timestamp
    const channels = createManualStore(database, { now })
    const project = channels.createProject({
        name: 'Test',
        subjectId: 'owner',
        displayName: 'Owner',
    })
    const channel = channels.createChannel({
        projectId: project.project.id,
        subjectId: 'owner',
        name: 'Facebook',
        profile: facebookChannelProfile,
    })!
    const cipher = createPublisherCredentialCipher({
        keyId: 'test',
        key: new Uint8Array(32).fill(7),
    })
    const attempts = createAuthorizationAttemptStore(database, {
        cipher,
        now,
        ttlMs: 60_000,
        validateReturnPath: path => {
            if (!path.startsWith('/dashboard/')) throw new Error('Invalid return path')
            return path
        },
    })
    const credentials = createPublisherCredentialStore(database, { cipher, now })
    const publishers = createPublisherStore(database, {
        credentialRevoker: credentials,
        now,
        connectionPolicies: {
            facebook: {
                validateDestination: value =>
                    value.type === 'channel' && /^[1-9]\d*$/.test(value.id),
            },
        },
    })
    const oauth = createFacebookOAuth({
        clientId: '123',
        clientSecret: 'synthetic-secret',
        callbackUri,
        fetcher: async () => {
            requests++
            return Response.json({
                access_token: 'synthetic-user-token',
                token_type: 'bearer',
                expires_in: 3600,
            })
        },
    })
    const graph = createFacebookPublisher({
        fetcher: async input => {
            requests++
            const url = new URL(String(input))
            if (url.pathname.endsWith('/me/permissions'))
                return Response.json({
                    data: FACEBOOK_PUBLISH_PERMISSIONS.map(permission => ({
                        permission,
                        status: permitted ? 'granted' : 'declined',
                    })),
                })
            return Response.json({
                data: [
                    {
                        id: '456',
                        name: 'Selected Page',
                        access_token: 'synthetic-page-token',
                        tasks: ['CREATE_CONTENT'],
                    },
                    { id: '789', name: 'Other Page', access_token: 'other-page-token', tasks: [] },
                ],
            })
        },
    })
    const flow = createFacebookConnectionFlow({
        attempts,
        credentials,
        channels,
        publishers: {
            ...publishers,
            createPublisherConnection: input =>
                failConnection
                    ? { kind: 'invalid_connection' }
                    : publishers.createPublisherConnection(input),
        },
        access: { canAccessProject: () => editor },
        oauth,
        graph,
        now,
    })
    const binding = {
        projectId: project.project.id,
        channelId: channel.id,
        subjectId: 'owner',
        authMethod: 'session' as const,
    }
    const callback = (url: string) => {
        const parameters = new URL(callbackUri)
        parameters.searchParams.set('state', new URL(url).searchParams.get('state')!)
        parameters.searchParams.set('code', 'synthetic-code')
        return parameters
    }
    async function pending() {
        const { url } = await flow.start(binding, '/dashboard/channels')
        return flow.complete(binding, callback(url))
    }
    return {
        database,
        channels,
        channel,
        project,
        attempts,
        credentials,
        publishers,
        flow,
        binding,
        callback,
        pending,
        get requests() {
            return requests
        },
        advance() {
            timestamp += 60_001
        },
        setViewer() {
            editor = false
        },
        losePermission() {
            permitted = false
        },
        failConnection() {
            failConnection = true
        },
    }
}

test('Facebook callback stages encrypted choices and connects only the explicitly selected Page', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        expect(
            f.publishers.getPublisherConnection(f.binding.projectId, f.binding.channelId, 'owner')
        ).toBeNull()
        const pages = await f.flow.listPages(f.binding, pending.selection)
        expect(pages).toEqual({
            pages: [
                { id: '456', name: 'Selected Page', hasPublishTask: true },
                { id: '789', name: 'Other Page', hasPublishTask: false },
            ],
            nextCursor: null,
        })
        expect(JSON.stringify(pages)).not.toContain('token')
        expect(
            JSON.stringify(
                f.database.$client.query('select * from oauth_authorization_attempts').all()
            )
        ).not.toContain('synthetic-user-token')
        const result = await f.flow.selectPage(f.binding, pending.selection, '456')
        expect(result.connection.destination).toEqual({
            type: 'channel',
            id: '456',
            name: 'Selected Page',
        })
        expect(JSON.stringify(result)).not.toContain('synthetic-page-token')
        expect(
            JSON.stringify(f.database.$client.query('select * from publisher_credentials').all())
        ).not.toContain('synthetic-page-token')
        expect(
            f.database.$client
                .query(
                    'select provider_state_ciphertext as secret from oauth_authorization_attempts'
                )
                .all()
        ).toEqual([{ secret: null }, { secret: null }])
    } finally {
        closeDatabase(f.database)
    }
})

test('API keys, foreign users and viewers cannot start authorization or contact Meta', async () => {
    const f = fixture()
    try {
        await expect(
            f.flow.start({ ...f.binding, authMethod: 'user_api_key' }, '/dashboard/channels')
        ).rejects.toMatchObject({ code: 'forbidden' })
        await expect(
            f.flow.start({ ...f.binding, subjectId: 'stranger' }, '/dashboard/channels')
        ).rejects.toMatchObject({ code: 'not_found' })
        f.setViewer()
        await expect(f.flow.start(f.binding, '/dashboard/channels')).rejects.toMatchObject({
            code: 'forbidden',
        })
        expect(f.requests).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('callback state is single use and binds the exact project and channel', async () => {
    const f = fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        const parameters = f.callback(url)
        const other = f.channels.createChannel({
            projectId: f.binding.projectId,
            subjectId: 'owner',
            name: 'Other',
            profile: facebookChannelProfile,
        })!
        await expect(
            f.flow.complete({ ...f.binding, channelId: other.id }, parameters)
        ).rejects.toMatchObject({ code: 'invalid_attempt' })
        expect(f.requests).toBe(0)
        await f.flow.complete(f.binding, parameters)
        const before = f.requests
        await expect(f.flow.complete(f.binding, parameters)).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(before)
    } finally {
        closeDatabase(f.database)
    }
})

test('expired or foreign pending choices never disclose Pages', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        const before = f.requests
        await expect(
            f.flow.listPages({ ...f.binding, subjectId: 'stranger' }, pending.selection)
        ).rejects.toMatchObject({ code: 'not_found' })
        f.advance()
        await expect(f.flow.listPages(f.binding, pending.selection)).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(before)
    } finally {
        closeDatabase(f.database)
    }
})

test('current permission and Page publishing task are required; no fallback Page is chosen', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        await expect(f.flow.selectPage(f.binding, pending.selection, '789')).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        await expect(f.flow.selectPage(f.binding, pending.selection, '999')).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        f.losePermission()
        await expect(f.flow.selectPage(f.binding, pending.selection, '456')).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(
            f.publishers.getPublisherConnection(f.binding.projectId, f.binding.channelId, 'owner')
        ).toBeNull()
        expect(f.database.$client.query('select * from publisher_credentials').all()).toHaveLength(
            0
        )
    } finally {
        closeDatabase(f.database)
    }
})

test('a persistence rejection consumes selection and revokes only its newly created credential', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        f.failConnection()
        await expect(f.flow.selectPage(f.binding, pending.selection, '456')).rejects.toMatchObject({
            code: 'conflict',
        })
        expect(f.database.$client.query('select state from publisher_credentials').all()).toEqual([
            { state: 'revoked' },
        ])
        const before = f.requests
        await expect(f.flow.selectPage(f.binding, pending.selection, '456')).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(before)
    } finally {
        closeDatabase(f.database)
    }
})

test('concurrent Page selections persist one connection', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        const results = await Promise.allSettled([
            f.flow.selectPage(f.binding, pending.selection, '456'),
            f.flow.selectPage(f.binding, pending.selection, '456'),
        ])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        expect(f.database.$client.query('select * from publisher_connections').all()).toHaveLength(
            1
        )
        expect(f.database.$client.query('select * from publisher_credentials').all()).toHaveLength(
            1
        )
    } finally {
        closeDatabase(f.database)
    }
})

test('an expired callback is consumed as expired without exchanging its provider code', async () => {
    const f = fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        f.advance()
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(0)
        expect(
            f.database.$client.query('select status from oauth_authorization_attempts').all()
        ).toEqual([{ status: 'expired' }])
    } finally {
        closeDatabase(f.database)
    }
})

test('loss of editor access after authorization prevents Page inspection and persistence', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        const before = f.requests
        f.setViewer()
        await expect(f.flow.listPages(f.binding, pending.selection)).rejects.toMatchObject({
            code: 'forbidden',
        })
        await expect(f.flow.selectPage(f.binding, pending.selection, '456')).rejects.toMatchObject({
            code: 'forbidden',
        })
        expect(f.requests).toBe(before)
        expect(f.database.$client.query('select * from publisher_credentials').all()).toHaveLength(
            0
        )
    } finally {
        closeDatabase(f.database)
    }
})

test('an operator cannot move pending choices into another project they own', async () => {
    const f = fixture()
    try {
        const pending = await f.pending()
        const project = f.channels.createProject({
            name: 'Other project',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        const channel = f.channels.createChannel({
            projectId: project.project.id,
            subjectId: 'owner',
            name: 'Facebook',
            profile: facebookChannelProfile,
        })!
        const before = f.requests
        await expect(
            f.flow.selectPage(
                { ...f.binding, projectId: project.project.id, channelId: channel.id },
                pending.selection,
                '456'
            )
        ).rejects.toMatchObject({ code: 'invalid_attempt' })
        expect(f.requests).toBe(before)
        expect(
            (await f.flow.selectPage(f.binding, pending.selection, '456')).connection.projectId
        ).toBe(f.binding.projectId)
    } finally {
        closeDatabase(f.database)
    }
})

test('manual channels cannot be connected through the Facebook flow', async () => {
    const f = fixture()
    try {
        const manual = f.channels.createChannel({
            projectId: f.binding.projectId,
            subjectId: 'owner',
            name: 'Manual',
        })!
        await expect(
            f.flow.start({ ...f.binding, channelId: manual.id }, '/dashboard/channels')
        ).rejects.toMatchObject({ code: 'conflict' })
        expect(f.requests).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})
