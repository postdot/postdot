import { expect, it } from 'bun:test'

import { createAuth } from '@postdot/auth'
import type { Publication } from '@postdot/core'
import type { PublicationEditorState, PublicationDestinationState } from '@postdot/db'
import { closeDatabase, createAccessStore, createDatabase, runMigrations } from '@postdot/db'

import { createApp } from '../../app'
import { createPublisherRuntime } from '../publishers/runtime'

async function fixture(
    run: (
        request: (
            method: string,
            path: string,
            body?: unknown,
            token?: string
        ) => Promise<Response>,
        cookie: string,
        context: {
            database: ReturnType<typeof createDatabase>
            access: ReturnType<typeof createAccessStore>
            publisher: ReturnType<typeof createPublisherRuntime>
            app: ReturnType<typeof createApp>
        }
    ) => Promise<void>,
    allowAdditionalSignups = false
) {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const baseURL = 'http://localhost:3000'
    const access = createAccessStore(database)
    const auth = createAuth(database, {
        baseURL,
        secret: 'lifecycle-test-secret-over-thirty-two-characters',
        access,
        allowAdditionalSignups,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: baseURL,
        webOrigin: baseURL,
        publisherEncryptionKey: new Uint8Array(32).fill(9),
        publisherEncryptionKeyId: 'test',
        bluesky: {
            clientMetadataUrl: 'https://example.test/metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const app = createApp({ database, access, auth, publisher, allowAdditionalSignups })
    let cookie = ''
    const request = (method: string, path: string, body?: unknown, token?: string) =>
        app.handle(
            new Request(baseURL + path, {
                method,
                headers: {
                    origin: baseURL,
                    'content-type': 'application/json',
                    ...(token ? { authorization: `Bearer ${token}` } : { cookie }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        )
    try {
        const signup = await request('POST', '/api/auth/sign-up/email', {
            name: 'Owner',
            email: 'owner@example.test',
            password: 'lifecycle-password-123',
        })
        expect(signup.status).toBe(200)
        cookie = signup.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ')
        await run(request, cookie, { database, access, app, publisher })
    } finally {
        closeDatabase(database)
    }
}

it('requires explicit scoped destination confirmation and preserves publication content and schedule', async () => {
    await fixture(async (request, _cookie, { database, publisher }) => {
        const projectResponse = await request('POST', '/api/projects', {
            name: 'Destination project',
        })
        const { project } = (await projectResponse.json()) as { project: { id: string } }
        const channelResponse = await request('POST', `/api/projects/${project.id}/channels`, {
            name: 'LinkedIn',
            profile: 'linkedin',
        })
        expect(channelResponse.status).toBe(201)
        const { channel } = (await channelResponse.json()) as { channel: { id: string } }
        const actor = database.$client
            .query<{ id: string; subjectId: string }, [string]>(
                "select id, subject_id as subjectId from actors where project_id = ? and kind = 'human' limit 1"
            )
            .get(project.id)!
        async function credential(id: string) {
            const result = await publisher.credentialStore.createPublisherCredential({
                projectId: project.id,
                connectedByActorId: actor.id,
                providerId: 'linkedin',
                externalAccountId: id,
                externalAccountName: id,
                scopes: ['w_member_social'],
                accessToken: 'synthetic-secret-never-returned',
            })
            if (result.kind !== 'created') throw new Error(result.kind)
            return result.credential
        }
        const first = await credential('first-account')
        const connected = publisher.publisherStore.createPublisherConnection({
            projectId: project.id,
            channelId: channel.id,
            subjectId: actor.subjectId,
            kind: 'linkedin',
            credentialId: first.id,
            destination: { type: 'member', id: 'first-account', name: 'First destination' },
        })
        if (connected.kind !== 'created') throw new Error(connected.kind)
        const postResponse = await request('POST', `/api/projects/${project.id}/posts`, {
            sourceContent: {
                body: { text: 'Preserve this content', format: 'plain_text' },
                media: [],
            },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'automatic',
                    scheduledAt: Date.now() + 86400000,
                },
            ],
        })
        expect(postResponse.status).toBe(201)
        const publication = ((await postResponse.json()) as { publications: Publication[] })
            .publications[0]!
        publisher.credentialStore.markPublisherCredentialReconnectRequired(project.id, first.id)
        const second = await credential('second-account')
        expect(
            publisher.publisherStore.createPublisherConnection({
                projectId: project.id,
                channelId: channel.id,
                subjectId: actor.subjectId,
                kind: 'linkedin',
                credentialId: second.id,
                destination: { type: 'member', id: 'second-account', name: 'Second destination' },
                replaceNonActiveConnection: {
                    id: connected.connection.id,
                    state: 'reconnect_required',
                },
            }).kind
        ).toBe('created')
        const path = `/api/projects/${project.id}/publications/${publication.id}`
        const before = (await (await request('GET', path + '/editor')).json()) as {
            editor: PublicationEditorState
        }
        const stateResponse = await request('GET', path + '/destination')
        expect(stateResponse.status).toBe(200)
        const stateText = await stateResponse.text()
        expect(stateText).not.toContain('synthetic-secret')
        expect(JSON.parse(stateText).destination).toMatchObject({
            revision: 1,
            confirmedRevision: 0,
            requiresConfirmation: true,
        })
        async function key(actions: string[]) {
            const response = await request('POST', '/api/api-keys', {
                name: 'Destination key',
                projectIds: [project.id],
                actionAccess: actions,
            })
            expect(response.status).toBe(201)
            const body = (await response.json()) as { token: string }
            return body.token as string
        }
        const reader = await key(['project:read'])
        const dispatch = await key(['project:read', 'publication:dispatch'])
        const input = {
            expectedRevision: 1,
            expectedTargetRevisionId: publication.targetRevisionId,
        }
        expect((await request('POST', path + '/confirm-destination', input, reader)).status).toBe(
            403
        )
        expect(
            (
                await request(
                    'POST',
                    path + '/confirm-destination',
                    { ...input, expectedRevision: 0 },
                    dispatch
                )
            ).status
        ).toBe(409)
        expect(
            (
                await request(
                    'POST',
                    path + '/confirm-destination',
                    { ...input, expectedTargetRevisionId: 'stale' },
                    dispatch
                )
            ).status
        ).toBe(409)
        const confirmed = await request('POST', path + '/confirm-destination', input, dispatch)
        expect(confirmed.status).toBe(200)
        expect(
            ((await confirmed.json()) as { destination: PublicationDestinationState }).destination
                .requiresConfirmation
        ).toBe(false)
        const after = (await (await request('GET', path + '/editor')).json()) as {
            editor: PublicationEditorState
        }
        expect(after.editor.post).toEqual(before.editor.post)
        expect(after.editor.selectedTarget).toEqual(before.editor.selectedTarget)
        expect(after.editor.publication.scheduledAt).toBe(before.editor.publication.scheduledAt)
        const other = (
            (await (await request('POST', '/api/projects', { name: 'Other project' })).json()) as {
                project: { id: string }
            }
        ).project
        expect(
            (
                await request(
                    'GET',
                    `/api/projects/${other.id}/publications/${publication.id}/destination`
                )
            ).status
        ).toBe(404)
        expect(
            (
                await request(
                    'GET',
                    `/api/projects/${other.id}/publications/${publication.id}/destination`,
                    undefined,
                    dispatch
                )
            ).status
        ).toBe(404)
    })
})
