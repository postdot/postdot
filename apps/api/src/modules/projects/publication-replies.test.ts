import { expect, test } from 'bun:test'

import type { ComAtprotoRepoCreateRecord } from '@atproto/api'
import { createAuth } from '@postdot/auth'
import { blueskyChannelProfile, type restoreBlueskySession } from '@postdot/bluesky'
import {
    createAccessStore,
    createDatabase,
    createManualStore,
    runMigrations,
    closeDatabase,
} from '@postdot/db'
import { mastodonChannelProfile } from '@postdot/mastodon'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { createBuiltInProviderRegistry } from '../workflow/providers/registry'
import { createPublicationWorker } from '../workflow/worker'
import type { PublicationRepliesResponse } from './publication-replies-routes'
import { createPublicationRepliesService } from './publication-replies-service'

async function fixture(production = false, provider: 'bluesky' | 'mastodon' = 'bluesky') {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const baseURL = 'http://localhost:3000'
    const auth = createAuth(database, {
        baseURL,
        secret: 'reply-fixture-secret-which-is-long-enough',
        allowAdditionalSignups: true,
    })
    const effects: string[] = []
    let mode: 'success' | 'failed' | 'throw' = 'success'
    let permission = true
    let beforeContext: (() => void) | undefined
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(1),
        publisherEncryptionKeyId: 'test',
        mastodon: {
            fetcher: async (url, init) => {
                const path = new URL(String(url)).pathname
                if (path === '/oauth/token') {
                    const body = init!.body as URLSearchParams
                    expect(body.get('grant_type')).toBe('refresh_token')
                    expect(body.get('refresh_token')).toBe('synthetic-refresh-token')
                    return Response.json({
                        access_token: 'synthetic-new-token',
                        refresh_token: 'synthetic-rotated-token',
                        token_type: 'Bearer',
                        expires_in: 3600,
                    })
                }
                if (path === '/api/v1/statuses') {
                    const form = init!.body as URLSearchParams
                    const key = new Headers(init?.headers).get('idempotency-key')!
                    expect(key).toStartWith('reply:')
                    effects.push(key.slice('reply:'.length))
                    expect(form.get('in_reply_to_id')).toBe('200')
                    expect(form.get('visibility')).toBe('unlisted')
                    if (mode === 'throw') throw new Error('secret diagnostic')
                    if (mode === 'failed')
                        return Response.json({ error: 'Forbidden' }, { status: 403 })
                    return Response.json({
                        id: '300',
                        url: 'https://social.example/@owner/300',
                        account: { id: '10' },
                        in_reply_to_id: '200',
                        visibility: 'unlisted',
                    })
                }
                if (path.endsWith('verify_credentials'))
                    return Response.json({ id: permission ? '10' : '99' })
                if (path.endsWith('/context')) {
                    beforeContext?.()
                    return Response.json({ ancestors: [{ id: '100' }] })
                }
                return Response.json(
                    path.endsWith('/100')
                        ? { id: '100', account: { id: '10' }, visibility: 'public' }
                        : { id: '200', visibility: 'unlisted' }
                )
            },
        },
        bluesky: {
            clientMetadataUrl: 'https://postbot.example/client-metadata.json',
            handleResolver: 'https://resolver.example',
        },
    })
    const serialized = JSON.stringify({
        tokenSet: {
            sub: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
            access_token: 'synthetic-refreshed-token',
            scope: 'atproto repo:app.bsky.feed.post?action=create',
            expires_at: '2027-10-20T10:00:00.000Z',
        },
    })
    const restore = (async () => ({
        session: {
            did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
            async getTokenInfo() {
                return {
                    scope: permission ? 'atproto repo:app.bsky.feed.post?action=create' : 'atproto',
                }
            },
            async fetchHandler(_url: string, init: RequestInit) {
                const body = (await new Response(
                    init.body
                ).json()) as ComAtprotoRepoCreateRecord.InputSchema
                effects.push(body.rkey!)
                expect(body.record).toMatchObject({
                    reply: {
                        parent: {
                            uri: 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/app.bsky.feed.post/comment',
                        },
                    },
                })
                // cspell:disable-next-line
                return Response.json({
                    uri: `at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/${body.rkey}`,
                    // cspell:disable-next-line
                    cid: 'bafyreiecx6dujwoeqpdzl27w67z4h46hyklk3an4i4cvvmioaqb2qbyo5u',
                })
            },
        },
        getSerializedSession: () => serialized,
    })) as unknown as typeof restoreBlueskySession
    const service = createPublicationRepliesService({
        database,
        publisher,
        restoreSession: production ? restore : undefined,
        contextFetcher: async () => {
            beforeContext?.()
            // cspell:disable-next-line
            const cid = 'bafyreiecx6dujwoeqpdzl27w67z4h46hyklk3an4i4cvvmioaqb2qbyo5u'
            const root = {
                uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/root',
                cid,
            }
            return Response.json({
                posts: [
                    { ...root, record: {} },
                    {
                        uri: 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/app.bsky.feed.post/comment',
                        cid,
                        record: { reply: { root } },
                    },
                ],
            })
        },
        performReply: production
            ? undefined
            : async work => {
                  expect(service.store.get(work.id)?.effectStartedAt).not.toBeNull()
                  effects.push(work.id)
                  if (mode === 'throw') throw new Error('secret diagnostic')
                  if (mode === 'failed')
                      return {
                          type: 'permanent_failure',
                          effectOccurred: false,
                          errorMessage: 'Reply permission denied',
                      }
                  return {
                      type: 'published',
                      externalId: `at://${work.accountId}/app.bsky.feed.post/${work.recordKey}`,
                      externalUrl: `https://bsky.app/profile/${work.accountId}/post/${work.recordKey}`,
                  }
              },
    })
    const worker = createPublicationWorker({
        database,
        publisherStore: publisher.publisherStore,
        publisherCredentialStore: publisher.credentialStore,
        builtInProviderRegistry: createBuiltInProviderRegistry([]),
        replies: service,
    })
    const app = createApp({
        auth,
        database,
        publisher,
        publicationReplies: service,
        allowAdditionalSignups: true,
    })
    async function request(path: string, cookie: string, body?: unknown) {
        return app.handle(
            new Request(baseURL + path, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    cookie,
                    origin: baseURL,
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    }
    async function signup(email: string) {
        const response = await request('/api/auth/sign-up/email', '', {
            email,
            name: 'Reply operator',
            password: 'reply-fixture-password',
        })
        expect(response.status).toBe(200)
        return {
            id: ((await response.json()) as { user: { id: string } }).user.id,
            cookie: response.headers.get('set-cookie')!.split(';')[0]!,
        }
    }
    const owner = await signup('reply-owner@postbot.local')
    const made = await request('/api/projects', owner.cookie, {
        name: 'Reply project',
        timeZone: 'UTC',
    })
    const { project } = (await made.json()) as { project: { id: string } }
    const manual = createManualStore(database)
    const channel = manual.createChannel({
        projectId: project.id,
        subjectId: owner.id,
        name: 'Bluesky',
        profile: provider === 'bluesky' ? blueskyChannelProfile : mastodonChannelProfile,
    })!
    const created = manual.createPost({
        projectId: project.id,
        subjectId: owner.id,
        sourceContent: { body: { format: 'plain_text', text: 'Source' }, media: [] },
        publications: [{ channelId: channel.id, deliveryMode: 'manual' }],
    })!
    const publicationId = created.publications[0]!.id
    const editor = manual.getPublicationEditorState(project.id, publicationId, owner.id)!
    manual.promotePublicationDraft({
        projectId: project.id,
        publicationId,
        subjectId: owner.id,
        expectedRevision: editor.draft.revision,
        scheduledAt: Date.now() + 1000,
    })
    const rootUri =
            provider === 'mastodon'
                ? 'https://social.example/api/v1/statuses/100'
                : 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/root',
        parentUri =
            provider === 'mastodon'
                ? 'https://social.example/api/v1/statuses/200'
                : 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/app.bsky.feed.post/comment'
    database.$client
        .query(
            "update publications set state = 'published', external_id = ?1, published_at = ?2, published_by_actor_id = created_by_actor_id where id = ?3"
        )
        .run(provider === 'mastodon' ? '100' : rootUri, Date.now(), publicationId)
    if (provider === 'mastodon')
        database.$client
            .query('update publications set external_url = ?1 where id = ?2')
            .run('https://social.example/@owner/100', publicationId)
    const actorId = publisher.publisherStore.getProjectActorId(project.id, owner.id)!
    const credential = await publisher.credentialStore.createPublisherCredential({
        projectId: project.id,
        connectedByActorId: actorId,
        providerId: provider,
        scopes: provider === 'mastodon' ? ['read:accounts', 'write:statuses'] : [],
        externalAccountId: provider === 'mastodon' ? '10' : 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
        externalAccountName: 'owner.test',
        accessToken: 'synthetic-reply-access-token',
        refreshToken: provider === 'mastodon' ? 'synthetic-refresh-token' : undefined,
        providerSession: JSON.stringify(
            provider === 'mastodon'
                ? {
                      version: 1,
                      instanceUrl: 'https://social.example',
                      clientId: 'test-client',
                      clientSecret: 'test-secret',
                  }
                : {
                      tokenSet: {
                          sub: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
                          access_token: 'synthetic-old-token',
                      },
                  }
        ),
        expiresAt: null,
    })
    if (credential.kind !== 'created') throw new Error('Fixture credential was not created')
    expect(
        publisher.publisherStore.createPublisherConnection({
            projectId: project.id,
            channelId: channel.id,
            subjectId: owner.id,
            kind: provider,
            ...(provider === 'mastodon' ? { endpointUrl: 'https://social.example' } : {}),
            credentialId: credential.credential.id,
        }).kind
    ).toBe('created')
    database.$client
        .query(
            'insert into publication_comment_snapshots (project_id, publication_id, root_uri, snapshot_json, last_attempt_at) values (?1,?2,?3,?4,?5)'
        )
        .run(
            project.id,
            publicationId,
            rootUri,
            JSON.stringify({
                rootUri,
                fetchedAt: Date.now(),
                availability: 'available',
                truncated: false,
                comments: [
                    {
                        id: parentUri,
                        parentUri: rootUri,
                        depth: 0,
                        availability: 'available',
                        authorDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb',
                        authorHandle: 'reader.test',
                        text: 'Question',
                        createdAt: Date.now(),
                        externalUrl: null,
                    },
                ],
            }),
            Date.now()
        )
    const path = `/api/projects/${project.id}/publications/${publicationId}/comments/replies`
    const body = () => ({ requestId: crypto.randomUUID(), parentUri, text: 'Public reply' })
    return {
        database,
        service,
        worker,
        request,
        signup,
        owner,
        project,
        path,
        body,
        effects,
        setPermission(value: boolean) {
            permission = value
        },
        beforeContext(callback: () => void) {
            beforeContext = callback
        },
        publisher,
        credentialId: credential.credential.id,
        setMode(value: typeof mode) {
            mode = value
        },
    }
}

for (const provider of ['bluesky', 'mastodon'] as const) {
    test('queues one idempotent request, dispatches it through the singleton worker and exposes team history', async () => {
        const f = await fixture(provider === 'mastodon', provider)
        try {
            const body = f.body()
            for (let i = 0; i < 2; i++)
                expect((await f.request(f.path, f.owner.cookie, body)).status).toBe(200)
            expect(f.effects).toHaveLength(0)
            expect(await (await f.request(f.path, f.owner.cookie)).json()).toMatchObject({
                canReply: true,
                replies: [{ id: body.requestId, state: 'pending' }],
            })
            expect(f.worker.scheduler.state).not.toBe('started')
            await f.worker.processDueEvents(Date.now())
            expect(f.effects).toEqual([body.requestId])
            expect(await (await f.request(f.path, f.owner.cookie)).json()).toMatchObject({
                replies: [{ state: 'sent', text: body.text }],
            })
            await f.worker.processDueEvents(Date.now())
            expect(f.effects).toHaveLength(1)
            expect(
                (await f.request(f.path, f.owner.cookie, { ...body, text: 'Different' })).status
            ).toBe(409)
            expect(
                (
                    await f.request(f.path, f.owner.cookie, {
                        ...f.body(),
                        parentUri: 'at://did:plc:foreign/app.bsky.feed.post/other',
                    })
                ).status
            ).toBe(409)
            const viewer = await f.signup('reply-viewer@postbot.local')
            await f.request('/api/projects', viewer.cookie)
            const access = createAccessStore(f.database)
            access.updateInstanceMembership({
                actorUserId: f.owner.id,
                userId: viewer.id,
                role: 'member',
            })
            access.grantProjectUserAccess({
                projectId: f.project.id,
                userId: viewer.id,
                role: 'viewer',
            })
            expect(await (await f.request(f.path, viewer.cookie)).json()).toMatchObject({
                canReply: false,
                replies: [{ state: 'sent' }],
            })
            expect((await f.request(f.path, viewer.cookie, f.body())).status).toBe(403)
            expect(
                (await f.request(f.path.replace(f.project.id, 'foreign-project'), viewer.cookie))
                    .status
            ).toBe(404)
            expect((await f.request(f.path, '')).status).toBe(401)
            expect(
                f.database.$client
                    .query<{ count: number }, []>(
                        "select count(*) as count from audit_events where action like 'publication_reply.%'"
                    )
                    .get()?.count
            ).toBe(3)
        } finally {
            await f.worker.stop()
            closeDatabase(f.database)
        }
    })
    test('records known failures and uncertain writes without automatic resends or raw errors', async () => {
        const f = await fixture(provider === 'mastodon', provider)
        try {
            f.setMode('failed')
            await f.request(f.path, f.owner.cookie, f.body())
            await f.worker.processDueEvents(Date.now())
            f.setMode('throw')
            await f.request(f.path, f.owner.cookie, f.body())
            await f.worker.processDueEvents(Date.now())
            const result = (await (
                await f.request(f.path, f.owner.cookie)
            ).json()) as PublicationRepliesResponse
            expect(result.replies.map((reply: { state: string }) => reply.state)).toEqual([
                'ambiguous',
                'failed',
            ])
            expect(JSON.stringify(result)).not.toContain('secret diagnostic')
            await f.worker.processDueEvents(Date.now())
            expect(f.effects).toHaveLength(2)
        } finally {
            await f.worker.stop()
            closeDatabase(f.database)
        }
    })
    test('recovers pre-effect claims, quarantines interrupted effects and refuses stale completions', async () => {
        const f = await fixture(provider === 'mastodon', provider)
        try {
            const body = f.body()
            await f.request(f.path, f.owner.cookie, body)
            const at = Date.now()
            f.service.store.deliveries.claimNextDueJob({
                actorId: 'test-worker',
                claimToken: 'old',
                now: at,
                leaseExpiresAt: at + 10,
            })
            expect(f.service.store.deliveries.recoverExpiredClaims(at + 11).requeuedJobIds).toEqual(
                [body.requestId]
            )
            f.service.store.deliveries.claimNextDueJob({
                actorId: 'test-worker',
                claimToken: 'new',
                now: at + 12,
                leaseExpiresAt: at + 20,
            })
            expect(
                f.service.store.deliveries.startExternalEffect(body.requestId, 'new', at + 13)
            ).toBe(true)
            expect(
                f.service.store.deliveries.recoverExpiredClaims(at + 21).ambiguousJobIds
            ).toEqual([body.requestId])
            expect(
                f.service.store.deliveries.completeExternalEffect({
                    jobId: body.requestId,
                    claimToken: 'new',
                    completedAt: at + 22,
                    outcome: { type: 'published' },
                })
            ).toBeNull()
            await f.worker.processDueEvents(at + 23)
            expect(f.effects).toHaveLength(0)
        } finally {
            await f.worker.stop()
            closeDatabase(f.database)
        }
    })

    test('rechecks permissions and the pinned connection before dispatch, without creating publications', async () => {
        const f = await fixture(provider === 'mastodon', provider)
        try {
            const body = f.body()
            expect((await f.request(f.path, f.owner.cookie, body)).status).toBe(200)
            const row = f.service.store.get(body.requestId)!
            f.database.$client
                .query(
                    "update publisher_credentials set state = 'reconnect_required' where id = ?1"
                )
                .run(row.credentialId)
            await f.worker.processDueEvents(Date.now())
            expect(f.effects).toHaveLength(0)
            expect(f.service.store.get(body.requestId)?.state).toBe('failed')
            for (const table of ['posts', 'publications'])
                expect(
                    f.database.$client
                        .query<{ count: number }, []>(`select count(*) as count from ${table}`)
                        .get()?.count
                ).toBe(1)
            expect(await (await f.request(f.path, f.owner.cookie)).json()).toMatchObject({
                canReply: false,
            })
        } finally {
            await f.worker.stop()
            closeDatabase(f.database)
        }
    })
}
test('keeps older outgoing history reachable through a project-scoped cursor', async () => {
    const f = await fixture()
    try {
        for (let i = 0; i < 53; i++)
            expect((await f.request(f.path, f.owner.cookie, f.body())).status).toBe(200)
        const first = (await (
            await f.request(f.path, f.owner.cookie)
        ).json()) as PublicationRepliesResponse
        expect(first.replies).toHaveLength(50)
        const second = (await (
            await f.request(f.path + '?before=' + first.nextBefore, f.owner.cookie)
        ).json()) as PublicationRepliesResponse
        expect(second.replies).toHaveLength(3)
        expect(second.nextBefore).toBeNull()
        expect(
            new Set([...first.replies, ...second.replies].map((reply: { id: string }) => reply.id))
                .size
        ).toBe(53)
    } finally {
        await f.worker.stop()
        closeDatabase(f.database)
    }
})

test('prepares live references, verifies granted scope, persists refresh and rechecks dispatch eligibility', async () => {
    const f = await fixture(true)
    try {
        expect((await f.request(f.path, f.owner.cookie, f.body())).status).toBe(200)
        await f.worker.processDueEvents(Date.now())
        expect(
            f.service.store.list(f.project.id, f.path.split('/')[5]!, f.owner.id)!.replies[0]!
                .lastError
        ).toBeNull()
        expect(f.effects).toHaveLength(1)
        expect(
            f.publisher.credentialStore.getPublisherCredential(f.project.id, f.credentialId)
                ?.expiresAt
        ).toBe(Date.parse('2027-10-20T10:00:00.000Z'))
        f.setPermission(false)
        expect((await f.request(f.path, f.owner.cookie, f.body())).status).toBe(200)
        await f.worker.processDueEvents(Date.now())
        expect(f.effects).toHaveLength(1)
        f.setPermission(true)
        f.beforeContext(() =>
            f.database.$client
                .query(
                    "update publisher_credentials set state = 'reconnect_required' where id = ?1"
                )
                .run(f.credentialId)
        )
        expect((await f.request(f.path, f.owner.cookie, f.body())).status).toBe(200)
        await f.worker.processDueEvents(Date.now())
        expect(f.effects).toHaveLength(1)
        const rows = f.service.store.list(f.project.id, f.path.split('/')[5]!, f.owner.id)!.replies
        expect(rows.filter(reply => reply.state === 'sent')).toHaveLength(1)
        expect(rows.filter(reply => reply.state === 'failed')).toHaveLength(2)
    } finally {
        await f.worker.stop()
        closeDatabase(f.database)
    }
})

test('Mastodon refuses a different live account and rechecks the original instance after context reads', async () => {
    const f = await fixture(true, 'mastodon')
    try {
        const first = f.body()
        expect((await f.request(f.path, f.owner.cookie, first)).status).toBe(200)
        f.setPermission(false)
        await f.worker.processDueEvents(Date.now())
        expect(f.service.store.get(first.requestId)?.state).toBe('failed')
        expect(f.effects).toHaveLength(0)
        f.setPermission(true)
        const second = f.body()
        expect((await f.request(f.path, f.owner.cookie, second)).status).toBe(200)
        f.beforeContext(() =>
            f.database.$client
                .query(
                    "update publisher_connections set endpoint_url = 'https://other.example' where credential_id = ?1"
                )
                .run(f.credentialId)
        )
        await f.worker.processDueEvents(Date.now())
        expect(f.service.store.get(second.requestId)?.state).toBe('failed')
        expect(f.effects).toHaveLength(0)
        expect(await (await f.request(f.path, f.owner.cookie)).json()).toMatchObject({
            provider: 'mastodon',
            canReply: false,
        })
    } finally {
        await f.worker.stop()
        closeDatabase(f.database)
    }
})

test('refreshes an expired Mastodon token through the original controlled transport before replying', async () => {
    const f = await fixture(true, 'mastodon')
    try {
        f.database.$client
            .query('update publisher_credentials set expires_at = 1 where id = ?1')
            .run(f.credentialId)
        const body = f.body()
        expect((await f.request(f.path, f.owner.cookie, body)).status).toBe(200)
        await f.worker.processDueEvents(Date.now())
        expect(f.service.store.get(body.requestId)?.state).toBe('sent')
        const secrets = await f.publisher.credentialStore.resolvePublisherCredentialSecrets(
            f.project.id,
            f.credentialId
        )
        expect(secrets?.accessToken).toBe('synthetic-new-token')
        expect(secrets?.refreshToken).toBe('synthetic-rotated-token')
        expect(f.effects).toEqual([body.requestId])
    } finally {
        await f.worker.stop()
        closeDatabase(f.database)
    }
})

test('reply renewal is project-scoped, token-fenced and cannot revive an expired attempt', async () => {
    const f = await fixture()
    try {
        expect((await f.request(f.path, f.owner.cookie, f.body())).status).toBe(200)
        const store = f.service.store.deliveries
        const at = Date.now()
        expect(
            store.claimNextDueJob({
                actorId: 'worker',
                claimToken: 'other',
                now: at,
                leaseExpiresAt: at + 90,
                projectId: 'foreign-project',
            })
        ).toBeNull()
        const work = store.claimNextDueJob({
            actorId: 'worker',
            claimToken: 'owner',
            now: at,
            leaseExpiresAt: at + 90,
            projectId: f.project.id,
        })!
        expect(work).not.toBeNull()
        expect(
            store.renewClaim!({
                jobId: work.id,
                claimToken: 'stale',
                now: at + 30,
                leaseExpiresAt: at + 120,
            })
        ).toBe(false)
        expect(
            store.renewClaim!({
                jobId: work.id,
                claimToken: 'owner',
                now: at + 30,
                leaseExpiresAt: at + 60,
            })
        ).toBe(false)
        expect(
            store.renewClaim!({
                jobId: work.id,
                claimToken: 'owner',
                now: at + 30,
                leaseExpiresAt: at + 120,
            })
        ).toBe(true)
        expect(store.startExternalEffect(work.id, 'owner', at + 100)).toBe(true)
        expect(
            store.renewClaim!({
                jobId: work.id,
                claimToken: 'owner',
                now: at + 120,
                leaseExpiresAt: at + 210,
            })
        ).toBe(false)
        expect(store.recoverExpiredClaims(at + 120).ambiguousJobIds).toEqual([work.id])
        expect(
            store.completeExternalEffect({
                jobId: work.id,
                claimToken: 'owner',
                completedAt: at + 121,
                outcome: { type: 'published' },
            })
        ).toBeNull()
    } finally {
        await f.worker.stop()
        closeDatabase(f.database)
    }
})
