import { expect, test } from 'bun:test'

import { createAuth } from '@postdot/auth'
import { createAccessStore, type PublicationEditorState } from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
import type { DraftChangeSignal } from './realtime-runtime'

const origin = 'http://localhost:3000'
const now = 1_800_000_000_000
const source = (text: string) => ({ body: { text, format: 'plain_text' }, media: [] })

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
    const f = await setup()
    try {
        await run(f)
    } finally {
        await closeTestDatabase(f.database)
    }
}

async function setup() {
    const database = (await openTestDatabase()).database
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, {
        baseURL: origin,
        secret: 'composition-test-secret-over-thirty-two-characters',
        access,
        allowAdditionalSignups: true,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: origin,
        webOrigin: origin,
        publisherEncryptionKey: new Uint8Array(32).fill(9),
        publisherEncryptionKeyId: 'composition',
    })
    const changes: DraftChangeSignal[] = []
    const app = createApp({
        database,
        access,
        auth,
        publisher,
        manualStore: { now: () => now },
        projectChanges: {
            waitForChange: async () => {},
            publishDraftChange: change => {
                changes.push(change)
            },
        },
    })
    let cookie = ''
    const call = (path: string, method = 'GET', body?: unknown, credential = cookie) =>
        app.handle(
            new Request(origin + path, {
                method,
                headers: {
                    origin,
                    'content-type': 'application/json',
                    ...(credential.startsWith('Bearer ')
                        ? { authorization: credential }
                        : { cookie: credential }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    const signup = async (email: string) => {
        const response = await call(
            '/api/auth/sign-up/email',
            'POST',
            {
                name: 'Composition operator',
                email,
                password: 'composition-password-123',
            },
            ''
        )
        expect(response.status).toBe(200)
        const body = (await response.json()) as { user: { id: string } }
        return { id: body.user.id, cookie: response.headers.get('set-cookie')!.split(';', 1)[0]! }
    }
    cookie = (await signup('composition@postdot.local')).cookie
    const createProject = async () => {
        const response = await call('/api/projects', 'POST', { name: 'Composition' })
        expect(response.status).toBe(201)
        return ((await response.json()) as { project: { id: string } }).project.id
    }
    const projectId = await createProject()
    const root = `/api/projects/${projectId}`
    const channels: string[] = []
    for (let i = 0; i < 2; i++) {
        const response = await call(`${root}/channels`, 'POST', { name: `Channel ${i}` })
        expect(response.status).toBe(201)
        channels.push(((await response.json()) as { channel: { id: string } }).channel.id)
    }
    const created = await call(`${root}/posts`, 'POST', {
        sourceContent: source('Original'),
        publications: channels.map(channelId => ({
            channelId,
            deliveryMode: 'manual',
            scheduledAt: now + 60000,
        })),
    })
    expect(created.status).toBe(201)
    const { post, publications } = (await created.json()) as {
        post: { id: string }
        publications: { id: string }[]
    }
    const ids = publications.map(item => item.id)
    const path = `${root}/posts/${post.id}/composition`
    const input = {
        expectedSourceRevision: 1,
        sourceContent: source('Changed'),
        publications: ids.map(publicationId => ({
            publicationId,
            expectedRevision: 1,
            targetContent: { body: 'Changed', media: [] },
        })),
    }
    const key = async (actions: string[], projectIds = [projectId]) => {
        const response = await call('/api/api-keys', 'POST', {
            name: 'Composition access',
            projectIds,
            actionAccess: actions,
        })
        expect(response.status).toBe(201)
        return `Bearer ${((await response.json()) as { token: string }).token}`
    }
    return {
        database,
        access,
        call,
        signup,
        createProject,
        projectId,
        post,
        ids,
        path,
        input,
        key,
        changes,
    }
}

test('composition returns reusable editor states and emits draft signals only after success', async () => {
    await fixture(async f => {
        const manage = await f.key(['publication:manage'])
        const conflict = await f.call(
            f.path,
            'PUT',
            {
                ...f.input,
                publications: f.input.publications.map(item => ({ ...item, expectedRevision: 99 })),
            },
            manage
        )
        expect(conflict.status).toBe(409)
        expect(await conflict.json()).toMatchObject({
            error: { code: 'write_conflict', conflictingPublicationIds: f.ids },
        })
        expect(f.changes).toEqual([])
        const response = await f.call(f.path, 'PUT', f.input, manage)
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            post: { sourceRevision: number }
            publications: PublicationEditorState[]
        }
        expect(body.post.sourceRevision).toBe(2)
        expect(body.publications).toHaveLength(2)
        for (const editor of body.publications) {
            expect(editor.draft).toMatchObject({
                revision: 2,
                sourceRevision: 2,
                content: { body: 'Changed' },
            })
            const read = await f.call(
                `/api/projects/${f.projectId}/publications/${editor.publication.id}/editor`
            )
            expect(await read.json()).toEqual({ editor })
        }
        expect(f.changes).toEqual(
            f.ids.map(publicationId => ({
                projectId: f.projectId,
                postId: f.post.id,
                publicationId,
                sourceChanged: true,
            }))
        )
    })
})

test('composition refuses missing authentication, viewer access, key ceilings and foreign project scope', async () => {
    await fixture(async f => {
        expect((await f.call(f.path, 'PUT', f.input, '')).status).toBe(401)
        const viewer = await f.signup('composition-viewer@postdot.local')
        await f.access.grantProjectUserAccess({
            projectId: f.projectId,
            userId: viewer.id,
            role: 'viewer',
        })
        expect((await f.call(f.path, 'PUT', f.input, viewer.cookie)).status).toBe(403)
        const outsider = await f.signup('composition-outsider@postdot.local')
        expect((await f.call(f.path, 'PUT', f.input, outsider.cookie)).status).toBe(404)
        for (const actions of [['project:read'], ['publication:dispatch']]) {
            expect((await f.call(f.path, 'PUT', f.input, await f.key(actions))).status).toBe(403)
        }
        const otherProject = await f.createProject()
        expect(
            (
                await f.call(
                    f.path,
                    'PUT',
                    f.input,
                    await f.key(['publication:manage'], [otherProject])
                )
            ).status
        ).toBe(404)
        expect(
            await f.database.sql
                .statement('select source_revision as revision from posts where id = ?1')
                .get(f.post.id)
        ).toEqual({ revision: 1 })
    })
})

test('composition keys inherit live project access and cannot bypass revocation', async () => {
    await fixture(async f => {
        const editor = await f.signup('composition-editor@postdot.local')
        await f.access.grantProjectUserAccess({
            projectId: f.projectId,
            userId: editor.id,
            role: 'editor',
        })
        const keyResponse = await f.call(
            '/api/api-keys',
            'POST',
            {
                name: 'Editor access',
                projectIds: [f.projectId],
                actionAccess: ['publication:manage'],
            },
            editor.cookie
        )
        expect(keyResponse.status).toBe(201)
        const token = `Bearer ${((await keyResponse.json()) as { token: string }).token}`
        await f.database.sql
            .statement('delete from project_user_grants where project_id = ?1 and user_id = ?2')
            .run(f.projectId, editor.id)
        expect((await f.call(f.path, 'PUT', f.input, token)).status).toBe(404)
        expect(f.changes).toEqual([])
    })
})

test('composition validates revisions, content, duplicate IDs and post ownership without writing', async () => {
    await fixture(async f => {
        for (const body of [
            { ...f.input, expectedSourceRevision: 0 },
            { ...f.input, expectedSourceRevision: 1.5 },
            { ...f.input, publications: [{ ...f.input.publications[0], expectedRevision: 0 }] },
            { ...f.input, publications: [{ ...f.input.publications[0], targetContent: [] }] },
            { ...f.input, publications: [{ ...f.input.publications[0], scheduledAt: -1 }] },
        ])
            expect((await f.call(f.path, 'PUT', body)).status).toBe(422)
        for (const body of [
            { ...f.input, publications: [f.input.publications[0], f.input.publications[0]] },
            { ...f.input, publications: [{ publicationId: 'missing', expectedRevision: 1 }] },
            { ...f.input, sourceContent: { media: [] } },
        ])
            expect((await f.call(f.path, 'PUT', body)).status).toBe(400)
        const sourceConflict = await f.call(f.path, 'PUT', {
            ...f.input,
            expectedSourceRevision: 99,
        })
        expect(sourceConflict.status).toBe(409)
        expect(await sourceConflict.json()).toMatchObject({
            error: { code: 'write_conflict', conflictingPublicationIds: f.ids },
        })
        expect(f.changes).toEqual([])
        expect(
            await f.database.sql
                .statement('select source_revision as revision from posts where id = ?1')
                .get(f.post.id)
        ).toEqual({ revision: 1 })
    })
})

test('composition rescheduling requires dispatch as well as management and preserves the selected target', async () => {
    await fixture(async f => {
        const input = {
            ...f.input,
            publications: [{ ...f.input.publications[0], scheduledAt: now + 120000 }],
        }
        expect(
            (await f.call(f.path, 'PUT', input, await f.key(['publication:manage']))).status
        ).toBe(403)
        expect(f.changes).toEqual([])
        const response = await f.call(
            f.path,
            'PUT',
            input,
            await f.key(['publication:manage', 'publication:dispatch'])
        )
        expect(response.status).toBe(200)
        const { publications } = (await response.json()) as {
            publications: PublicationEditorState[]
        }
        expect(publications[0]!.publication.scheduledAt).toBe(now + 120000)
        expect(publications[0]!.selectedTarget!.content).toMatchObject({ body: 'Original' })
    })
})
