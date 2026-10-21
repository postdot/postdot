import { expect, test } from 'bun:test'

import { createAuth } from '@postdot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createManualStore,
    runMigrations,
} from '@postdot/db'
import { createMastodonAnalyticsReader, mastodonChannelProfile } from '@postdot/mastodon'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

async function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const origin = 'http://localhost:3000'
    const auth = createAuth(database, {
        baseURL: origin,
        secret: 'analytics-test-secret-with-at-least-32-characters',
        allowAdditionalSignups: true,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: origin,
        webOrigin: origin,
        publisherEncryptionKey: new Uint8Array(32).fill(7),
        publisherEncryptionKeyId: 'test',
    })
    const access = createAccessStore(database)
    let calls = 0
    let mode: 'available' | 'failure' = 'available'
    let beforeReturn: (() => void) | undefined
    const requests: { url: string; init?: RequestInit }[] = []
    let clock = 1_800_000_000_000
    const reader = createMastodonAnalyticsReader({
        fetcher: async (input, init) => {
            calls++
            requests.push({ url: String(input), init })
            beforeReturn?.()
            if (mode === 'failure') return new Response('', { status: 503 })
            return Response.json({
                id: '100',
                uri: 'https://original.example/users/owner/statuses/100',
                url: 'https://original.example/@owner/100',
                visibility: 'public',
                reblog: null,
                favourites_count: 0,
                reblogs_count: 4,
                replies_count: null,
            })
        },
    })
    const app = createApp({
        database,
        auth,
        publisher,
        access,
        mastodonAnalyticsReader: reader,
        manualStore: { now: () => ++clock },
    })
    async function request(path: string, cookie = '', method = 'GET', data?: unknown) {
        return app.handle(
            new Request(origin + path, {
                method,
                headers: {
                    origin,
                    cookie,
                    ...(data === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            })
        )
    }
    async function signup(email: string) {
        const response = await request('/api/auth/sign-up/email', '', 'POST', {
            name: 'Analytics member',
            email,
            password: 'analytics-fixture-password',
        })
        expect(response.status).toBe(200)
        return {
            cookie: response.headers.get('set-cookie')!.split(';')[0]!,
            id: ((await response.json()) as { user: { id: string } }).user.id,
        }
    }
    const owner = await signup('analytics-owner@postbot.local')
    const made = await request('/api/projects', owner.cookie, 'POST', { name: 'Metrics' })
    expect(made.status).toBe(201)
    const { project } = (await made.json()) as { project: { id: string } }
    const manual = createManualStore(database)
    const channel = manual.createChannel({
        projectId: project.id,
        subjectId: owner.id,
        name: 'Mastodon',
        profile: mastodonChannelProfile,
    })!
    const post = manual.createPost({
        projectId: project.id,
        subjectId: owner.id,
        sourceContent: { body: { format: 'plain_text', text: 'Source' }, media: [] },
        publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
    })!
    const publicationId = post.publications[0]!.id
    const editor = manual.getPublicationEditorState(project.id, publicationId, owner.id)!
    manual.promotePublicationDraft({
        projectId: project.id,
        publicationId,
        subjectId: owner.id,
        expectedRevision: editor.draft.revision,
        scheduledAt: clock + 1000,
    })
    // Seed a retained delivered receipt in this isolated DB; never send a real status.
    database.$client
        .query(
            "update publications set state = 'published', external_id = '100', external_url = 'https://original.example/@owner/100', published_at = ?1, published_by_actor_id = created_by_actor_id where id = ?2"
        )
        .run(clock, publicationId)
    return {
        database,
        access,
        owner,
        projectId: project.id,
        publicationId,
        channelId: channel.id,
        request,
        signup,
        path: `/api/projects/${project.id}/analytics/provider/mastodon`,
        body: { channelId: channel.id, publicationId },
        get calls() {
            return calls
        },
        requests,
        fail() {
            mode = 'failure'
        },
        duringRead(callback: () => void) {
            beforeReturn = callback
        },
    }
}

test('Mastodon metrics are collected manually and persisted with real zero, unknown counters and original-instance identity', async () => {
    const f = await fixture()
    try {
        const query = `?publicationIds=${encodeURIComponent(f.publicationId)}`
        const empty = await f.request(f.path + '/latest' + query, f.owner.cookie)
        expect(empty.status).toBe(200)
        expect(((await empty.json()) as { observations: unknown[] }).observations).toEqual([])
        expect(f.calls).toBe(0)
        const response = await f.request(f.path + '/collect', f.owner.cookie, 'POST', f.body)
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            observations: {
                metricName: string
                value: number | null
                availability: string
                providerSubjectId: string
            }[]
        }
        expect(body.observations).toHaveLength(3)
        expect(body.observations.find(row => row.metricName === 'favourites_count')).toMatchObject({
            value: 0,
            availability: 'measured',
            providerSubjectId: 'https://original.example/api/v1/statuses/100',
        })
        expect(body.observations.find(row => row.metricName === 'reblogs_count')).toMatchObject({
            value: 4,
            availability: 'measured',
        })
        expect(body.observations.find(row => row.metricName === 'replies_count')).toMatchObject({
            value: null,
            availability: 'not_reported',
        })
        expect(f.requests[0]!.url).toBe('https://original.example/api/v1/statuses/100')
        expect(f.requests[0]!.init?.redirect).toBe('error')
        expect(new Headers(f.requests[0]!.init?.headers).has('authorization')).toBe(false)
        const stored = await f.request(f.path + '/latest' + query, f.owner.cookie)
        const storedObservations = ((await stored.json()) as { observations: unknown[] })
            .observations
        expect(storedObservations).toHaveLength(body.observations.length)
        expect(storedObservations).toEqual(expect.arrayContaining(body.observations))
        expect((await f.request(f.path, f.owner.cookie)).status).toBe(200)
        expect(f.calls).toBe(1)
        f.fail()
        const failed = await f.request(f.path + '/collect', f.owner.cookie, 'POST', f.body)
        expect(failed.status).toBe(200)
        const failure = (await failed.json()) as {
            observations: { value: number | null; availability: string }[]
        }
        expect(
            failure.observations.every(
                row => row.value === null && row.availability === 'temporarily_unavailable'
            )
        ).toBe(true)
        expect(
            f.database.$client
                .query('select count(*) as count from provider_analytics_observations')
                .get()
        ).toEqual({ count: 6 })
    } finally {
        closeDatabase(f.database)
    }
})

