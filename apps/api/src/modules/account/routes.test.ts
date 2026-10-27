import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuth } from '@postdot/auth'
import { closeDatabase, createDatabase, createUserAvatarStore, runMigrations } from '@postdot/db'
import { createLocalMediaStore } from '@postdot/media'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

const baseURL = 'http://localhost:3000'
const image = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
        'base64'
    )
)

describe('personal account HTTP boundary', () => {
    it('updates identity, isolates avatar ownership and revokes other password sessions', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-account-'))
        const database = createDatabase(':memory:')
        runMigrations(database)
        const storage = createLocalMediaStore({
            storeId: 'account-test',
            rootDirectory: directory,
            maxObjectBytes: 6 * 1024 * 1024,
        })
        const app = createApp({
            database,
            auth: createAuth(database, {
                baseURL,
                secret: 'account-test-secret-with-at-least-32-characters',
            }),
            publisher: createPublisherRuntime(database, {
                apiOrigin: baseURL,
                webOrigin: baseURL,
                publisherEncryptionKey: new Uint8Array(32).fill(5),
                publisherEncryptionKeyId: 'test',
            }),
            avatars: createUserAvatarStore(database, storage),
        })
        const request = (path: string, cookie = '', body?: unknown, method = 'POST') =>
            app.handle(
                new Request(`${baseURL}${path}`, {
                    method: body === undefined && method === 'POST' ? 'GET' : method,
                    headers: { cookie, origin: baseURL, 'content-type': 'application/json' },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                })
            )
        const cookieFrom = (response: Response) =>
            response.headers.get('set-cookie')!.split(';')[0]!
        const upload = (cookie: string, bytes = image, origin = baseURL) =>
            app.handle(
                new Request(`${baseURL}/api/account/avatar`, {
                    method: 'POST',
                    headers: { cookie, origin, 'content-type': 'image/png' },
                    body: new Uint8Array(bytes),
                })
            )
        try {
            const signUp = await request('/api/auth/sign-up/email', '', {
                name: 'Account Operator',
                email: 'account@postdot.local',
                password: 'original-account-password',
            })
            expect(signUp.status).toBe(200)
            let cookie = cookieFrom(signUp)
            const second = await request('/api/auth/sign-in/email', '', {
                email: 'account@postdot.local',
                password: 'original-account-password',
            })
            const otherCookie = cookieFrom(second)
            expect((await upload('')).status).toBe(401)
            expect((await upload(cookie, image, 'https://other.example')).status).toBe(403)
            expect((await upload(cookie, new TextEncoder().encode('<svg></svg>'))).status).toBe(400)
            expect((await upload(cookie, new Uint8Array(5 * 1024 * 1024 + 1))).status).toBe(413)
            expect((await request('/api/auth/update-user', cookie, { name: ' ' })).status).toBe(400)
            expect(
                (await request('/api/auth/update-user', cookie, { name: 'Changed Operator' }))
                    .status
            ).toBe(200)
            const firstAvatar = await upload(cookie)
            expect(firstAvatar.status).toBe(200)
            const firstUrl = ((await firstAvatar.json()) as { image: string }).image
            expect((await request(firstUrl, '')).status).toBe(401)
            const opened = await request(firstUrl, cookie)
            expect(opened.headers.get('content-type')).toBe('image/png')
            expect(new Uint8Array(await opened.arrayBuffer())).toEqual(image)
            const replacement = await upload(cookie)
            expect(replacement.status).toBe(200)
            expect((await request(firstUrl, cookie)).status).toBe(404)
            const session = (await (await request('/api/auth/get-session', cookie)).json()) as {
                user: { name: string; image: string | null }
            }
            expect(session.user.name).toBe('Changed Operator')
            expect(session.user.image).toBe(((await replacement.json()) as { image: string }).image)
            expect(
                (
                    await request('/api/auth/update-user', cookie, {
                        image: 'https://other.example/image.png',
                    })
                ).status
            ).toBe(400)
            const wrongPassword = await request('/api/auth/change-password', cookie, {
                currentPassword: 'wrong-password',
                newPassword: 'replacement-password',
                revokeOtherSessions: true,
            })
            expect(wrongPassword.status).toBe(400)
            const changed = await request('/api/auth/change-password', cookie, {
                currentPassword: 'original-account-password',
                newPassword: 'replacement-password',
                revokeOtherSessions: true,
            })
            expect(changed.status).toBe(200)
            cookie = cookieFrom(changed)
            expect(await (await request('/api/auth/get-session', otherCookie)).json()).toBeNull()
            expect(
                (
                    (await (await request('/api/auth/get-session', cookie)).json()) as {
                        user: { name: string }
                    }
                ).user.name
            ).toBe('Changed Operator')
            expect((await request('/api/account/avatar', cookie, undefined, 'DELETE')).status).toBe(
                200
            )
            expect(
                (
                    (await (await request('/api/auth/get-session', cookie)).json()) as {
                        user: { image: string | null }
                    }
                ).user.image
            ).toBeNull()
        } finally {
            closeDatabase(database)
            await rm(directory, { recursive: true, force: true })
        }
    })
})
