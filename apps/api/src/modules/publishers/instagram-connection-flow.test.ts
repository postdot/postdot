import { expect, test } from 'bun:test'

import {
    closeDatabase,
    createDatabase,
    runMigrations,
    createManualStore,
    createAuthorizationAttemptStore,
    createProviderApplicationStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    createPublisherStore,
    createSecretCipher,
} from '@postdot/db'
import {
    INSTAGRAM_PUBLISH_PERMISSIONS,
    instagramChannelProfile,
    type createInstagramOAuth,
} from '@postdot/instagram'

import { createInstagramConnectionFlow } from '../../providers/instagram/connection-flow'
import { instagramPublisherConnectionPolicy } from '../../providers/instagram/connection-policy'
import { providerApplicationPolicies } from '../../providers/registry'

const callbackUri = 'https://postbot.example/api/oauth/instagram/callback'
const professionalAccountId = '987654321'
const appScopedAccountId = '111222333'
const accessToken = 'synthetic-instagram-token'
const issuedAt = 1_800_000_000_000

async function fixture(
    options: {
        readonly expiresInSeconds?: number | null
        readonly scopes?: readonly string[]
    } = {}
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let timestamp = issuedAt
    let editor = true
    let exchanges = 0
    let duringExchange: (() => void | Promise<void>) | null = null
    let duringApplicationCheck: (() => void) | undefined
    const now = () => timestamp
    database.$client
        .query(
            'insert into "user" (id, name, email, email_verified, created_at, updated_at) values (?1, ?2, ?3, 1, ?4, ?4)'
        )
        .run('owner', 'Owner', 'owner@example.test', timestamp)
    const key = new Uint8Array(32).fill(5)
    const applications = createProviderApplicationStore(database, {
        policies: providerApplicationPolicies,
        cipher: createSecretCipher({
            domain: 'postbot.provider-application',
            keyId: 'test',
            key,
        }),
        now,
    })
    const channels = createManualStore(database, { now })
    const project = channels.createProject({
        name: 'Test',
        subjectId: 'owner',
        displayName: 'Owner',
    })
    const channel = channels.createChannel({
        projectId: project.project.id,
        subjectId: 'owner',
        name: 'Instagram',
        profile: instagramChannelProfile,
    })!
    const cipher = createPublisherCredentialCipher({ keyId: 'test', key })
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
        connectionPolicies: { instagram: instagramPublisherConnectionPolicy },
    })
    const application = await (async () => {
        const saved = await applications.createProviderApplication({
            providerId: 'instagram',
            name: 'Instagram',
            clientId: '123456789',
            clientSecret: 'synthetic-instagram-secret',
            createdByUserId: 'owner',
        })
        if (saved.kind !== 'created') throw new Error('application was not created')
        return saved.configuration
    })()
    // The provider protocol is owned by the Instagram package. The connection
    // flow is exercised against a prepared provider result.
    const oauth = {
        clientId: '123456789',
        callbackUri,
        async createAuthorizationRequest() {
            const state = crypto.randomUUID() + crypto.randomUUID()
            return {
                url: new URL(
                    `https://www.instagram.com/oauth/authorize?client_id=123456789&state=${state}`
                ),
                state,
                codeVerifier: null,
                callbackUri,
                scopes: INSTAGRAM_PUBLISH_PERMISSIONS,
            }
        },
        async complete() {
            exchanges++
            if (duringExchange) await duringExchange()
            return {
                tokens: {
                    accessToken,
                    refreshToken: null,
                    expiresInSeconds:
                        options.expiresInSeconds === undefined ? 3600 : options.expiresInSeconds,
                    scopes: options.scopes ?? INSTAGRAM_PUBLISH_PERMISSIONS,
                    tokenType: 'bearer',
                },
                account: {
                    id: professionalAccountId,
                    appScopedId: appScopedAccountId,
                    username: 'postbot.studio',
                    accountType: 'BUSINESS',
                },
            }
        },
    } as unknown as ReturnType<typeof createInstagramOAuth>
    const flowFor = (issuingApplicationId: string) =>
        createInstagramConnectionFlow({
            attempts,
            credentials,
            publishers,
            channels,
            access: { canAccessProject: () => editor },
            oauth,
            applicationId: issuingApplicationId,
            applicationAvailable: async () => {
                const available = await applications.resolveProviderApplication(
                    'instagram',
                    issuingApplicationId
                )
                duringApplicationCheck?.()
                return available !== null
            },
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
    return {
        database,
        channels,
        credentials,
        publishers,
        applications,
        application,
        flow: flowFor(application.id),
        flowFor,
        binding,
        callback,
        get exchanges() {
            return exchanges
        },
        connection() {
            return publishers.getPublisherConnection(
                binding.projectId,
                binding.channelId,
                binding.subjectId
            )
        },
        storedCredentials() {
            return credentials.listPublisherCredentials(binding.projectId)
        },
        advance(milliseconds = 60_001) {
            timestamp += milliseconds
        },
        duringApplicationCheck(callback: () => void) {
            duringApplicationCheck = callback
        },
        setViewer() {
            editor = false
        },
        duringExchange(action: () => void | Promise<void>) {
            duringExchange = action
        },
    }
}

/** Connects another account to the same channel while a provider exchange runs. */
async function connectAnotherAccount(
    f: Awaited<ReturnType<typeof fixture>>,
    input: { readonly accountId: string; readonly reconnectable?: boolean }
) {
    const actorId = f.publishers.getProjectActorId(f.binding.projectId, f.binding.subjectId)
    if (!actorId) throw new Error('no actor')
    const saved = await f.credentials.createPublisherCredential({
        projectId: f.binding.projectId,
        connectedByActorId: actorId,
        providerId: 'instagram',
        providerApplicationId: f.application.id,
        externalAccountId: input.accountId,
        externalAccountName: 'other.account',
        scopes: INSTAGRAM_PUBLISH_PERMISSIONS,
        accessToken: 'other-token',
        refreshToken: null,
        expiresAt: null,
    })
    if (saved.kind !== 'created') throw new Error('credential was not created')
    const connected = f.publishers.createPublisherConnection({
        projectId: f.binding.projectId,
        channelId: f.binding.channelId,
        subjectId: f.binding.subjectId,
        kind: 'instagram',
        credentialId: saved.credential.id,
        destination: { type: 'account', id: input.accountId, name: 'other.account' },
    })
    if (connected.kind !== 'created') throw new Error('connection was not created')
    if (input.reconnectable === true) {
        f.credentials.markPublisherCredentialReconnectRequired(
            f.binding.projectId,
            saved.credential.id
        )
    }
}

test('the callback connects the professional account under its issuing application', async () => {
    const f = await fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        const result = await f.flow.complete(f.binding, f.callback(url))
        expect(result.returnPath).toBe('/dashboard/channels')
        expect(result.connection.destination).toEqual({
            type: 'account',
            id: professionalAccountId,
            name: 'postbot.studio',
        })
        expect(result.connection.externalAccountId).toBe(professionalAccountId)
        expect(JSON.stringify(result)).not.toContain(accessToken)
        const stored = f.storedCredentials()
        expect(stored).toHaveLength(1)
        expect(stored[0]!.externalAccountId).toBe(professionalAccountId)
        expect(stored[0]!.providerApplicationId).toBe(f.application.id)
        expect(stored[0]!.scopes).toEqual([...INSTAGRAM_PUBLISH_PERMISSIONS].sort())
        expect(stored[0]!.expiresAt).toBe(issuedAt + 3600 * 1000)
        const secrets = await f.credentials.resolvePublisherCredentialSecrets(
            f.binding.projectId,
            stored[0]!.id
        )
        expect(secrets!.accessToken).toBe(accessToken)
        expect(secrets!.refreshToken).toBeNull()
        expect(JSON.parse(secrets!.providerSession!)).toEqual({
            version: 1,
            issuedAt,
            appScopedId: appScopedAccountId,
            accountType: 'BUSINESS',
        })
        const sealed = f.database.$client
            .query<{ ciphertext: Uint8Array | null }, []>(
                'select provider_session_ciphertext as ciphertext from publisher_credentials'
            )
            .all()
        expect(sealed).toHaveLength(1)
        expect(new TextDecoder().decode(sealed[0]!.ciphertext!)).not.toContain(appScopedAccountId)
        expect(
            JSON.stringify(f.database.$client.query('select * from publisher_credentials').all())
        ).not.toContain(accessToken)
    } finally {
        closeDatabase(f.database)
    }
})

