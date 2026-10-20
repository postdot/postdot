import { expect, test } from 'bun:test'

import { createAuth } from '@postbot/auth'
import { blueskyChannelProfile, type BlueskyThreadRead } from '@postbot/bluesky'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createManualStore,
    runMigrations,
} from '@postbot/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

test('reads stored comments, replaces one snapshot, preserves it on failure, and enforces live project access', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const baseURL = 'http://localhost:3000'
    const auth = createAuth(database, {
        baseURL,
        secret: 'comments-test-secret-which-is-long-enough',
        allowAdditionalSignups: true,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(1),
        publisherEncryptionKeyId: 'test',
    })
    let calls = 0
    let mode: 'available' | 'failure' | 'blocked' = 'available'
    let beforeReturn: (() => void) | undefined
    let clock = 1_800_000_000_000
    const rootUri = 'at://did:plc:comments/app.bsky.feed.post/root'
    const app = createApp({
        auth,
        database,
        publisher,
        allowAdditionalSignups: true,
        manualStore: { now: () => ++clock },
        blueskyCommentsReader: {
            async getPostThread(uri): Promise<BlueskyThreadRead> {
                calls++
                beforeReturn?.()
                expect(uri).toBe(rootUri)
                if (mode === 'failure')
                    return {
                        kind: 'unavailable',
                        requestedUri: uri,
                        availability: 'temporarily_unavailable',
                    }
                if (mode === 'blocked')
                    return { kind: 'unavailable', requestedUri: uri, availability: 'blocked' }
                return {
                    kind: 'available',
                    requestedUri: uri,
                    truncated: false,
                    root: {
                        kind: 'post',
                        uri,
                        parentUri: null,
                        authorDid: 'did:plc:comments',
                        authorHandle: 'comments.test',
                        text: 'Source',
                        createdAt: clock,
                        externalUrl: null,
                        replies: [
                            {
                                kind: 'post',
                                uri: 'at://did:plc:reader/app.bsky.feed.post/reply',
                                parentUri: uri,
                                authorDid: 'did:plc:reader',
                                authorHandle: 'reader.test',
                                text: 'Public reply',
                                createdAt: clock,
                                externalUrl: 'https://bsky.app/profile/reader.test/post/reply',
                                replies: [],
                            },
                        ],
                    },
                }
            },
        },
    })
    async function request(path: string, cookie: string, method = 'GET', data?: unknown) {
        return app.handle(
            new Request(baseURL + path, {
                method,
                headers: {
                    cookie,
                    origin: baseURL,
                    ...(data === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            })
        )
    }
    async function signup(email: string) {
        const response = await request('/api/auth/sign-up/email', '', 'POST', {
            email,
            name: 'Comment reader',
            password: 'comments-fixture-password',
        })
        expect(response.status).toBe(200)
        const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
        const body = (await response.json()) as { user: { id: string } }
        return { cookie, id: body.user.id }
    }
    try {
        const owner = await signup('comments-owner@postbot.local')
        const made = await request('/api/projects', owner.cookie, 'POST', {
            name: 'Comments project',
            timeZone: 'UTC',
        })
        expect(made.status).toBe(201)
        const { project } = (await made.json()) as { project: { id: string } }
        const manual = createManualStore(database)
        const channel = manual.createChannel({
            projectId: project.id,
            subjectId: owner.id,
            name: 'Bluesky',
            profile: blueskyChannelProfile,
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
            scheduledAt: clock + 1000,
        })
        // Model an already delivered item; never execute a provider publication.
        database.$client
            .query(
                "update publications set state = 'published', external_id = ?1, published_at = ?2, published_by_actor_id = created_by_actor_id where id = ?3"
            )
            .run(rootUri, clock, publicationId)
        const path = `/api/projects/${project.id}/publications/${publicationId}/comments`
        const initial = await request(path, owner.cookie)
        expect(initial.status).toBe(200)
        expect(await initial.json()).toMatchObject({ snapshot: null, lastAttemptAt: null })
        expect(calls).toBe(0)
        const refreshed = await request(path + '/refresh', owner.cookie, 'POST', {})
        expect(refreshed.status).toBe(200)
        const first = (await refreshed.json()) as {
            snapshot: { comments: unknown[] }
            lastError: string | null
        }
        expect(first.snapshot.comments).toHaveLength(1)
        expect(first.lastError).toBeNull()
        expect(calls).toBe(1)
        expect((await request(path, owner.cookie)).status).toBe(200)
        expect(calls).toBe(1)
        mode = 'failure'
        const failure = await request(path + '/refresh', owner.cookie, 'POST', {})
        expect(failure.status).toBe(200)
        expect(await failure.json()).toMatchObject({
            snapshot: first.snapshot,
            lastError: 'temporarily_unavailable',
        })
        mode = 'available'
        await request(path + '/refresh', owner.cookie, 'POST', {})
        expect(
            database.$client
                .query<{ count: number }, []>(
                    'select count(*) as count from publication_comment_snapshots'
                )
                .get()?.count
        ).toBe(1)
        const viewer = await signup('comments-viewer@postbot.local')
        await request('/api/projects', viewer.cookie)
        const access = createAccessStore(database)
        access.updateInstanceMembership({
            actorUserId: owner.id,
            userId: viewer.id,
            role: 'member',
        })
        expect(
            access.grantProjectUserAccess({
                projectId: project.id,
                userId: viewer.id,
                role: 'viewer',
            })
        ).not.toBeNull()
        expect((await request(path, viewer.cookie)).status).toBe(200)
        expect((await request(path + '/refresh', viewer.cookie, 'POST', {})).status).toBe(403)
        expect(
            (await request(path.replace(project.id, 'foreign-project'), viewer.cookie)).status
        ).toBe(404)
        expect((await request(path, '')).status).toBe(401)
        expect(calls).toBe(3)
        mode = 'blocked'
        const blocked = await request(path + '/refresh', owner.cookie, 'POST', {})
        expect(await blocked.json()).toMatchObject({
            snapshot: { availability: 'blocked', comments: [] },
            lastError: null,
        })
        const savedBeforeRevocation = await (await request(path, owner.cookie)).json()
        access.grantProjectUserAccess({ projectId: project.id, userId: viewer.id, role: 'editor' })
        beforeReturn = () => {
            access.grantProjectUserAccess({
                projectId: project.id,
                userId: viewer.id,
                role: 'viewer',
            })
        }
        mode = 'available'
        expect((await request(path + '/refresh', viewer.cookie, 'POST', {})).status).toBe(404)
        expect(await (await request(path, viewer.cookie)).json()).toEqual(savedBeforeRevocation)
        beforeReturn = undefined
        database.$client.query('delete from publications where id = ?1').run(publicationId)
        expect(
            database.$client
                .query<{ count: number }, []>(
                    'select count(*) as count from publication_comment_snapshots'
                )
                .get()?.count
        ).toBe(0)
    } finally {
        closeDatabase(database)
    }
})
