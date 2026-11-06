import { describe, expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChannelProfileDefinition } from '@postdot/core'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { defaultMigrationsFolder, runMigrations } from './migrations'
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
import { seedTestWorkspace } from './testing'
import { createWorkflowStore } from './workflow-store'

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
    const project = await manualStore.createProject({
        workspaceId: await seedTestWorkspace(database),
        name: 'Publisher Project',
        subjectId: 'user-1',
        displayName: 'Postdot Operator',
    })
    const channel = await manualStore.createChannel({
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
        externalAccountName: 'Postdot Operator',
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
                await fixture.publisherStore.hasChannelAccess(
                    fixture.project.project.id,
                    fixture.channel.id,
                    'user-1'
                )
            ).toBe(true)
            expect(
                await fixture.publisherStore.hasChannelAccess(
                    fixture.project.project.id,
                    'missing-channel',
                    'user-1'
                )
            ).toBe(false)
            expect(
                await fixture.publisherStore.hasChannelAccess(
                    fixture.project.project.id,
                    fixture.channel.id,
                    'user-2'
                )
            ).toBe(false)

            const result = await fixture.publisherStore.createPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return

            // Attribution is the workspace actor snapshot of the connecting project actor.
            expect(
                fixture.database.$client
                    .query<{ origin: string }, [string]>(
                        'select origin_actor_id as origin from actors where id = ?'
                    )
                    .get(result.connection.connectedByActorId)?.origin
            ).toBe(fixture.project.actor.id)
            expect(result.connection).toMatchObject({
                credentialId: credential.id,
                channelId: fixture.channel.id,
                externalAccountId: 'member-42',
                kind: 'linkedin',
                providerId: 'linkedin',
                scopes: ['openid', 'profile', 'w_member_social'],
                state: 'active',
                destination: {
                    type: 'member',
                    id: 'member-42',
                    name: 'Postdot Operator',
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
            const result = await fixture.publisherStore.createPublisherConnection({
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
                await fixture.publisherStore.listPublisherConnections(
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
                await fixture.publisherStore.createPublisherConnection({
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
                await fixture.publisherStore.createPublisherConnection({
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
            const otherProject = await fixture.manualStore.createProject({
                workspaceId: await seedTestWorkspace(fixture.database),
                name: 'Other Project',
                subjectId: 'user-1',
                displayName: 'Postdot Operator',
            })
            const otherChannel = await fixture.manualStore.createChannel({
                projectId: otherProject.project.id,
                subjectId: 'user-1',
                name: 'Other Channel',
            })
            if (otherChannel === null) throw new Error('The second test channel was not created')

            expect(
                await fixture.publisherStore.createPublisherConnection({
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
                await fixture.publisherStore.createPublisherConnection({
                    projectId: fixture.project.project.id,
                    channelId: fixture.channel.id,
                    subjectId: 'user-1',
                    kind: 'linkedin',
                    credentialId: mastodonCredential.id,
                })
            ).toEqual({ kind: 'invalid_credential' })

            await fixture.credentialStore.markPublisherCredentialReconnectRequired(
                fixture.project.project.id,
                credential.id
            )
            expect(
                await fixture.publisherStore.createPublisherConnection({
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

            expect((await fixture.publisherStore.createPublisherConnection(input)).kind).toBe(
                'created'
            )
            expect(await fixture.publisherStore.createPublisherConnection(input)).toEqual({
                kind: 'publisher_exists',
            })
            expect(fixture.database.select().from(publishers).all()).toHaveLength(1)
            expect(fixture.database.select().from(publisherConnections).all()).toHaveLength(1)

            expect(
                await fixture.publisherStore.listPublisherConnections(
                    fixture.project.project.id,
                    'user-1'
                )
            ).toHaveLength(1)
            expect(
                await fixture.publisherStore.getPublisherConnection(
                    fixture.project.project.id,
                    fixture.channel.id,
                    'user-1'
                )
            ).toMatchObject({ state: 'active', channelId: fixture.channel.id })
            expect(
                await fixture.publisherStore.listPublisherConnections(
                    fixture.project.project.id,
                    'user-2'
                )
            ).toBeNull()

            const disconnected = await fixture.publisherStore.disconnectPublisherConnection({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
            })
            expect(disconnected.kind).toBe('disconnected')
            expect(
                await fixture.publisherStore.listPublisherConnections(
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
            const initial = await fixture.publisherStore.createPublisherConnection({
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
                await fixture.publisherStore.createPublisherConnection({
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

            await fixture.credentialStore.markPublisherCredentialReconnectRequired(
                fixture.project.project.id,
                staleCredential.id
            )
            const replaced = await fixture.publisherStore.createPublisherConnection({
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
            const post = await fixture.manualStore.createPost({
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

            const connection = await fixture.publisherStore.createPublisherConnection({
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
            const connection = await fixture.publisherStore.createPublisherConnection({
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
                await fixture.publisherStore.disconnectPublisherConnection({
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

describe('confirmed publisher destination', () => {
    async function scenario() {
        const f = await createFixture()
        const first = await createCredential(f)
        const connected = await f.publisherStore.createPublisherConnection({
            projectId: f.project.project.id,
            channelId: f.channel.id,
            subjectId: 'user-1',
            kind: 'linkedin',
            credentialId: first.id,
        })
        if (connected.kind !== 'created') throw new Error('Connection missing')
        const created = (await f.manualStore.createPost({
            projectId: f.project.project.id,
            subjectId: 'user-1',
            sourceContent: sourceContent('Retained content'),
            publications: [
                { channelId: f.channel.id, deliveryMode: 'automatic', scheduledAt: now },
            ],
        }))!
        const publication = created.publications[0]!
        const workflow = createWorkflowStore(f.database)
        const actorId = (await workflow.ensureSystemActor(f.project.project.id, now))!
        function claim(token = 'claim', at = now) {
            return workflow.claimNextDueJob({
                actorId,
                claimToken: token,
                now: at,
                leaseExpiresAt: at + 60000,
            })
        }
        async function replace(account = 'member-43') {
            const current = (await f.publisherStore.getPublisherConnection(
                f.project.project.id,
                f.channel.id,
                'user-1'
            ))!
            await f.credentialStore.markPublisherCredentialReconnectRequired(
                f.project.project.id,
                current.credentialId
            )
            let credential = first
            if (account !== first.externalAccountId)
                credential = await createCredential(f, { externalAccountId: account })
            else {
                await f.credentialStore.replacePublisherCredentialTokens({
                    projectId: f.project.project.id,
                    credentialId: first.id,
                    accessToken: 'fresh-token',
                    expiresAt: null,
                })
            }
            return f.publisherStore.createPublisherConnection({
                projectId: f.project.project.id,
                channelId: f.channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                credentialId: credential.id,
                replaceNonActiveConnection: {
                    id: current.id,
                    state: 'reconnect_required',
                },
            })
        }
        const state = async () =>
            (await f.manualStore.getPublicationDestination(
                f.project.project.id,
                publication.id,
                'user-1'
            ))!
        const confirm = async (requestedRevision?: number) => {
            const revision = requestedRevision ?? (await state()).revision
            return (await f.manualStore.confirmPublicationDestination({
                projectId: f.project.project.id,
                publicationId: publication.id,
                subjectId: 'user-1',
                expectedRevision: revision,
                expectedTargetRevisionId: publication.targetRevisionId,
            }))!
        }
        return { ...f, first, publication, workflow, claim, replace, state, confirm }
    }

    it('holds scheduled work for a changed destination and resumes only after explicit confirmation', async () => {
        const f = await scenario()
        try {
            const targets = f.database.select().from(publicationTargetRevisions).all()
            expect((await f.replace()).kind).toBe('created')
            expect(await f.state()).toMatchObject({
                revision: 1,
                confirmedRevision: 0,
                requiresConfirmation: true,
            })
            expect(await f.claim()).toBeNull()
            expect(await f.workflow.getNextEventAt()).toBeNull()
            await expect(f.confirm(0)).rejects.toThrow()
            expect((await f.confirm()).requiresConfirmation).toBe(false)
            const job = (await f.claim())!
            expect(await f.workflow.startExternalEffect(job.id, 'claim', now)).toBe(true)
            expect(
                (await f.publisherStore.getPublisherExecutionTarget(job.id, 'claim'))
                    ?.externalAccountId
            ).toBe('member-43')
            expect(f.database.select().from(publicationTargetRevisions).all()).toEqual(targets)
            expect((await f.state()).history[0]?.destination).toMatchObject({
                externalAccountId: 'member-43',
                revision: 1,
            })
            expect(JSON.stringify(await f.state())).not.toContain('fresh-token')
        } finally {
            closeDatabase(f.database)
        }
    })
    it('rechecks a claim acquired before replacement without losing its scheduled work', async () => {
        const f = await scenario()
        try {
            const job = (await f.claim())!
            await f.replace()
            expect(await f.workflow.startExternalEffect(job.id, 'claim', now)).toBe(false)
            expect(f.database.select().from(jobs).all()[0]?.state).toBe('pending')
            expect((await f.state()).history).toEqual([])
            await f.confirm()
            const next = (await f.claim('next'))!
            expect(next.id).toBe(job.id)
            expect(await f.workflow.startExternalEffect(next.id, 'next', now)).toBe(true)
        } finally {
            closeDatabase(f.database)
        }
    })
    it('does not require confirmation for reauthorization of the same account', async () => {
        const f = await scenario()
        try {
            expect((await f.replace('member-42')).kind).toBe('created')
            expect((await f.state()).requiresConfirmation).toBe(false)
            expect((await f.state()).revision).toBe(0)
            const job = (await f.claim())!
            expect(await f.workflow.startExternalEffect(job.id, 'claim', now)).toBe(true)
        } finally {
            closeDatabase(f.database)
        }
    })
    it('preserves the executed identity and refuses to resolve a new account for an old effect', async () => {
        const f = await scenario()
        try {
            const job = (await f.claim())!
            expect(await f.workflow.startExternalEffect(job.id, 'claim', now)).toBe(true)
            const before = (await f.state()).history
            await f.replace()
            expect(await f.publisherStore.getPublisherExecutionTarget(job.id, 'claim')).toBeNull()
            expect((await f.state()).history).toEqual(before)
            expect((await f.state()).history[0]?.destination?.externalAccountId).toBe('member-42')
            expect(
                await f.workflow.completeExternalEffect({
                    jobId: job.id,
                    claimToken: 'claim',
                    completedAt: now,
                    outcome: { type: 'published', externalId: 'original-receipt' },
                })
            ).toBe('published')
            expect((await f.state()).history).toEqual(before)
        } finally {
            closeDatabase(f.database)
        }
    })
    it('suppresses automatic retries across a changed destination and preserves old execution when explicitly retried', async () => {
        const f = await scenario()
        try {
            const job = (await f.claim())!
            expect(await f.workflow.startExternalEffect(job.id, 'claim', now)).toBe(true)
            await f.replace()
            expect(
                await f.workflow.completeExternalEffect({
                    jobId: job.id,
                    claimToken: 'claim',
                    completedAt: now,
                    retryAt: now + 10,
                    outcome: {
                        type: 'retryable_failure',
                        effectOccurred: false,
                        errorMessage: 'No effect',
                    },
                })
            ).toBe('failed')
            expect(
                (
                    await f.manualStore.retryFailedPublication({
                        projectId: f.project.project.id,
                        publicationId: f.publication.id,
                        subjectId: 'user-1',
                    })
                ).kind
            ).toBe('not_retryable')
            await f.confirm()
            expect(
                (
                    await f.manualStore.retryFailedPublication({
                        projectId: f.project.project.id,
                        publicationId: f.publication.id,
                        subjectId: 'user-1',
                    })
                ).kind
            ).toBe('retried')
            const next = (await f.claim('next'))!
            expect(next.id).not.toBe(job.id)
            expect(await f.workflow.startExternalEffect(next.id, 'next', now)).toBe(true)
            expect(
                (await f.state()).history.map(row => row.destination?.externalAccountId).sort()
            ).toEqual(['member-42', 'member-43'])
        } finally {
            closeDatabase(f.database)
        }
    })
    it('keeps generations monotonic through disconnect and distinguishes fresh work', async () => {
        const f = await scenario()
        try {
            await f.replace()
            const created = (await f.manualStore.createPost({
                projectId: f.project.project.id,
                subjectId: 'user-1',
                sourceContent: sourceContent('New destination chosen'),
                publications: [{ channelId: f.channel.id, deliveryMode: 'automatic' }],
            }))!
            expect(
                (
                    await f.manualStore.getPublicationDestination(
                        f.project.project.id,
                        created.publications[0]!.id,
                        'user-1'
                    )
                )?.requiresConfirmation
            ).toBe(false)
            expect(
                await f.manualStore.getPublicationDestination(
                    f.project.project.id,
                    f.publication.id,
                    'missing'
                )
            ).toBeNull()
            await expect(
                f.manualStore.confirmPublicationDestination({
                    projectId: f.project.project.id,
                    publicationId: f.publication.id,
                    subjectId: 'user-1',
                    expectedRevision: 1,
                    expectedTargetRevisionId: 'stale',
                })
            ).rejects.toThrow()
        } finally {
            closeDatabase(f.database)
        }
    })
    it('does not forget a changed destination when the original account is restored', async () => {
        const f = await scenario()
        try {
            expect((await f.replace()).kind).toBe('created')
            expect((await f.replace('member-42')).kind).toBe('created')
            expect(await f.state()).toMatchObject({
                revision: 2,
                confirmedRevision: 0,
                requiresConfirmation: true,
            })
            expect(await f.claim()).toBeNull()
        } finally {
            closeDatabase(f.database)
        }
    })
    it('preserves data when applying destination-identity SQL to the prior column shape', async () => {
        const f = await scenario()
        const folder = mkdtempSync(join(tmpdir(), 'postdot-destination-sql-'))
        try {
            const job = (await f.claim())!
            expect(await f.workflow.startExternalEffect(job.id, 'claim', now)).toBe(true)
            expect(
                await f.workflow.completeExternalEffect({
                    jobId: job.id,
                    claimToken: 'claim',
                    completedAt: now,
                    outcome: { type: 'published', externalId: 'kept-receipt' },
                })
            ).toBe('published')
            const originalTargets = f.database.select().from(publicationTargetRevisions).all()
            const before = f.database.$client
                .query(
                    'select content_json, content_hash, profile_hash, target_revision_id from publication_execution_revisions'
                )
                .all()
            // Construct exactly the additive migration's previous column shape in this owned in-memory fixture.
            f.database.$client.run('alter table channels drop column destination_revision')
            f.database.$client.run('alter table channels drop column destination_identity_json')
            f.database.$client.run(
                'alter table publications drop column confirmed_destination_revision'
            )
            f.database.$client.run(
                'alter table publication_execution_revisions drop column destination_snapshot_json'
            )
            // Exercise this additive SQL in isolation. Later migrations may
            // already exist; never mistake the newest journal entry for this one.
            const journal = JSON.parse(
                readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
            ) as { entries: { idx: number; tag: string; when: number }[] }
            const entry = journal.entries.find(
                row => row.tag === '0020_channel_destination_identity'
            )!
            mkdirSync(join(folder, 'meta'))
            copyFileSync(
                join(defaultMigrationsFolder, `${entry.tag}.sql`),
                join(folder, `${entry.tag}.sql`)
            )
            writeFileSync(
                join(folder, 'meta/_journal.json'),
                JSON.stringify({
                    version: '7',
                    dialect: 'sqlite',
                    entries: [
                        { ...entry, when: Math.max(...journal.entries.map(row => row.when)) + 1 },
                    ],
                })
            )
            runMigrations(f.database, folder)
            expect(f.database.$client.query('pragma foreign_key_check').all()).toEqual([])
            expect(f.database.select().from(publicationTargetRevisions).all()).toEqual(
                originalTargets
            )
            expect(
                f.database.$client
                    .query(
                        'select content_json, content_hash, profile_hash, target_revision_id from publication_execution_revisions'
                    )
                    .all()
            ).toEqual(before)
            expect((await f.state()).history[0]?.destination).toBeNull()
            expect((await f.state()).requiresConfirmation).toBe(false)
        } finally {
            closeDatabase(f.database)
            rmSync(folder, { recursive: true, force: true })
        }
    })
    it('creates a fresh execution job when a pending automatic retry is reconfirmed for another destination', async () => {
        const f = await scenario()
        try {
            const old = (await f.claim())!
            expect(await f.workflow.startExternalEffect(old.id, 'claim', now)).toBe(true)
            expect(
                await f.workflow.completeExternalEffect({
                    jobId: old.id,
                    claimToken: 'claim',
                    completedAt: now,
                    retryAt: now + 10,
                    outcome: {
                        type: 'retryable_failure',
                        effectOccurred: false,
                        errorMessage: 'Retry later',
                    },
                })
            ).toBe('retry_scheduled')
            const history = (await f.state()).history
            await f.replace()
            expect(await f.claim('blocked', now + 10)).toBeNull()
            await f.confirm()
            const next = (await f.claim('next', now + 10))!
            expect(next.id).not.toBe(old.id)
            const confirmation = f.database.$client
                .query<{ metadata: string }, []>(
                    "select metadata_json as metadata from audit_events where action = 'publication.destination_confirmed' order by sequence desc limit 1"
                )
                .get()!
            expect(JSON.parse(confirmation.metadata)).toMatchObject({
                replacedJobId: old.id,
                replacementJobId: next.id,
            })
            expect(await f.workflow.startExternalEffect(next.id, 'next', now + 10)).toBe(true)
            expect(
                (await f.publisherStore.getPublisherExecutionTarget(next.id, 'next'))
                    ?.externalAccountId
            ).toBe('member-43')
            expect((await f.state()).history.find(entry => entry.id === history[0]!.id)).toEqual(
                history[0]
            )
        } finally {
            closeDatabase(f.database)
        }
    })
})
