import { expect, test } from 'bun:test'

import { createAuth } from '@postbot/auth'
import { blueskyChannelProfile } from '@postbot/bluesky'
import {
    closeDatabase,
    createDatabase,
    runMigrations,
    createManualStore,
    createAccessStore,
} from '@postbot/db'
import { mastodonChannelProfile } from '@postbot/mastodon'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import { createBuiltInProviderRegistry } from '../workflow/providers/registry'
import { createPublicationWorker } from '../workflow/worker'
import { createPublicationFirstCommentService } from './publication-first-comment-service'

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const parentUri = `at://${did}/app.bsky.feed.post/parent`
async function fixture(provider: 'bluesky' | 'mastodon' = 'bluesky', production = false) {
    const profile = provider === 'mastodon' ? mastodonChannelProfile : blueskyChannelProfile
    const receiptId = provider === 'mastodon' ? '100' : parentUri
    const receiptUrl =
        provider === 'mastodon'
            ? 'https://social.example/@owner/100'
            : 'https://bsky.app/profile/owner.test/post/parent'
    const accountId = provider === 'mastodon' ? '10' : did
    const database = createDatabase(':memory:')
    runMigrations(database)
    let clock = Date.now()
    let parentFails = false
    let commentThrows = false
    let liveAccount = '10'
    let beforeContext: (() => void) | undefined
    let parentEffects = 0
    const commentEffects: string[] = []
    const baseURL = 'http://localhost:3000'
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(1),
        publisherEncryptionKeyId: 'test',
        mastodon: {
            fetcher: async (url, init) => {
                const parsed = new URL(String(url))
                expect(parsed.origin).toBe('https://social.example')
                if (parsed.pathname === '/api/v1/accounts/verify_credentials') {
                    expect(new Headers(init?.headers).get('authorization')).toBe(
                        'Bearer synthetic-access-token'
                    )
                    return Response.json({ id: liveAccount })
                }
                if (parsed.pathname === '/api/v1/statuses/100') {
                    expect(new Headers(init?.headers).has('authorization')).toBe(false)
                    beforeContext?.()
                    return Response.json({
                        id: '100',
                        account: { id: '10' },
                        visibility: 'unlisted',
                    })
                }
                if (parsed.pathname === '/api/v1/statuses' && init?.method === 'POST') {
                    const body = init.body as URLSearchParams
                    expect(body.get('in_reply_to_id')).toBe('100')
                    expect(body.get('visibility')).toBe('unlisted')
                    const key = new Headers(init.headers).get('idempotency-key')!
                    expect(key).toStartWith('first-comment:')
                    commentEffects.push(key.slice('first-comment:'.length))
                    if (commentThrows) throw new Error('synthetic secret diagnostic')
                    return Response.json({
                        id: '200',
                        url: 'https://social.example/@owner/200',
                        account: { id: '10' },
                        in_reply_to_id: '100',
                        visibility: 'unlisted',
                    })
                }
                throw new Error('Unexpected synthetic Mastodon path')
            },
        },
        bluesky: {
            clientMetadataUrl: 'https://postbot.example/client-metadata.json',
            handleResolver: 'https://resolver.example',
        },
    })
    const service = createPublicationFirstCommentService({
        database,
        publisher,
        now: () => clock,
        performComment: production
            ? undefined
            : async work => {
                  commentEffects.push(work.recordKey)
                  expect(work.rootUri).toBe(
                      provider === 'mastodon'
                          ? 'https://social.example/api/v1/statuses/100'
                          : parentUri
                  )
                  expect(work.accountId).toBe(accountId)
                  if (commentThrows) throw new Error('synthetic secret diagnostic')
                  return {
                      type: 'published',
                      externalId: `at://${did}/app.bsky.feed.post/${work.recordKey}`,
                      externalUrl: `https://bsky.app/profile/${did}/post/${work.recordKey}`,
                  }
              },
    })
    const auth = createAuth(database, {
        baseURL,
        secret: 'first-comment-fixture-secret-long-enough',
        allowAdditionalSignups: true,
    })
    const app = createApp({
        auth,
        database,
        publisher,
        publicationFirstComments: service,
        allowAdditionalSignups: true,
    })
    async function request(path: string, cookie: string, method = 'GET', body?: unknown) {
        return app.handle(
            new Request(baseURL + path, {
                method,
                headers: {
                    cookie,
                    origin: baseURL,
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    }
    async function signup(name: string) {
        const response = await request('/api/auth/sign-up/email', '', 'POST', {
            name,
            email: `${name}@postbot.local`,
            password: 'first-comment-fixture-password',
        })
        expect(response.status).toBe(200)
        return {
            cookie: response.headers.get('set-cookie')!.split(';')[0]!,
            id: ((await response.json()) as { user: { id: string } }).user.id,
        }
    }
    const owner = await signup('owner')
    const projectResponse = await request('/api/projects', owner.cookie, 'POST', {
        name: 'First comments',
    })
    expect(projectResponse.status).toBe(201)
    const { project } = (await projectResponse.json()) as { project: { id: string } }
    const manual = createManualStore(database, { now: () => clock })
    const channel = manual.createChannel({
        projectId: project.id,
        subjectId: owner.id,
        name: 'Bluesky',
        profile,
    })!
    const credential = await publisher.credentialStore.createPublisherCredential({
        projectId: project.id,
        connectedByActorId: publisher.publisherStore.getProjectActorId(project.id, owner.id)!,
        providerId: provider,
        externalAccountId: accountId,
        scopes: provider === 'mastodon' ? ['read:accounts', 'write:statuses'] : [],
        accessToken: 'synthetic-access-token',
        providerSession: JSON.stringify(
            provider === 'mastodon'
                ? {
                      version: 1,
                      instanceUrl: 'https://social.example',
                      clientId: 'synthetic-client',
                      clientSecret: 'synthetic-secret',
                  }
                : { tokenSet: { sub: did, access_token: 'synthetic-access-token' } }
        ),
    })
    if (credential.kind !== 'created') throw new Error('Fixture credential unavailable')
    expect(
        publisher.publisherStore.createPublisherConnection({
            projectId: project.id,
            channelId: channel.id,
            subjectId: owner.id,
            kind: provider,
            credentialId: credential.credential.id,
            ...(provider === 'mastodon' ? { endpointUrl: 'https://social.example' } : {}),
        }).kind
    ).toBe('created')
    const post = manual.createPost({
        projectId: project.id,
        subjectId: owner.id,
        sourceContent: { body: { format: 'plain_text', text: 'Parent announcement' }, media: [] },
        publications: [{ channelId: channel.id, deliveryMode: 'automatic' }],
    })!
    const publicationId = post.publications[0]!.id
    if (profile.execution.kind !== 'built_in') throw new Error('Expected native profile')
    const worker = createPublicationWorker({
        database,
        publisherStore: publisher.publisherStore,
        publisherCredentialStore: publisher.credentialStore,
        firstComments: service,
        now: () => clock,
        builtInProviderRegistry: createBuiltInProviderRegistry([
            {
                providerId: provider,
                contractId: provider,
                revision: profile.execution.revision,
                execute: async () => {
                    parentEffects++
                    return parentFails
                        ? {
                              type: 'permanent_failure',
                              effectOccurred: false,
                              errorMessage: 'Synthetic parent rejection',
                          }
                        : {
                              type: 'published',
                              externalId: receiptId,
                              externalUrl: receiptUrl,
                          }
                },
            },
        ]),
    })
    return {
        database,
        service,
        worker,
        manual,
        owner,
        project,
        channel,
        publicationId,
        signup,
        request,
        access: createAccessStore(database),
        path: `/api/projects/${project.id}/publications/${publicationId}/first-comment`,
        get now() {
            return clock
        },
        advance(ms: number) {
            clock += ms
        },
        commentEffects,
        get parentEffects() {
            return parentEffects
        },
        failParent() {
            parentFails = true
        },
        credentialId: credential.credential.id,
        setLiveAccount(id: string) {
            liveAccount = id
        },
        beforeContext(callback: () => void) {
            beforeContext = callback
        },
        loseCommentResponse() {
            commentThrows = true
        },
        async publish() {
            const editor = manual.getPublicationEditorState(project.id, publicationId, owner.id)!
            manual.promotePublicationDraft({
                projectId: project.id,
                publicationId,
                subjectId: owner.id,
                expectedRevision: editor.draft.revision,
                scheduledAt: clock,
            })
            await worker.processDueEvents(clock)
        },
        async close() {
            await worker.stop()
            closeDatabase(database)
        },
    }
}

test('prepares through HTTP and delivers once after native confirmation plus delay, including overdue recovery', async () => {
    const f = await fixture()
    try {
        expect((await f.request(f.path, f.owner.cookie)).status).toBe(200)
        const input = {
            text: 'Read the full announcement.',
            delaySeconds: 300,
            expectedRevision: 0,
        }
        const saved = await f.request(f.path, f.owner.cookie, 'PUT', input)
        expect(saved.status).toBe(200)
        expect(await saved.text()).not.toContain('credentialId')
        expect((await f.request(f.path, f.owner.cookie, 'PUT', input)).status).toBe(200)
        expect(
            (
                await f.request(f.path, f.owner.cookie, 'PUT', {
                    ...input,
                    text: 'Stale different text',
                })
            ).status
        ).toBe(409)
        await f.service.processDueEvents()
        expect(f.commentEffects).toHaveLength(0)
        await f.publish()
        expect(f.parentEffects).toBe(1)
        await f.service.processDueEvents()
        const pending = f.service.get(f.project.id, f.publicationId, f.owner.id)!
        expect(pending.firstComment).toMatchObject({ state: 'pending', dueAt: f.now + 300_000 })
        expect(f.commentEffects).toHaveLength(0)
        f.advance(900_000)
        await f.worker.processDueEvents(f.now)
        expect(
            f.service.get(f.project.id, f.publicationId, f.owner.id)?.firstComment
        ).toMatchObject({ state: 'sent', text: input.text })
        expect(f.commentEffects).toHaveLength(1)
        f.advance(900_000)
        await f.worker.processDueEvents(f.now)
        expect(f.commentEffects).toHaveLength(1)
        expect(
            JSON.stringify(f.service.get(f.project.id, f.publicationId, f.owner.id))
        ).not.toContain('recordKey')
    } finally {
        await f.close()
    }
})

test('never arms a comment for failed or merely manually marked parent success', async () => {
    const f = await fixture()
    try {
        expect(
            (
                await f.request(f.path, f.owner.cookie, 'PUT', {
                    text: 'Follow-up',
                    delaySeconds: 0,
                    expectedRevision: 0,
                })
            ).status
        ).toBe(200)
        f.failParent()
        await f.publish()
        await f.service.processDueEvents()
        expect(f.commentEffects).toHaveLength(0)
        f.database.$client
            .query(
                "update publications set state = 'published', error_message = null, external_id = ?1, published_at = ?2, published_by_actor_id = (select id from actors where project_id = publications.project_id and subject_id = ?4) where id = ?3"
            )
            .run(parentUri, f.now, f.publicationId, f.owner.id)
        await f.service.processDueEvents()
        expect(f.commentEffects).toHaveLength(0)
        expect(f.service.get(f.project.id, f.publicationId, f.owner.id)?.firstComment?.state).toBe(
            'waiting'
        )
    } finally {
        await f.close()
    }
})

test('cancels before claim and freezes uncertain outcomes without exposing diagnostics or resending', async () => {
    for (const cancel of [true, false]) {
        const f = await fixture()
        try {
            const response = await f.request(f.path, f.owner.cookie, 'PUT', {
                text: 'Follow-up',
                delaySeconds: 0,
                expectedRevision: 0,
            })
            const body = (await response.json()) as { firstComment: { revision: number } }
            if (cancel) {
                expect(
                    (
                        await f.request(f.path + '/cancel', f.owner.cookie, 'POST', {
                            expectedRevision: body.firstComment.revision,
                        })
                    ).status
                ).toBe(200)
            } else f.loseCommentResponse()
            await f.publish()
            await f.service.processDueEvents()
            await f.worker.processDueEvents(f.now + 1_000_000)
            const final = f.service.get(f.project.id, f.publicationId, f.owner.id)!
            expect(final.firstComment?.state).toBe(cancel ? 'cancelled' : 'ambiguous')
            expect(f.commentEffects).toHaveLength(cancel ? 0 : 1)
            expect(JSON.stringify(final)).not.toContain('synthetic secret diagnostic')
            expect(final.canConfigure).toBe(false)
        } finally {
            await f.close()
        }
    }
})

test('reads with viewer access, rejects viewer writes and suspends until another editor explicitly enables again', async () => {
    const f = await fixture()
    try {
        const member = await f.signup('member')
        f.access.updateInstanceMembership({
            actorUserId: f.owner.id,
            userId: member.id,
            role: 'member',
        })
        f.access.grantProjectUserAccess({
            projectId: f.project.id,
            userId: member.id,
            role: 'viewer',
        })
        const input = { text: 'Member follow-up', delaySeconds: 60, expectedRevision: 0 }
        expect((await f.request(f.path, member.cookie)).status).toBe(200)
        expect((await f.request(f.path, member.cookie, 'PUT', input)).status).toBe(403)
        expect((await f.request(f.path, '')).status).toBe(401)
        expect(
            (await f.request(f.path.replace(f.project.id, 'foreign-project'), member.cookie)).status
        ).toBe(404)
        f.access.grantProjectUserAccess({
            projectId: f.project.id,
            userId: member.id,
            role: 'editor',
        })
        expect((await f.request(f.path, member.cookie, 'PUT', input)).status).toBe(200)
        await f.publish()
        await f.service.processDueEvents()
        f.access.grantProjectUserAccess({
            projectId: f.project.id,
            userId: member.id,
            role: 'viewer',
        })
        f.advance(120_000)
        await f.service.processDueEvents()
        const paused = f.service.get(f.project.id, f.publicationId, f.owner.id)!
        expect(paused.firstComment?.state).toBe('suspended')
        expect(f.commentEffects).toHaveLength(0)
        f.access.grantProjectUserAccess({
            projectId: f.project.id,
            userId: member.id,
            role: 'editor',
        })
        await f.service.processDueEvents()
        expect(f.commentEffects).toHaveLength(0)
        expect(
            (
                await f.request(f.path, f.owner.cookie, 'PUT', {
                    ...input,
                    expectedRevision: paused.firstComment!.revision,
                })
            ).status
        ).toBe(200)
        await f.service.processDueEvents()
        expect(f.commentEffects).toHaveLength(1)
        expect(f.service.get(f.project.id, f.publicationId, f.owner.id)?.firstComment?.state).toBe(
            'sent'
        )
    } finally {
        await f.close()
    }
})

test('Mastodon prepares 500 units and sends one direct first comment on its original instance without a snapshot', async () => {
    const f = await fixture('mastodon', true)
    try {
        const saved = await f.request(f.path, f.owner.cookie, 'PUT', {
            text: 'a'.repeat(500),
            delaySeconds: 300,
            expectedRevision: 0,
        })
        expect(saved.status).toBe(200)
        expect(await saved.json()).toMatchObject({
            providerId: 'mastodon',
            textLimit: 500,
            firstComment: { state: 'waiting' },
        })
        expect(
            (
                await f.request(f.path, f.owner.cookie, 'PUT', {
                    text: 'a'.repeat(501),
                    delaySeconds: 300,
                    expectedRevision: 1,
                })
            ).status
        ).toBe(409)
        await f.publish()
        await f.service.processDueEvents()
        expect(f.commentEffects).toHaveLength(0)
        const pinned = f.service.store.get(f.project.id, f.publicationId, f.owner.id)!
        expect(pinned).toMatchObject({
            providerId: 'mastodon',
            instanceOrigin: 'https://social.example',
            rootUri: 'https://social.example/api/v1/statuses/100',
            state: 'pending',
        })
        f.advance(900_000)
        await f.worker.processDueEvents(f.now)
        expect(f.service.get(f.project.id, f.publicationId, f.owner.id)).toMatchObject({
            instanceOrigin: 'https://social.example',
            firstComment: { state: 'sent', externalUrl: 'https://social.example/@owner/200' },
        })
        await f.worker.processDueEvents(f.now)
        expect(f.commentEffects).toEqual([pinned.recordKey])
    } finally {
        await f.close()
    }
})

test('Mastodon first comments recheck the account and the instance immediately before sending', async () => {
    for (const mismatch of ['account', 'instance'] as const) {
        const f = await fixture('mastodon', true)
        try {
            expect(
                (
                    await f.request(f.path, f.owner.cookie, 'PUT', {
                        text: 'Follow-up',
                        delaySeconds: 0,
                        expectedRevision: 0,
                    })
                ).status
            ).toBe(200)
            await f.publish()
            if (mismatch === 'account') f.setLiveAccount('99')
            else
                f.beforeContext(() =>
                    f.database.$client
                        .query(
                            "update publisher_connections set endpoint_url = 'https://other.example' where credential_id = ?1"
                        )
                        .run(f.credentialId)
                )
            await f.service.processDueEvents()
            expect(f.commentEffects).toHaveLength(0)
            expect(
                f.service.get(f.project.id, f.publicationId, f.owner.id)?.firstComment?.state
            ).toBe('failed')
        } finally {
            await f.close()
        }
    }
})

test('Mastodon first-comment uncertainty remains independent and is never resent', async () => {
    const f = await fixture('mastodon', true)
    try {
        expect(
            (
                await f.request(f.path, f.owner.cookie, 'PUT', {
                    text: 'Follow-up',
                    delaySeconds: 0,
                    expectedRevision: 0,
                })
            ).status
        ).toBe(200)
        await f.publish()
        f.loseCommentResponse()
        await f.service.processDueEvents()
        expect(f.service.get(f.project.id, f.publicationId, f.owner.id)?.firstComment?.state).toBe(
            'ambiguous'
        )
        expect(
            JSON.stringify(f.service.get(f.project.id, f.publicationId, f.owner.id))
        ).not.toContain('secret diagnostic')
        f.advance(900_000)
        await f.worker.processDueEvents(f.now)
        expect(f.commentEffects).toHaveLength(1)
        expect(
            f.manual.getPublicationEditorState(f.project.id, f.publicationId, f.owner.id)
                ?.publication.state
        ).toBe('published')
    } finally {
        await f.close()
    }
})
