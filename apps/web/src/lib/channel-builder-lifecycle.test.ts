import { expect, test } from 'bun:test'

import { createManualChannelProfile } from '@postbot/core'

import { createAuth } from '../../../../packages/auth/src/index'
import {
    createAccessStore,
    createDatabase,
    closeDatabase,
    runMigrations,
} from '../../../../packages/db/src/index'
import { createApp } from '../../../api/src/app'
import { createPublisherRuntime } from '../../../api/src/modules/publishers/runtime'
import {
    createJsonBody,
    changeJsonBodyProperty,
    compareJsonBodyProperties,
} from './channel-json-body-builder'
import { editQuery, compareQuery } from './channel-query-builder'
import { editMappedRequest } from './channel-request-builder'

test('persists mapped builder edits through draft review and guarded activation', async () => {
    const origin = 'http://localhost:3000'
    const now = 1_800_000_000_000
    const database = createDatabase(':memory:')
    runMigrations(database)
    const access = createAccessStore(database)
    const auth = createAuth(database, {
        baseURL: origin,
        secret: 'isolated-builder-test-secret-at-least-32-characters',
        access,
    })
    const publisher = createPublisherRuntime(database, {
        apiOrigin: origin,
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(7),
        publisherEncryptionKeyId: 'isolated-test',
        bluesky: {
            clientMetadataUrl: 'https://example.test/oauth/client-metadata.json',
            handleResolver: 'https://bsky.social',
        },
    })
    const app = createApp({ database, access, auth, publisher, manualStore: { now: () => now } })
    try {
        const signup = await app.handle(
            new Request(`${origin}/api/auth/sign-up/email`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin },
                body: JSON.stringify({
                    name: 'Builder Operator',
                    email: 'builder@postbot.local',
                    password: 'correct-horse-battery-staple',
                }),
            })
        )
        expect(signup.status).toBe(200)
        const cookie = signup.headers.get('set-cookie')?.split(';', 1)[0]
        expect(cookie).toBeDefined()
        async function request(path: string, body?: unknown) {
            const response = await app.handle(
                new Request(`${origin}${path}`, {
                    method: body === undefined ? 'GET' : 'POST',
                    headers: { cookie: cookie!, 'content-type': 'application/json' },
                    body: body === undefined ? undefined : JSON.stringify(body),
                })
            )
            return response
        }
        const projectResponse = await request('/api/projects', { name: 'Isolated builder project' })
        expect(projectResponse.status).toBe(201)
        const { project } = await projectResponse.json()
        const initial = {
            ...createManualChannelProfile(),
            origin: 'custom',
            contentSchema: {
                ...(createManualChannelProfile().contentSchema as Record<string, unknown>),
                $schema: 'https://json-schema.org/draft/2020-12/schema',
            },
            execution: {
                kind: 'declarative_http',
                mode: 'mapped_http',
                contractId: 'builder-test',
                revision: '1',
                request: {
                    method: 'POST',
                    path: ['posts', { kind: 'secret' }],
                    query: { delivery: { kind: 'context', pointer: '/deliveryId' } },
                    headers: { 'X-Source': { kind: 'literal', value: 'Postbot' } },
                    response: {
                        successStatuses: [201],
                        retryableStatuses: [429],
                        rejectedStatuses: [400],
                        ambiguousStatuses: [500],
                    },
                },
            },
        }
        const channelResponse = await request(`/api/projects/${project.id}/channels`, {
            name: 'Mapped builder channel',
            profile: initial,
        })
        expect(channelResponse.status, await channelResponse.clone().text()).toBe(201)
        const { channel } = await channelResponse.json()
        const base = `/api/projects/${project.id}/channels/${channel.id}`
        const stateResponse = await request(`${base}/profile`)
        expect(stateResponse.status).toBe(200)
        const original = (await stateResponse.json()).active
        expect(original.profile.execution).toEqual(initial.execution)

        const postResponse = await request(`/api/projects/${project.id}/posts`, {
            sourceContent: {
                body: { text: 'Existing announcement', format: 'plain_text' },
                media: [],
            },
            publications: [
                {
                    channelId: channel.id,
                    deliveryMode: 'manual',
                    scheduledAt: now + 86_400_000,
                    targetContent: { body: 'Existing announcement', media: [] },
                },
            ],
        })
        expect(postResponse.status, await postResponse.clone().text()).toBe(201)
        const { publications } = await postResponse.json()
        const editorPath = `/api/projects/${project.id}/publications/${publications[0].id}/editor`
        const editorBeforeResponse = await request(editorPath)
        expect(editorBeforeResponse.status).toBe(200)
        const editorBefore = (await editorBeforeResponse.json()).editor

        let proposed = createJsonBody(original.profile)
        proposed = changeJsonBodyProperty(proposed, 'message', 'add', {
            kind: 'content',
            pointer: '/body',
        })
        proposed = changeJsonBodyProperty(proposed, 'published', 'add', {
            kind: 'literal',
            value: false,
        })
        proposed = editQuery(proposed, 'language', 'add', 'fr & en')
        const methodEdit = editMappedRequest(proposed, { kind: 'method', value: 'PATCH' })
        expect(methodEdit.ok).toBe(true)
        if (!methodEdit.ok) throw new Error('Mapped request edit failed')
        proposed = methodEdit.profile
        const snapshot = structuredClone(proposed)
        expect(compareJsonBodyProperties(original.profile, proposed)).toHaveLength(2)
        expect(compareQuery(original.profile, proposed)).toEqual([
            { name: 'language', before: undefined, after: 'fr & en' },
        ])

        const draftResponse = await request(`${base}/profile-drafts`, { profile: proposed })
        expect(draftResponse.status).toBe(200)
        const { profile: draft } = await draftResponse.json()
        expect(draft).toMatchObject({ state: 'draft', version: 2, revision: 1 })
        expect(draft.profile.execution).toEqual(proposed?.execution)
        const savedResponse = await request(`${base}/profile`)
        expect(savedResponse.status).toBe(200)
        const saved = await savedResponse.json()
        expect(saved.active.id).toBe(original.id)
        expect(saved.active.profile.execution).toEqual(initial.execution)
        expect(saved.draft.profile.execution).toEqual(proposed?.execution)

        const preview = await request(`${base}/profile-drafts/${draft.id}/preview`, {})
        expect(preview.status).toBe(200)
        expect(await preview.json()).toMatchObject({
            assessment: {
                hasReviewRequired: false,
                workingDrafts: [{ id: publications[0].id, state: 'compatible' }],
                pendingTargets: [{ id: publications[0].id, state: 'compatible' }],
            },
        })
        const editorPreviewResponse = await request(editorPath)
        expect((await editorPreviewResponse.json()).editor).toEqual(editorBefore)
        const stale = await request(`${base}/profile-drafts/${draft.id}/activate`, {
            expectedRevision: draft.revision + 1,
        })
        expect(stale.status).toBe(409)
        const unchanged = await request(`${base}/profile`)
        expect((await unchanged.json()).active.id).toBe(original.id)

        const activation = await request(`${base}/profile-drafts/${draft.id}/activate`, {
            expectedRevision: draft.revision,
        })
        expect(activation.status).toBe(200)
        expect(await activation.json()).toMatchObject({
            profile: { id: draft.id, state: 'active', version: 2 },
            channel: { profileVersionId: draft.id },
        })
        const finalResponse = await request(`${base}/profile`)
        const final = await finalResponse.json()
        expect(final.active.profile.execution).toEqual(proposed?.execution)
        expect(final.draft).toBeNull()
        const editorAfterResponse = await request(editorPath)
        expect(editorAfterResponse.status).toBe(200)
        const editorAfter = (await editorAfterResponse.json()).editor
        expect(editorAfter.draft).toEqual({
            ...editorBefore.draft,
            lastAssessedProfileVersionId: draft.id,
            revision: editorBefore.draft.revision + 1,
            updatedAt: now,
        })
        expect(editorBefore.selectedTarget).not.toBeNull()
        expect(editorAfter.selectedTarget).toEqual(editorBefore.selectedTarget)
        expect(editorAfter.draft.profileVersionId).toBe(original.id)
        expect(proposed).toEqual(snapshot)
    } finally {
        closeDatabase(database)
    }
})