test('Mastodon metrics enforce project roles and recheck access after an asynchronous provider read', async () => {
    const f = await fixture()
    try {
        const viewer = await f.signup('analytics-viewer@postbot.local')
        f.access.updateInstanceMembership({
            actorUserId: f.owner.id,
            userId: viewer.id,
            role: 'member',
        })
        f.access.grantProjectUserAccess({
            projectId: f.projectId,
            userId: viewer.id,
            role: 'viewer',
        })
        expect((await f.request(f.path, viewer.cookie)).status).toBe(200)
        expect((await f.request(f.path + '/collect', viewer.cookie, 'POST', f.body)).status).toBe(
            403
        )
        expect((await f.request(f.path, '')).status).toBe(401)
        expect(
            (await f.request(f.path.replace(f.projectId, 'foreign-project'), viewer.cookie)).status
        ).toBe(404)
        expect(
            (
                await f.request(f.path + '/collect', f.owner.cookie, 'POST', {
                    ...f.body,
                    channelId: 'foreign-channel',
                })
            ).status
        ).toBe(404)
        expect(f.calls).toBe(0)
        f.access.grantProjectUserAccess({
            projectId: f.projectId,
            userId: viewer.id,
            role: 'editor',
        })
        f.duringRead(() => {
            f.access.grantProjectUserAccess({
                projectId: f.projectId,
                userId: viewer.id,
                role: 'viewer',
            })
        })
        expect((await f.request(f.path + '/collect', viewer.cookie, 'POST', f.body)).status).toBe(
            404
        )
        expect(f.calls).toBe(1)
        expect(
            f.database.$client
                .query('select count(*) as count from provider_analytics_observations')
                .get()
        ).toEqual({ count: 0 })
    } finally {
        closeDatabase(f.database)
    }
})

test('Mastodon metrics never attach an in-flight response to a changed provider receipt', async () => {
    const f = await fixture()
    try {
        f.duringRead(() => {
            f.database.$client
                .query('update publications set external_url = ?1 where id = ?2')
                .run('https://different.example/@owner/100', f.publicationId)
        })
        expect((await f.request(f.path + '/collect', f.owner.cookie, 'POST', f.body)).status).toBe(
            404
        )
        expect(
            f.database.$client
                .query('select count(*) as count from provider_analytics_observations')
                .get()
        ).toEqual({ count: 0 })
    } finally {
        closeDatabase(f.database)
    }
})