test('a replayed callback state is refused before the provider code is exchanged again', async () => {
    const f = await fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        const parameters = f.callback(url)
        await f.flow.complete(f.binding, parameters)
        const before = f.exchanges
        await expect(f.flow.complete(f.binding, parameters)).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.exchanges).toBe(before)
    } finally {
        closeDatabase(f.database)
    }
})

test('an expired attempt is refused before the provider code is exchanged', async () => {
    const f = await fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        f.advance()
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'invalid_attempt',
        })
        expect(f.exchanges).toBe(0)
        expect(f.storedCredentials()).toHaveLength(0)
        expect(f.connection()).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})

test('a callback bound to another channel, project, actor or application is refused', async () => {
    const f = await fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        const parameters = f.callback(url)
        const other = f.channels.createChannel({
            projectId: f.binding.projectId,
            subjectId: 'owner',
            name: 'Other',
            profile: instagramChannelProfile,
        })!
        await expect(
            f.flow.complete({ ...f.binding, channelId: other.id }, parameters)
        ).rejects.toMatchObject({ code: 'invalid_attempt' })
        const project = f.channels.createProject({
            name: 'Other project',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        const channel = f.channels.createChannel({
            projectId: project.project.id,
            subjectId: 'owner',
            name: 'Instagram',
            profile: instagramChannelProfile,
        })!
        await expect(
            f.flow.complete(
                { ...f.binding, projectId: project.project.id, channelId: channel.id },
                parameters
            )
        ).rejects.toMatchObject({ code: 'invalid_attempt' })
        await expect(
            f.flow.complete({ ...f.binding, subjectId: 'stranger' }, parameters)
        ).rejects.toMatchObject({ code: 'not_found' })
        const otherApplication = await f.applications.createProviderApplication({
            providerId: 'instagram',
            name: 'Other Instagram',
            clientId: '987654321',
            clientSecret: 'other-instagram-secret',
            createdByUserId: 'owner',
        })
        if (otherApplication.kind !== 'created') throw new Error('application was not created')
        await expect(
            f.flowFor(otherApplication.configuration.id).complete(f.binding, parameters)
        ).rejects.toMatchObject({ code: 'invalid_attempt' })
        expect(f.exchanges).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('losing editor access while the provider exchange runs stores no connection', async () => {
    const f = await fixture()
    try {
        f.duringExchange(() => f.setViewer())
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'forbidden',
        })
        expect(f.storedCredentials()).toHaveLength(0)
        expect(f.connection()).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})

test('a disabled issuing application stops the connection after the provider exchange', async () => {
    const f = await fixture()
    try {
        f.duringExchange(async () => {
            const disabled = await f.applications.updateProviderApplication({
                id: f.application.id,
                state: 'disabled',
            })
            expect(disabled.kind).toBe('updated')
        })
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(f.storedCredentials()).toHaveLength(0)
        expect(f.connection()).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})

test('a connection made while the provider exchange runs is not overwritten', async () => {
    const f = await fixture()
    try {
        f.duringExchange(() => connectAnotherAccount(f, { accountId: '555000111' }))
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'conflict',
        })
        expect(f.connection()?.destination?.id).toBe('555000111')
    } finally {
        closeDatabase(f.database)
    }
})

test('a connection made after the authorization started is reported instead of replaced', async () => {
    const f = await fixture()
    try {
        f.duringExchange(() =>
            connectAnotherAccount(f, { accountId: '555000111', reconnectable: true })
        )
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'conflict',
        })
        expect(f.connection()?.destination?.id).toBe('555000111')
        const stored = f.storedCredentials()
        expect(stored).toHaveLength(2)
        expect(
            stored.find(credential => credential.externalAccountId === professionalAccountId)!.state
        ).toBe('revoked')
    } finally {
        closeDatabase(f.database)
    }
})

