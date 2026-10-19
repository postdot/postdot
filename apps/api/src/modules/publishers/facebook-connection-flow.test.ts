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
type PermissionMode = 'granted' | 'declined' | 'missing' | 'revoked'
function fixture(
    options: {
        readonly finalExpiration?: number | null
        readonly permissionDelayMs?: number
        readonly permissionMode?: PermissionMode
    } = {}
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let timestamp = 1_800_000_000_000
    let editor = true
    let permitted = true
    let failConnection = false
    let requests = 0
    const now = () => timestamp
    const finalExpiration = options.finalExpiration === undefined ? 3600 : options.finalExpiration
    const permissionDelayMs = options.permissionDelayMs ?? 0
    const permissionMode = options.permissionMode ?? 'granted'
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
        fetcher: async input => {
            requests++
            const url = new URL(String(input))
            if (url.searchParams.get('grant_type') !== 'fb_exchange_token')
                return Response.json({
                    access_token: 'synthetic-user-token',
                    token_type: 'bearer',
                    expires_in: 3600,
                })
            return Response.json({
                access_token: 'synthetic-long-user-token',
                token_type: 'bearer',
                ...(finalExpiration === null ? {} : { expires_in: finalExpiration }),
            })
        },
    })
    const graph = createFacebookPublisher({
        fetcher: async input => {
            requests++
            const url = new URL(String(input))
            if (url.pathname.endsWith('/me/permissions')) {
                timestamp += permissionDelayMs
                if (permissionMode === 'revoked')
                    return Response.json(
                        {
                            error: {
                                message: 'Invalid OAuth token',
                                type: 'OAuthException',
                                code: 190,
                            },
                        },
                        { status: 401 }
                    )
                const scopes =
                    permissionMode === 'missing'
                        ? FACEBOOK_PUBLISH_PERMISSIONS.slice(0, -1)
                        : FACEBOOK_PUBLISH_PERMISSIONS
                return Response.json({
                    data: scopes.map(permission => ({
                        permission,
                        status: permitted && permissionMode !== 'declined' ? 'granted' : 'declined',
                    })),
                })
            }
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
        cipher,
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
        advance(milliseconds = 60_001) {
            timestamp += milliseconds
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

async function stateDigest(state: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state)))
}

/** Reads the decrypted pending provider state through the store's own API. */
async function readPendingProviderState(
    f: ReturnType<typeof fixture>,
    selection: string
): Promise<Record<string, unknown>> {
    const row = f.database.$client
        .query<{ connectedByActorId: string }, []>(
            `select connected_by_actor_id as connectedByActorId
             from oauth_authorization_attempts
             where provider_state_ciphertext is not null`
        )
        .get()
    if (!row) throw new Error('no pending attempt')
    const stored = await f.attempts.readPendingAuthorizationProviderState({
        stateDigest: await stateDigest(selection),
        connectedByActorId: row.connectedByActorId,
        providerId: 'facebook',
        callbackUri,
    })
    if (stored.kind !== 'ready' || !stored.providerState)
        throw new Error('pending provider state is unreadable')
    return JSON.parse(stored.providerState) as Record<string, unknown>
}

/** Persists a crafted pending provider state through the store's own API. */
async function storePendingProviderState(
    f: ReturnType<typeof fixture>,
    state: string,
    providerState: string
): Promise<void> {
    const actorId = f.publishers.getProjectActorId(f.binding.projectId, f.binding.subjectId)
    if (!actorId) throw new Error('no actor')
    const created = await f.attempts.createAuthorizationAttempt({
        projectId: f.binding.projectId,
        channelId: f.binding.channelId,
        connectedByActorId: actorId,
        providerId: 'facebook',
        callbackUri,
        scopes: FACEBOOK_PUBLISH_PERMISSIONS,
        returnPath: '/dashboard/channels',
        context: { clientId: '123', phase: 'page-selection' },
        stateDigest: await stateDigest(state),
        codeVerifier: null,
        providerState,
    })
    if (created.kind !== 'created') throw new Error('pending attempt was not created')
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
        const attempts = JSON.stringify(
            f.database.$client.query('select * from oauth_authorization_attempts').all()
        )
        expect(attempts).not.toContain('synthetic-user-token')
        expect(attempts).not.toContain('synthetic-long-user-token')
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

test('an unknown provider expiration completes the Page selection and stores only the selected Page token', async () => {
    const f = fixture({ finalExpiration: null })
    try {
        const pending = await f.pending()
        const stored = f.database.$client
            .query<{ id: string; ciphertext: Uint8Array | null }, []>(
                'select id, provider_state_ciphertext as ciphertext from oauth_authorization_attempts'
            )
            .all()
        const sealed = stored.find(row => row.ciphertext !== null)
        expect(sealed).toBeDefined()
        expect(sealed!.ciphertext!.byteLength).toBeGreaterThan(16)
        expect(new TextDecoder().decode(sealed!.ciphertext!)).not.toContain(
            'synthetic-long-user-token'
        )
        const pages = await f.flow.listPages(f.binding, pending.selection)
        expect(pages.pages.map(page => page.id)).toEqual(['456', '789'])
        const result = await f.flow.selectPage(f.binding, pending.selection, '456')
        expect(result.connection.destination).toEqual({
            type: 'channel',
            id: '456',
            name: 'Selected Page',
        })
        const credentials = f.database.$client
            .query<
                {
                    id: string
                    providerId: string
                    version: 1
                    keyId: string
                    ciphertext: Uint8Array
                    nonce: Uint8Array
                },
                []
            >(
                `select id, provider_id as providerId, encryption_version as version,
                        encryption_key_id as keyId, access_token_ciphertext as ciphertext,
                        access_token_nonce as nonce
                 from publisher_credentials`
            )
            .all()
        expect(credentials).toHaveLength(1)
        expect(
            await f.cipher.decrypt(
                {
                    recordId: credentials[0]!.id,
                    providerId: credentials[0]!.providerId,
                    field: 'access_token',
                },
                {
                    version: credentials[0]!.version,
                    keyId: credentials[0]!.keyId,
                    ciphertext: credentials[0]!.ciphertext,
                    nonce: credentials[0]!.nonce,
                }
            )
        ).toBe('synthetic-page-token')
        expect(
            JSON.stringify(f.database.$client.query('select * from publisher_credentials').all())
        ).not.toContain('synthetic-long-user-token')
    } finally {
        closeDatabase(f.database)
    }
})

test('an unknown provider expiration is stored as an explicit null deadline holding the final token', async () => {
    const f = fixture({ finalExpiration: null })
    try {
        const pending = await f.pending()
        const state = await readPendingProviderState(f, pending.selection)
        expect(Object.hasOwn(state, 'expiresAt')).toBe(true)
        expect(state.expiresAt).toBeNull()
        expect(state.token).toBe('synthetic-long-user-token')
        const rows = JSON.stringify(
            f.database.$client.query('select * from oauth_authorization_attempts').all()
        )
        expect(rows).not.toContain('synthetic-user-token')
        expect(rows).not.toContain('synthetic-long-user-token')
    } finally {
        closeDatabase(f.database)
    }
})

test('an unknown provider expiration stays bound to the local attempt lifetime', async () => {
    const f = fixture({ finalExpiration: null })
    try {
        const pending = await f.pending()
        f.advance(59_999)
        await expect(f.flow.listPages(f.binding, pending.selection)).resolves.toBeDefined()
        const before = f.requests
        f.advance(2)
        await expect(f.flow.listPages(f.binding, pending.selection)).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(before)
    } finally {
        closeDatabase(f.database)
    }
})

test('a known provider expiration shorter than the local attempt lifetime refuses the pending token', async () => {
    const f = fixture({ finalExpiration: 30 })
    try {
        const pending = await f.pending()
        f.advance(30_000)
        const before = f.requests
        await expect(f.flow.listPages(f.binding, pending.selection)).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        await expect(f.flow.selectPage(f.binding, pending.selection, '456')).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(before)
        f.advance(1)
        await expect(f.flow.listPages(f.binding, pending.selection)).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.requests).toBe(before)
        expect(
            f.database.$client
                .query<{ status: string }, []>('select status from oauth_authorization_attempts')
                .all()
                .map(row => row.status)
        ).toEqual(['consumed', 'pending'])
        expect(f.database.$client.query('select * from publisher_credentials').all()).toHaveLength(
            0
        )
    } finally {
        closeDatabase(f.database)
    }
})

test('a permission probe that crosses a known deadline is refused before any pending choice exists', async () => {
    const f = fixture({ finalExpiration: 10, permissionDelayMs: 11_000 })
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        const attempts = f.database.$client
            .query<{ status: string; ciphertext: Uint8Array | null }, []>(
                `select status, provider_state_ciphertext as ciphertext
                 from oauth_authorization_attempts`
            )
            .all()
        expect(attempts).toHaveLength(1)
        expect(attempts[0]!.status).toBe('consumed')
        expect(attempts[0]!.ciphertext).toBeNull()
        expect(f.database.$client.query('select * from publisher_credentials').all()).toHaveLength(
            0
        )
    } finally {
        closeDatabase(f.database)
    }
})

