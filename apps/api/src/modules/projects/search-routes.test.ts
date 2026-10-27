import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@postdot/auth'
import {
    closeDatabase,
    createAccessStore,
    createDatabase,
    createMediaAssetStore,
    createManualStore,
    runMigrations,
} from '@postdot/db'
import { createLocalMediaStore } from '@postdot/media'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const secret = 'postdot-test-secret-with-at-least-32-characters'
const now = 1_800_000_000_000
const publisherEncryptionKey = new Uint8Array(32).fill(9)

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const mediaRoot = mkdtempSync(join(tmpdir(), 'search-383-media-'))
    const media = createMediaAssetStore(
        database,
        createLocalMediaStore({
            storeId: 'search-383-local',
            rootDirectory: mediaRoot,
            maxObjectBytes: 10_000_000,
        })
    )
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey,
        publisherEncryptionKeyId: 'test-v1',
        bluesky: {
            clientMetadataUrl: 'https://postdot.example.test/oauth/bluesky/client-metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const access = createAccessStore(database, { now: () => now })
    const auth = createAuth(database, { baseURL, secret, access, allowAdditionalSignups: true })
    const app = createApp({
        auth,
        access,
        database,
        publisher,
        media,
        manualStore: { now: () => now },
    })
    return { access, app, database, mediaRoot }
}

async function signUp(app: ReturnType<typeof createApp>, email: string) {
    const response = await app.handle(
        new Request(`${baseURL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseURL },
            body: JSON.stringify({
                email,
                name: 'Access 309 Fixture',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    expect(response.status).toBe(200)
    return cookie ?? ''
}

async function sessionRequest(
    app: ReturnType<typeof createApp>,
    path: string,
    cookie: string,
    init: RequestInit = {}
) {
    const headers = new Headers(init.headers)
    headers.set('cookie', cookie)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    return app.handle(new Request(`${baseURL}${path}`, { ...init, headers }))
}

describe('global dashboard search', () => {
    it('searches each post once, respects scope and live access, and treats wildcards literally', async () => {
        const { access, app, database, mediaRoot } = createFixture()
        try {
            const ownerCookie = await signUp(app, 'search-owner@postdot.local')
            const readerCookie = await signUp(app, 'search-reader@postdot.local')
            const ownerId = database.$client
                .query<{ id: string }, []>(
                    "select id from user where email = 'search-owner@postdot.local'"
                )
                .get()!.id
            const readerId = database.$client
                .query<{ id: string }, []>(
                    "select id from user where email = 'search-reader@postdot.local'"
                )
                .get()!.id
            const store = createManualStore(database)
            const projectResponse = await sessionRequest(app, '/api/projects', ownerCookie, {
                method: 'POST',
                body: JSON.stringify({ name: 'Needle project' }),
            })
            expect(projectResponse.status).toBe(201)
            const { project } = (await projectResponse.json()) as { project: { id: string } }
            const channel = store.createChannel({
                projectId: project.id,
                subjectId: ownerId,
                name: 'Needle channel',
            })!
            const post = store.createPost({
                projectId: project.id,
                subjectId: ownerId,
                title: 'Needle post',
                sourceContent: {
                    headline: 'Different headline',
                    body: { text: 'A literal 100%_needle source', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id }, { channelId: channel.id }],
            })!
            const search = async (cookie: string, query: string, projectId?: string) => {
                const response = await sessionRequest(
                    app,
                    `/api/search?q=${encodeURIComponent(query)}${projectId === undefined ? '' : `&projectId=${projectId}`}`,
                    cookie
                )
                expect(response.status).toBe(200)
                return (
                    (await response.json()) as {
                        results: Array<{ kind: string; id: string; projectId: string }>
                    }
                ).results
            }
            const actor = database.$client
                .query<{ id: string }, string[]>(
                    'select id from actors where project_id = ? limit 1'
                )
                .get(project.id)!
            for (const [id, state, archivedAt] of [
                ['search-media', 'ready', null],
                ['search-pending', 'reserved', null],
                ['search-archived', 'ready', now],
            ] as const) {
                database.$client.run(
                    `insert into media_assets
                    (id, project_id, original_filename, default_accessibility_text, state,
                    archived_at, created_by_actor_id, created_at, updated_at)
                    values (?, ?, 'Needle-photo.png', 'A mountain landscape', ?, ?, ?, ?, ?)`,
                    [id, project.id, state, archivedAt, actor.id, now, now]
                )
            }
            expect((await search(ownerCookie, 'mountain')).map(result => result.id)).toEqual([
                'search-media',
            ])
            const results = await search(ownerCookie, 'NEEDLE')
            expect(results.map(result => result.kind)).toEqual([
                'project',
                'channel',
                'post',
                'media',
            ])
            expect(results.filter(result => result.id === post.post.id)).toHaveLength(1)
            expect((await search(ownerCookie, '%_')).map(result => result.kind)).toEqual(['post'])
            expect(await search(ownerCookie, 'Needle', 'inaccessible-project')).toEqual([])
            expect(await search(readerCookie, 'Needle')).toEqual([])
            expect(
                access.grantProjectUserAccess({
                    projectId: project.id,
                    userId: readerId,
                    role: 'viewer',
                })
            ).not.toBeNull()
            expect(await search(readerCookie, 'Needle', project.id)).toHaveLength(4)
            expect(access.removeProjectUserAccess(project.id, readerId)).toBe(true)
            expect(await search(readerCookie, 'Needle')).toEqual([])
            expect((await sessionRequest(app, '/api/search?q=x', ownerCookie)).status).toBe(422)
            expect((await app.handle(new Request(`${baseURL}/api/search?q=Needle`))).status).toBe(
                401
            )
            for (let index = 0; index < 12; index++)
                store.createChannel({
                    projectId: project.id,
                    subjectId: ownerId,
                    name: `Needle bounded ${index}`,
                })
            expect(
                (await search(ownerCookie, 'Needle')).filter(result => result.kind === 'channel')
            ).toHaveLength(10)
        } finally {
            closeDatabase(database)
            rmSync(mediaRoot, { recursive: true, force: true })
        }
    })
})