test('a reconnectable connection is replaced by the identity pinned at the start', async () => {
    const f = await fixture()
    try {
        const first = await f.flow.start(f.binding, '/dashboard/channels')
        await f.flow.complete(f.binding, f.callback(first.url))
        const credential = f.storedCredentials()[0]!
        f.credentials.markPublisherCredentialReconnectRequired(f.binding.projectId, credential.id)
        expect(f.connection()?.state).toBe('reconnect_required')
        const second = await f.flow.start(f.binding, '/dashboard/channels')
        const result = await f.flow.complete(f.binding, f.callback(second.url))
        expect(result.connection.state).toBe('active')
        expect(f.storedCredentials()).toHaveLength(1)
        expect(f.storedCredentials()[0]!.state).toBe('active')
    } finally {
        closeDatabase(f.database)
    }
})

test('two concurrent authorizations keep a single connection', async () => {
    const f = await fixture()
    try {
        const first = await f.flow.start(f.binding, '/dashboard/channels')
        const second = await f.flow.start(f.binding, '/dashboard/channels')
        const results = await Promise.allSettled([
            f.flow.complete(f.binding, f.callback(first.url)),
            f.flow.complete(f.binding, f.callback(second.url)),
        ])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
        expect(f.database.$client.query('select * from publisher_connections').all()).toHaveLength(
            1
        )
        expect(f.storedCredentials()).toHaveLength(1)
    } finally {
        closeDatabase(f.database)
    }
})

