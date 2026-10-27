import { describe, expect, it } from 'bun:test'

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

const baseURL = 'http://localhost:3000'
const secret = 'postbot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000

function createFixture() {
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
    })
    return { app, database }
}

type App = ReturnType<typeof createApp>

async function signUp(app: App, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: 'Postdot Operator',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
}

async function call(
    app: App,
    path: string,
    credential: { cookie?: string; token?: string },
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    if (credential.cookie) headers.set('cookie', credential.cookie)
    if (credential.token) headers.set('authorization', `Bearer ${credential.token}`)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    return app.handle(new Request(`${baseURL}${path}`, { ...init, headers }))
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

async function setup() {
    const fixture = createFixture()
    const cookie = await signUp(fixture.app, 'sharing@postbot.local')
    const create = async (name: string) => {
        const response = await call(fixture.app, '/api/projects', { cookie }, post({ name }))
        expect(response.status).toBe(201)
        return ((await response.json()) as { project: { id: string } }).project.id
    }
    const source = await create('Source')
    const target = await create('Target')
    const channelResponse = await call(
        fixture.app,
        `/api/projects/${source}/channels`,
        { cookie },
        post({ name: 'Shared destination' })
    )
    expect(channelResponse.status).toBe(201)
    const channel = (
        (await channelResponse.json()) as { channel: { id: string; revision: number } }
    ).channel
    const apiKey = async (body: Record<string, unknown>) => {
        const response = await call(fixture.app, '/api/api-keys', { cookie }, post(body))
        expect(response.status).toBe(201)
        return ((await response.json()) as { token: string }).token
    }
    return { ...fixture, cookie, source, target, channel, apiKey }
}

describe('shared channel HTTP routes', () => {
    it('attaches, shares, transfers management and withdraws through one session path', async () => {
        const f = await setup()
        try {
            const credential = { cookie: f.cookie }
            const before = await call(
                f.app,
                `/api/projects/${f.source}/channels/${f.channel.id}/sharing`,
                credential
            )
            expect(before.status).toBe(200)
            expect(await before.json()).toMatchObject({
                channel: { shared: false, canManage: true, canShare: true },
                usages: [{ projectId: f.source, state: 'active' }],
            })

            const attached = await call(
                f.app,
                `/api/projects/${f.source}/channels/${f.channel.id}/attachments`,
                credential,
                post({ projectId: f.target, expectedRevision: f.channel.revision })
            )
            expect(attached.status).toBe(200)
            const { revision } = (await attached.json()) as { revision: number }
            expect(revision).toBe(f.channel.revision + 1)

            // The target project now lists the channel and the sharing view reports it.
            const listed = await call(f.app, `/api/projects/${f.target}/channels`, credential)
            expect(
                ((await listed.json()) as { channels: { id: string }[] }).channels.map(c => c.id)
            ).toEqual([f.channel.id])
            const shared = await call(
                f.app,
                `/api/projects/${f.target}/channels/${f.channel.id}/sharing`,
                credential
            )
            expect(await shared.json()).toMatchObject({
                channel: { shared: true },
                usages: expect.arrayContaining([
                    expect.objectContaining({ projectId: f.source }),
                    expect.objectContaining({ projectId: f.target }),
                ]),
            })

            // A stale revision is a conflict that reports the current revision.
            const stale = await call(
                f.app,
                `/api/projects/${f.source}/channels/${f.channel.id}/management`,
                credential,
                post({ projectId: f.target, expectedRevision: f.channel.revision })
            )
            expect(stale.status).toBe(409)
            expect(await stale.json()).toMatchObject({
                error: { code: 'stale_revision', revision },
            })

            const transferred = await call(
                f.app,
                `/api/projects/${f.source}/channels/${f.channel.id}/management`,
                credential,
                post({ projectId: f.target, expectedRevision: revision })
            )
            expect(transferred.status).toBe(200)
            const transferRevision = ((await transferred.json()) as { revision: number }).revision

            const withdrawn = await call(
                f.app,
                `/api/projects/${f.target}/channels/${f.channel.id}/attachments/${f.source}/withdraw`,
                credential,
                post({ expectedRevision: transferRevision })
            )
            expect(withdrawn.status).toBe(200)
            const withdrawnRevision = ((await withdrawn.json()) as { revision: number }).revision

            // The last active project cannot leave without an explicit archive choice.
            const lastPath = `/api/projects/${f.target}/channels/${f.channel.id}/attachments/${f.target}/withdraw`
            const refused = await call(
                f.app,
                lastPath,
                credential,
                post({ expectedRevision: withdrawnRevision })
            )
            expect(refused.status).toBe(409)
            expect(await refused.json()).toMatchObject({ error: { code: 'retirement_required' } })
            const archived = await call(
                f.app,
                lastPath,
                credential,
                post({ expectedRevision: withdrawnRevision, lastAttachment: 'archive' })
            )
            expect(archived.status).toBe(200)
        } finally {
            closeDatabase(f.database)
        }
    })

    it('requires the sharing capability and scope for every affected project on a key', async () => {
        const f = await setup()
        try {
            const attach = (token: string) =>
                call(
                    f.app,
                    `/api/projects/${f.source}/channels/${f.channel.id}/attachments`,
                    { token },
                    post({ projectId: f.target, expectedRevision: f.channel.revision })
                )

            // channel:manage is a different capability: sharing is refused before any store call.
            const manageOnly = await f.apiKey({
                name: 'Manage only',
                projectIds: [f.source, f.target],
                actionAccess: ['channel:manage'],
            })
            const denied = await attach(manageOnly)
            expect(denied.status).toBe(403)
            expect(await denied.json()).toMatchObject({
                error: { code: 'insufficient_api_key_permissions' },
            })

            // Scope for the context project alone cannot reach a target outside the key.
            const sourceOnly = await f.apiKey({
                name: 'Source only',
                projectIds: [f.source],
                actionAccess: ['channel:share', 'project:read'],
            })
            expect((await attach(sourceOnly)).status).toBe(404)
            const unattached = await call(f.app, `/api/projects/${f.target}/channels`, {
                cookie: f.cookie,
            })
            expect(((await unattached.json()) as { channels: unknown[] }).channels).toEqual([])

            const both = await f.apiKey({
                name: 'Both projects',
                projectIds: [f.source, f.target],
                actionAccess: ['channel:share', 'project:read'],
            })
            const allowed = await attach(both)
            expect(allowed.status).toBe(200)
        } finally {
            closeDatabase(f.database)
        }
    })

    it('masks the channel from a caller without project access', async () => {
        const f = await setup()
        try {
            const outsider = await signUp(f.app, 'outsider-sharing@postbot.local')
            const path = `/api/projects/${f.source}/channels/${f.channel.id}`
            expect((await call(f.app, `${path}/sharing`, { cookie: outsider })).status).toBe(404)
            const attach = await call(
                f.app,
                `${path}/attachments`,
                { cookie: outsider },
                post({ projectId: f.target, expectedRevision: f.channel.revision })
            )
            expect(attach.status).toBe(404)
        } finally {
            closeDatabase(f.database)
        }
    })
})

describe('shared channel occupancy HTTP route', () => {
    it('shows other projects as anonymous time and keeps drafts and names out of the response', async () => {
        const f = await setup()
        try {
            const credential = { cookie: f.cookie }
            const attached = await call(
                f.app,
                `/api/projects/${f.source}/channels/${f.channel.id}/attachments`,
                credential,
                post({ projectId: f.target, expectedRevision: f.channel.revision })
            )
            expect(attached.status).toBe(200)
            // The app clock is fixed by the fixture, so schedule relative to it.
            const at = now + 86_400_000
            const create = (title: string, scheduledAt?: number) =>
                call(
                    f.app,
                    `/api/projects/${f.target}/posts`,
                    credential,
                    post({
                        title,
                        sourceContent: { body: { format: 'plain_text', text: title }, media: [] },
                        publications: [
                            {
                                channelId: f.channel.id,
                                deliveryMode: 'manual',
                                ...(scheduledAt === undefined ? {} : { scheduledAt }),
                            },
                        ],
                    })
                )
            expect((await create('Target confidential launch', at)).status).toBe(201)
            expect((await create('Target hidden draft')).status).toBe(201)

            const query = `from=${at - 60_000}&to=${at + 3_600_000}`
            const path = `/api/projects/${f.source}/channel-occupancy?${query}`
            // The owner can read both projects, so the target is described in full.
            const readable = await call(f.app, path, credential)
            expect(readable.status).toBe(200)
            expect(await readable.json()).toMatchObject({
                occupancy: [
                    {
                        channelId: f.channel.id,
                        at,
                        state: 'scheduled',
                        project: { id: f.target, title: 'Target confidential launch' },
                    },
                ],
            })

            // A key scoped to the source project cannot read the target: the slot stays, nothing else.
            const sourceOnly = await f.apiKey({
                name: 'Source reader',
                projectIds: [f.source],
                actionAccess: ['project:read'],
            })
            const anonymous = await call(f.app, path, { token: sourceOnly })
            expect(anonymous.status).toBe(200)
            const body = (await anonymous.json()) as { occupancy: { project: unknown }[] }
            expect(body.occupancy).toHaveLength(1)
            expect(body.occupancy[0]!.project).toBeNull()
            const text = JSON.stringify(body)
            for (const hidden of ['confidential', 'hidden draft', f.target, 'Target'])
                expect(text).not.toContain(hidden)

            // The route is read-only for keys and masks a project the caller cannot access.
            const outsider = await signUp(f.app, 'occupancy-outsider@postbot.local')
            expect((await call(f.app, path, { cookie: outsider })).status).toBe(404)
            const invalid = await call(
                f.app,
                `/api/projects/${f.source}/channel-occupancy?from=10&to=10`,
                credential
            )
            expect(invalid.status).toBe(404)
        } finally {
            closeDatabase(f.database)
        }
    })
})

it('configures cadence with live management and returns a fresh planning conflict before accepting an attributed confirmation', async () => {
    const f = await setup()
    try {
        const credential = { cookie: f.cookie }
        const path = `/api/projects/${f.source}/channels/${f.channel.id}/cadence`
        const initial = await call(f.app, path, credential)
        expect(initial.status).toBe(200)
        expect(await initial.json()).toEqual({ rules: null, canManage: true })
        const configure = (expectedRevision: number) =>
            call(f.app, path, credential, {
                method: 'PUT',
                body: JSON.stringify({
                    expectedRevision,
                    timeZone: 'Europe/Paris',
                    dailyMax: 1,
                    weeklyMax: 1,
                    minimumIntervalMs: 60000,
                }),
            })
        expect((await configure(0)).status).toBe(200)
        expect((await configure(0)).status).toBe(409)
        const at = now + 86400000
        const create = (cadenceConfirmation?: string) =>
            call(
                f.app,
                `/api/projects/${f.source}/posts`,
                credential,
                post({
                    title: 'Launch',
                    sourceContent: { body: { format: 'plain_text', text: 'Launch' }, media: [] },
                    cadenceConfirmation,
                    publications: [
                        { channelId: f.channel.id, deliveryMode: 'manual', scheduledAt: at },
                    ],
                })
            )
        expect((await create()).status).toBe(201)
        const conflict = await create()
        expect(conflict.status).toBe(409)
        const error = (
            (await conflict.json()) as { error: { confirmation: string; warnings: unknown[] } }
        ).error
        expect(error.warnings).toHaveLength(2)
        expect((await create(error.confirmation)).status).toBe(201)
        const stale = await create(error.confirmation)
        expect(stale.status).toBe(409)
        expect(
            ((await stale.json()) as { error: { confirmation: string } }).error.confirmation
        ).not.toBe(error.confirmation)
        const readKey = await f.apiKey({
            name: 'Read cadence',
            actionAccess: ['project:read'],
            projectIds: [f.source],
        })
        expect((await call(f.app, path, { token: readKey })).status).toBe(200)
        expect(
            (
                await call(
                    f.app,
                    path,
                    { token: readKey },
                    {
                        method: 'PUT',
                        body: JSON.stringify({
                            expectedRevision: 1,
                            dailyMax: null,
                            weeklyMax: null,
                            minimumIntervalMs: null,
                        }),
                    }
                )
            ).status
        ).toBe(403)
    } finally {
        closeDatabase(f.database)
    }
})

it('scopes and attributes a single spacing override independently from planning and provider admission', async () => {
    const f = await setup()
    try {
        const credential = { cookie: f.cookie }
        const created = await call(
            f.app,
            `/api/projects/${f.source}/posts`,
            credential,
            post({
                sourceContent: { body: { format: 'plain_text', text: 'Dispatch' }, media: [] },
                publications: [
                    { channelId: f.channel.id, deliveryMode: 'manual', scheduledAt: now + 1000 },
                ],
            })
        )
        expect(created.status).toBe(201)
        const publicationId = ((await created.json()) as { publications: { id: string }[] })
            .publications[0]!.id
        f.database.$client
            .query("update publications set delivery_mode='automatic' where id=?")
            .run(publicationId)
        expect(
            (
                await call(
                    f.app,
                    `/api/projects/${f.source}/channels/${f.channel.id}/cadence`,
                    credential,
                    {
                        method: 'PUT',
                        body: JSON.stringify({
                            expectedRevision: 0,
                            dailyMax: null,
                            weeklyMax: null,
                            minimumIntervalMs: 60000,
                        }),
                    }
                )
            ).status
        ).toBe(200)
        f.database.$client
            .query('update channel_cadence set last_effect_at=? where channel_id=?')
            .run(now, f.channel.id)
        const path = `/api/projects/${f.source}/publications/${publicationId}`
        const response = await call(f.app, `${path}/cadence`, credential)
        expect(response.status).toBe(200)
        const timing = (await response.json()) as {
            confirmation: string
            reason: string
            eligibleAt: number
        }
        expect(timing).toMatchObject({ reason: 'minimum_interval', eligibleAt: now + 60000 })
        const manageOnly = await f.apiKey({
            name: 'Editorial only',
            projectIds: [f.source],
            actionAccess: ['publication:manage'],
        })
        expect(
            (
                await call(
                    f.app,
                    `${path}/cadence-override`,
                    { token: manageOnly },
                    post({ confirmation: timing.confirmation })
                )
            ).status
        ).toBe(403)
        expect(
            (
                await call(
                    f.app,
                    `${path}/cadence-override`,
                    credential,
                    post({ confirmation: 'x'.repeat(64) })
                )
            ).status
        ).toBe(409)
        const approved = await call(
            f.app,
            `${path}/cadence-override`,
            credential,
            post({ confirmation: timing.confirmation })
        )
        expect(approved.status).toBe(200)
        expect(await approved.json()).toMatchObject({ reason: null, eligibleAt: now + 1000 })
        expect(
            f.database.$client
                .query(
                    "select actor_id from audit_events where action='publication.cadence_spacing_overridden'"
                )
                .all()
        ).toHaveLength(1)
        // No publisher or credential is created by an editorial exception.
        expect(f.database.$client.query('select count(*) as n from publishers').get()).toEqual({
            n: 0,
        })
    } finally {
        closeDatabase(f.database)
    }
})