test('a refused permission discovery creates no pending Page selection', async () => {
    const f = fixture()
    try {
        f.losePermission()
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        const attempts = f.database.$client
            .query<{ status: string; context: string; ciphertext: Uint8Array | null }, []>(
                `select status, context_json as context, provider_state_ciphertext as ciphertext
                 from oauth_authorization_attempts`
            )
            .all()
        expect(attempts).toHaveLength(1)
        expect(attempts[0]!.status).toBe('consumed')
        expect(attempts[0]!.ciphertext).toBeNull()
        expect(JSON.parse(attempts[0]!.context).phase).toBe('authorization')
    } finally {
        closeDatabase(f.database)
    }
})

test('an unknown provider expiration still refuses missing or declined publishing permissions', async () => {
    for (const permissionMode of ['declined', 'missing'] as const) {
        const f = fixture({ finalExpiration: null, permissionMode })
        try {
            const { url } = await f.flow.start(f.binding, '/dashboard/channels')
            await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
                code: 'provider_unavailable',
            })
            const attempts = f.database.$client
                .query<{ status: string; context: string; ciphertext: Uint8Array | null }, []>(
                    `select status, context_json as context, provider_state_ciphertext as ciphertext
                     from oauth_authorization_attempts`
                )
                .all()
            expect(attempts).toHaveLength(1)
            expect(attempts[0]!.status).toBe('consumed')
            expect(attempts[0]!.ciphertext).toBeNull()
            expect(JSON.parse(attempts[0]!.context).phase).toBe('authorization')
            expect(
                f.database.$client.query('select * from publisher_credentials').all()
            ).toHaveLength(0)
        } finally {
            closeDatabase(f.database)
        }
    }
})