test('an unknown provider lifetime is refused instead of being replaced by a default', async () => {
    for (const expiresInSeconds of [null, 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
        const f = await fixture({ expiresInSeconds: expiresInSeconds as number | null })
        try {
            const { url } = await f.flow.start(f.binding, '/dashboard/channels')
            await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
                code: 'provider_unavailable',
            })
            expect(f.storedCredentials()).toHaveLength(0)
            expect(f.connection()).toBeNull()
        } finally {
            closeDatabase(f.database)
        }
    }
})

test('a missing publishing scope is refused', async () => {
    const f = await fixture({ scopes: [INSTAGRAM_PUBLISH_PERMISSIONS[0]] })
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(f.storedCredentials()).toHaveLength(0)
        expect(f.connection()).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})

test('a manual channel cannot be connected through the Instagram flow', async () => {
    const f = await fixture()
    try {
        const manual = f.channels.createChannel({
            projectId: f.binding.projectId,
            subjectId: 'owner',
            name: 'Manual',
        })!
        await expect(
            f.flow.start({ ...f.binding, channelId: manual.id }, '/dashboard/channels')
        ).rejects.toMatchObject({ code: 'conflict' })
        expect(f.exchanges).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

test('editor access is rechecked after the asynchronous application lookup before saving a credential', async () => {
    const f = await fixture()
    try {
        const { url } = await f.flow.start(f.binding, '/dashboard/channels')
        f.duringApplicationCheck(() => f.setViewer())
        await expect(f.flow.complete(f.binding, f.callback(url))).rejects.toMatchObject({
            code: 'forbidden',
        })
        expect(f.storedCredentials()).toHaveLength(0)
        expect(f.connection()).toBeNull()
    } finally {
        closeDatabase(f.database)
    }
})
