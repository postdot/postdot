import { describe, expect, it } from 'bun:test'

import type { ChannelProfileDefinition } from '@postbot/core'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { createPublisherCredentialStore } from './publisher-credential-store'
import { createPublisherStore } from './publisher-store'
import {
    jobs,
    posts,
    publisherConnections,
    publisherCredentials,
    publicationTargetRevisions,
    publications,
    publishers,
} from './schema'

const now = 1_800_000_000_000
const encryptionKey = new Uint8Array(32).fill(7)

const linkedinProfile: ChannelProfileDefinition = {
    id: 'linkedin',
    version: 1,
    profileHash: 'sha256:linkedin-profile-v1',
    schemaHash: 'sha256:linkedin-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: { commentary: { type: 'string', minLength: 1, maxLength: 3000 } },
        required: ['commentary'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'commentary', semantic: 'primary_text', path: '/commentary' }],
    capabilities: {
        revision: 'linkedin-v1',
        textFields: [
            {
                bindingId: 'commentary',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: 3000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'linkedin', revision: 'text-v1' },
}

const sourceContent = (text: string) => ({
    body: { text, format: 'plain_text' as const },
    media: [],
})

async function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const manualStore = createManualStore(database, { now: () => now })
    const credentialStore = createPublisherCredentialStore(database, {
        cipher: createPublisherCredentialCipher({ keyId: 'test-v1', key: encryptionKey }),
        now: () => now,
    })
    const publisherStore = createPublisherStore(database, {
        credentialRevoker: credentialStore,
        connectionPolicies: {
            linkedin: {
                defaultDestination: credential => ({
                    type: 'member',
                    id: credential.externalAccountId,
                    name: credential.externalAccountName,
                }),
                validateDestination: destination =>
                    (destination.type === 'member' || destination.type === 'organization') &&
                    destination.id.trim().length > 0 &&
                    !/\s/.test(destination.id) &&
                    !destination.id.startsWith('urn:') &&
                    (destination.type !== 'organization' || /^[1-9]\d*$/.test(destination.id)) &&
                    (destination.name === null || destination.name.trim().length > 0),
            },
        },
        now: () => now,
    })
    const project = manualStore.createProject({
        name: 'Publisher Project',
        subjectId: 'user-1',
        displayName: 'Postbot Operator',
    })
    const channel = manualStore.createChannel({
        projectId: project.project.id,
        subjectId: 'user-1',
        name: 'LinkedIn',
        profile: linkedinProfile,
    })
    if (channel === null) throw new Error('The test channel was not created')

    return { database, manualStore, credentialStore, publisherStore, project, channel }
}

async function createCredential(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    input: {
        readonly id?: string
        readonly providerId?: string
        readonly connectedByActorId?: string
        readonly externalAccountId?: string
        readonly scopes?: readonly string[]
    } = {}
) {
    const result = await fixture.credentialStore.createPublisherCredential({
        projectId: fixture.project.project.id,
        connectedByActorId: input.connectedByActorId ?? fixture.project.actor.id,
        providerId: input.providerId ?? 'linkedin',
        externalAccountId: input.externalAccountId ?? 'member-42',
        externalAccountName: 'Postbot Operator',
        scopes: input.scopes ?? ['openid', 'profile', 'w_member_social'],
        accessToken: `${input.id ?? 'credential'}-access-token`,
        refreshToken: `${input.id ?? 'credential'}-refresh-token`,
    })
    if (result.kind !== 'created') throw new Error(`Credential was not created: ${result.kind}`)
    return result.credential
}