test('an unknown provider expiration refuses a revoked provider token', async () => {
    const f = fixture({ finalExpiration: null, permissionMode: 'revoked' })
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        const attempts = f.database.$client
            .query<{ status: string; context: string; ciphertext: Uint8Array | null }, []>(
                `select status, context_json as context, provider_state_ciphertext as ciphertext
                 from oauth_authorization_attempts`
            )
            .all()
        expect(attempts).toHaveLength(1)
        expect(attempts[0]!.status).toBe('consumed')
        expect(attempts[0]!.ciphertext).toBeNull()
        expect(JSON.parse(attempts[0]!.context).phase).toBe('authorization')
        expect(f.database.$client.query('select * from publisher_credentials').all()).toHaveLength(
            0
        )
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

test('a malformed pending provider state is refused before any Graph request', async () => {
    for (const providerState of [
        '{"token":"synthetic-long-user-token"}',
        '{"token":"synthetic-long-user-token","expiresAt":"1800000000000"}',
        '{"token":"synthetic-long-user-token","expiresAt":1800000000000.5}',
        '{"token":"synthetic-long-user-token","expiresAt":1e300}',
        'null',
        '"synthetic-long-user-token"',
    ]) {
        const f = fixture({ finalExpiration: null })
        try {
            const state = crypto.randomUUID() + crypto.randomUUID()
            await storePendingProviderState(f, state, providerState)
            const before = f.requests
            await expect(f.flow.listPages(f.binding, state)).rejects.toMatchObject({
                code: 'invalid_attempt',
            })
            expect(f.requests).toBe(before)
            expect(
                f.database.$client.query('select * from publisher_credentials').all()
            ).toHaveLength(0)
        } finally {
            closeDatabase(f.database)
        }
    }
})

test('a legacy numeric pending provider state is still accepted', async () => {
    const f = fixture({ finalExpiration: null })
    try {
        const state = crypto.randomUUID() + crypto.randomUUID()
        await storePendingProviderState(
            f,
            state,
            JSON.stringify({ token: 'synthetic-long-user-token', expiresAt: 1_800_000_030_000 })
        )
        const pages = await f.flow.listPages(f.binding, state)
        expect(pages.pages.map(page => page.id)).toEqual(['456', '789'])
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
