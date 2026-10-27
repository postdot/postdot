import { expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    runMigrations,
    type PublicationEditorState,
} from '@postdot/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'
const origin = 'http://localhost:3000'
const now = 1_800_000_000_000
async function fixture(scheduled = true) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, {
        baseURL: origin,
        secret: 'moves-test-secret-over-thirty-two-characters',
        access,
        allowAdditionalSignups: true,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: origin,
        webOrigin: origin,
        publisherEncryptionKey: new Uint8Array(32).fill(9),
        publisherEncryptionKeyId: 'moves',
    })
    const app = createApp({ database, access, auth, publisher, manualStore: { now: () => now } })
    let cookie = ''
    const call = (path: string, method = 'GET', body?: unknown, token?: string) =>
        app.handle(
            new Request(origin + path, {
                method,
                headers: {
                    origin,
                    'content-type': 'application/json',
                    ...(token ? { authorization: `Bearer ${token}` } : { cookie }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    const signup = await call('/api/auth/sign-up/email', 'POST', {
        name: 'Move operator',
        email: 'moves@postdot.local',
        password: 'move-publication-password-123',
    })
    expect(signup.status).toBe(200)
    cookie = signup.headers.get('set-cookie')!.split(';', 1)[0]!
    const project = (
        (await (await call('/api/projects', 'POST', { name: 'Moves' })).json()) as {
            project: { id: string }
        }
    ).project
    const source = (
        (await (
            await call(`/api/projects/${project.id}/channels`, 'POST', { name: 'Source' })
        ).json()) as { channel: { id: string } }
    ).channel
    const target = (
        (await (
            await call(`/api/projects/${project.id}/channels`, 'POST', { name: 'Target' })
        ).json()) as { channel: { id: string; profileVersionId: string } }
    ).channel
    const post = await call(`/api/projects/${project.id}/posts`, 'POST', {
        sourceContent: { body: { format: 'plain_text', text: 'Move me' }, media: [] },
        publications: [
            {
                channelId: source.id,
                deliveryMode: 'manual',
                ...(scheduled ? { scheduledAt: now + 60000 } : {}),
            },
        ],
    })
    expect(post.status).toBe(201)
    const publication = ((await post.json()) as { publications: { id: string }[] }).publications[0]!
    const path = `/api/projects/${project.id}/publications/${publication.id}`
    const editor = (
        (await (await call(`${path}/editor`)).json()) as { editor: PublicationEditorState }
    ).editor
    const input = {
        targetChannelId: target.id,
        deliveryMode: 'manual',
        expectedPublicationUpdatedAt: editor.publication.updatedAt,
        expectedDraftRevision: editor.draft.revision,
        expectedSourceRevision: editor.post.sourceRevision,
        expectedTargetRevisionId: editor.publication.targetRevisionId,
        expectedScheduledAt: editor.publication.scheduledAt,
        expectedTargetProfileVersionId: target.profileVersionId,
    }
    const key = async (actions: string[]) =>
        (
            (await (
                await call('/api/api-keys', 'POST', {
                    name: 'Move access',
                    projectIds: [project.id],
                    actionAccess: actions,
                })
            ).json()) as { token: string }
        ).token
    return { database, call, project, publication, target, path, input, key }
}
it('requires dispatch permission for scheduled moves and preserves the original on rejection', async () => {
    const f = await fixture()
    try {
        const manageOnly = await f.key(['publication:manage'])
        expect((await f.call(`${f.path}/move`, 'POST', f.input, manageOnly)).status).toBe(403)
        expect(
            f.database.$client
                .query('select state from publications where id=?')
                .get(f.publication.id)
        ).toEqual({ state: 'scheduled' })
        const dispatchOnly = await f.key(['publication:dispatch'])
        expect((await f.call(`${f.path}/move`, 'POST', f.input, dispatchOnly)).status).toBe(403)
        const allowed = await f.key(['publication:manage', 'publication:dispatch'])
        const moved = await f.call(`${f.path}/move`, 'POST', f.input, allowed)
        expect(moved.status).toBe(201)
        const { editor } = (await moved.json()) as { editor: PublicationEditorState }
        expect(editor.publication).toMatchObject({
            channelId: f.target.id,
            state: 'scheduled',
            scheduledAt: f.input.expectedScheduledAt,
        })
        expect(editor.movement?.fromPublicationId).toBe(f.publication.id)
        expect(
            f.database.$client
                .query('select state from publications where id=?')
                .get(f.publication.id)
        ).toEqual({ state: 'cancelled' })
        expect((await f.call(`${f.path}/move`, 'POST', f.input, allowed)).status).toBe(409)
    } finally {
        closeDatabase(f.database)
    }
})
it('masks unavailable destinations and rejects stale edits before cancellation', async () => {
    const f = await fixture()
    try {
        expect(
            (
                await f.call(`${f.path}/move`, 'POST', {
                    ...f.input,
                    targetChannelId: 'invisible-channel',
                })
            ).status
        ).toBe(404)
        expect(
            (await f.call(`${f.path}/move`, 'POST', { ...f.input, expectedDraftRevision: 99 }))
                .status
        ).toBe(409)
        expect(
            f.database.$client
                .query('select state from publications where id=?')
                .get(f.publication.id)
        ).toEqual({ state: 'scheduled' })
        expect(f.database.$client.query('select * from publication_moves').all()).toEqual([])
    } finally {
        closeDatabase(f.database)
    }
})

it('allows management-only keys to move an unscheduled draft without dispatch authority', async () => {
    const f = await fixture(false)
    try {
        const key = await f.key(['publication:manage'])
        const response = await f.call(`${f.path}/move`, 'POST', f.input, key)
        expect(response.status).toBe(201)
        const { editor } = (await response.json()) as { editor: PublicationEditorState }
        expect(editor.publication).toMatchObject({
            channelId: f.target.id,
            state: 'draft',
            scheduledAt: null,
        })
        expect(editor.movement?.fromPublicationId).toBe(f.publication.id)
    } finally {
        closeDatabase(f.database)
    }
})