describe('publisher connection store', () => {
    it('creates a project-scoped connection without returning token material', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture)
            expect(
                fixture.publisherStore.hasChannelAccess(
                    fixture.project.project.id,
                    fixture.channel.id,
                    'user-1'
                )
            ).toBe(true)
            expect(
                fixture.publisherStore.hasChannelAccess(
                    fixture.project.project.id,
                    'missing-channel',
                    'user-1'
                )
            ).toBe(false)
            expect(
                fixture.publisherStore.hasChannelAccess(
                    fixture.project.project.id,
                    fixture.channel.id,
                    'user-2'
                )
            ).toBe(false)

            const result = fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return

            expect(result.connection).toMatchObject({
                credentialId: credential.id,
                channelId: fixture.channel.id,
                connectedByActorId: fixture.project.actor.id,
                externalAccountId: 'member-42',
                kind: 'linkedin',
                providerId: 'linkedin',
                scopes: ['openid', 'profile', 'w_member_social'],
                state: 'active',
                destination: {
                    type: 'member',
                    id: 'member-42',
                    name: 'Postbot Operator',
                },
            })
            expect(result.connection).not.toHaveProperty('accessToken')
            expect(result.connection).not.toHaveProperty('refreshToken')
            expect(fixture.database.select().from(publishers).all()).toHaveLength(1)
            expect(fixture.database.select().from(publisherConnections).all()).toHaveLength(1)
            expect(
                fixture.database.$client
                    .query<{ table: string }, []>(
                        `pragma foreign_key_list('publisher_connections')`
                    )
                    .all()
                    .map(row => row.table)
            ).not.toContain('account')
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('persists an organization destination separately from the OAuth member', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture, {
                scopes: ['openid', 'profile', 'w_organization_social', 'rw_organization_admin'],
            })
            const result = fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
                destination: {
                    type: 'organization',
                    id: '12345',
                    name: 'Tala Web',
                },
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return
            expect(result.connection.externalAccountId).toBe('member-42')
            expect(result.connection.destination).toEqual({
                type: 'organization',
                id: '12345',
                name: 'Tala Web',
            })
            expect(
                fixture.publisherStore.listPublisherConnections(
                    fixture.project.project.id,
                    'user-1'
                )
            ).toMatchObject([
                {
                    destination: { type: 'organization', id: '12345', name: 'Tala Web' },
                },
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects destinations on custom HTTP and unknown publisher connections', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture, { providerId: 'custom_http' })
            expect(
                fixture.publisherStore.createPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    kind: 'custom_http',
                    credentialId: credential.id,
                    endpointUrl: 'https://example.test',
                    authentication: { kind: 'none' },
                    destination: { type: 'member', id: 'member-42', name: null },
                })
            ).toEqual({ kind: 'invalid_connection' })

            const unknownCredential = await createCredential(fixture, {
                id: 'unknown-provider',
                providerId: 'unknown-provider',
            })
            expect(
                fixture.publisherStore.createPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    kind: 'unknown-provider',
                    credentialId: unknownCredential.id,
                })
            ).toEqual({ kind: 'invalid_connection' })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects inaccessible, mismatched, and unavailable credentials', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture)
            const otherProject = fixture.manualStore.createProject({
                name: 'Other Project',
                subjectId: 'user-1',
                displayName: 'Postbot Operator',
            })
            const otherChannel = fixture.manualStore.createChannel({
                projectId: otherProject.project.id,
                subjectId: 'user-1',
                name: 'Other Channel',
            })
            if (otherChannel === null) throw new Error('The second test channel was not created')

            expect(
                fixture.publisherStore.createPublisherConnection({
                    projectId: otherProject.project.id,
                    channelId: otherChannel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.id,
                })
            ).toEqual({ kind: 'invalid_credential' })

            const mastodonCredential = await createCredential(fixture, {
                id: 'mastodon',
                providerId: 'mastodon',
                externalAccountId: 'mastodon-account',
            })
            expect(
                fixture.publisherStore.createPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: mastodonCredential.id,
                })
            ).toEqual({ kind: 'invalid_credential' })

            fixture.credentialStore.markPublisherCredentialReconnectRequired(
                fixture.project.project.id,
                credential.id
            )
            expect(
                fixture.publisherStore.createPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: credential.id,
                })
            ).toEqual({ kind: 'credential_unavailable' })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('does not create a second publisher for a channel and revokes an unused credential', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture)
            const input = {
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
            } as const

            expect(fixture.publisherStore.createPublisherConnection(input).kind).toBe('created')
            expect(fixture.publisherStore.createPublisherConnection(input)).toEqual({
                kind: 'publisher_exists',
            })
            expect(fixture.database.select().from(publishers).all()).toHaveLength(1)
            expect(fixture.database.select().from(publisherConnections).all()).toHaveLength(1)

            expect(
                fixture.publisherStore.listPublisherConnections(
                    fixture.project.project.id,
                    'user-1'
                )
            ).toHaveLength(1)
            expect(
                fixture.publisherStore.getPublisherConnection(
                    fixture.project.project.id,
                    fixture.channel.id,
                    'user-1'
                )
            ).toMatchObject({ state: 'active', channelId: fixture.channel.id })
            expect(
                fixture.publisherStore.listPublisherConnections(
                    fixture.project.project.id,
                    'user-2'
                )
            ).toBeNull()

            const disconnected = fixture.publisherStore.disconnectPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
            })
            expect(disconnected.kind).toBe('disconnected')
            expect(
                fixture.publisherStore.listPublisherConnections(
                    fixture.project.project.id,
                    'user-1'
                )
            ).toEqual([])
            expect(fixture.database.select().from(publishers).all()).toEqual([])
            expect(fixture.database.select().from(publisherConnections).all()).toEqual([])
            expect(
                fixture.database
                    .select({ state: publisherCredentials.state })
                    .from(publisherCredentials)
                    .all()
            ).toEqual([{ state: 'revoked' }])
            await expect(
                fixture.credentialStore.resolvePublisherCredentialSecrets(
                    fixture.project.project.id,
                    credential.id
                )
            ).resolves.toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('replaces a stale connection while keeping active connections protected', async () => {
        const fixture = await createFixture()

        try {
            const staleCredential = await createCredential(fixture)
            const initial = fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: staleCredential.id,
            })
            expect(initial.kind).toBe('created')

            const replacementCredential = await createCredential(fixture, {
                id: 'replacement',
                externalAccountId: 'member-43',
            })
            expect(
                fixture.publisherStore.createPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: replacementCredential.id,
                    replaceNonActiveConnection: {
                        id: initial.kind === 'created' ? initial.connection.id : 'missing',
                        state: 'reconnect_required',
                    },
                })
            ).toEqual({ kind: 'publisher_exists' })

            fixture.credentialStore.markPublisherCredentialReconnectRequired(
                fixture.project.project.id,
                staleCredential.id
            )
            const replaced = fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: replacementCredential.id,
                replaceNonActiveConnection: {
                    id: initial.kind === 'created' ? initial.connection.id : 'missing',
                    state: 'reconnect_required',
                },
            })
            expect(replaced.kind).toBe('created')
            if (replaced.kind !== 'created') return

            expect(replaced.connection).toMatchObject({
                credentialId: replacementCredential.id,
                externalAccountId: 'member-43',
                state: 'active',
            })
            expect(fixture.database.select().from(publishers).all()).toHaveLength(1)
            expect(fixture.database.select().from(publisherConnections).all()).toHaveLength(1)
            expect(
                fixture.database
                    .select({ id: publisherCredentials.id, state: publisherCredentials.state })
                    .from(publisherCredentials)
                    .all()
                    .sort((left, right) => left.state.localeCompare(right.state))
            ).toEqual([
                { id: replacementCredential.id, state: 'active' },
                { id: staleCredential.id, state: 'revoked' },
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('queues scheduled publications created before the publisher was connected', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture)
            const post = fixture.manualStore.createPost({
                projectId: fixture.project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('Scheduled before the publisher was connected'),
                publications: [
                    {
                        channelId: fixture.channel.id,
                        deliveryMode: 'automatic',
                        scheduledAt: now,
                    },
                ],
            })
            expect(post?.publications[0]?.state).toBe('scheduled')
            expect(fixture.database.select().from(jobs).all()).toEqual([])

            const connection = fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
            })
            expect(connection.kind).toBe('created')
            expect(fixture.database.select().from(jobs).all()).toHaveLength(1)
            expect(fixture.database.select().from(jobs).all()[0]?.runAt).toBe(now)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('blocks disconnecting a publisher while a publication is active', async () => {
        const fixture = await createFixture()

        try {
            const credential = await createCredential(fixture)
            const connection = fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
            })
            expect(connection.kind).toBe('created')

            fixture.database
                .insert(posts)
                .values({
                    id: 'post-1',
                    projectId: fixture.project.project.id,
                    sourceContent: sourceContent('Active publication'),
                    sourceRevision: 1,
                    createdByActorId: fixture.project.actor.id,
                })
                .run()
            fixture.database
                .insert(publications)
                .values({
                    id: 'publication-1',
                    projectId: fixture.project.project.id,
                    postId: 'post-1',
                    channelId: fixture.channel.id,
                    targetRevisionId: 'target-1',
                    deliveryMode: 'automatic',
                    reviewState: 'compatible',
                    state: 'scheduled',
                    scheduledAt: now,
                    createdByActorId: fixture.project.actor.id,
                    scheduledByActorId: fixture.project.actor.id,
                    stateChangedByActorId: fixture.project.actor.id,
                })
                .run()
            fixture.database
                .insert(publicationTargetRevisions)
                .values({
                    id: 'target-1',
                    projectId: fixture.project.project.id,
                    publicationId: 'publication-1',
                    sequence: 1,
                    profileVersionId: fixture.channel.profileVersionId,
                    sourceRevision: 1,
                    deliveryMode: 'automatic',
                    contentJson: { commentary: 'Active publication' },
                    contentHash: 'sha256:active-content',
                    profileHash: linkedinProfile.profileHash,
                    schemaHash: linkedinProfile.schemaHash,
                    validationIssuesJson: [],
                    createdByActorId: fixture.project.actor.id,
                })
                .run()

            expect(
                fixture.publisherStore.disconnectPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                })
            ).toEqual({ kind: 'active_work' })
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
