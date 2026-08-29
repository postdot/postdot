import { describe, expect, it } from 'bun:test'

import { eq } from 'drizzle-orm'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createPublisherStore } from './publisher-store'
import {
    account,
    jobs,
    posts,
    publisherConnections,
    publications,
    publishers,
    user,
} from './schema'

const now = 1_800_000_000_000

function seedAccount(
    database: ReturnType<typeof createDatabase>,
    input: {
        readonly id: string
        readonly userId: string
        readonly providerId?: string
        readonly scope?: string
    }
) {
    database
        .insert(user)
        .values({
            id: input.userId,
            name: `User ${input.userId}`,
            email: `${input.userId}@herald.local`,
        })
        .onConflictDoNothing()
        .run()
    database
        .insert(account)
        .values({
            id: input.id,
            issuer: `local:oauth:${input.providerId ?? 'linkedin'}`,
            accountId: `${input.id}-external`,
            providerId: input.providerId ?? 'linkedin',
            userId: input.userId,
            scope: input.scope ?? 'openid,profile,w_member_social',
            updatedAt: new Date(now),
        })
        .run()
}

describe('publisher connection store', () => {
    it('creates a project-scoped connection without returning token material', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedAccount(database, { id: 'account-1', userId: 'user-1' })

            const manualStore = createManualStore(database, { now: () => now })
            const publisherStore = createPublisherStore(database, {
                now: () => now,
                createId: (() => {
                    let sequence = 0
                    return () => `generated-${++sequence}`
                })(),
            })
            const project = manualStore.createProject({
                name: 'Connected Project',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn',
            })
            expect(
                publisherStore.hasChannelAccess(project.project.id, channel?.id ?? '', 'user-1')
            ).toBe(true)
            expect(
                publisherStore.hasChannelAccess(project.project.id, 'missing-channel', 'user-1')
            ).toBe(false)
            expect(
                publisherStore.hasChannelAccess(project.project.id, channel?.id ?? '', 'user-2')
            ).toBe(false)

            const result = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel?.id ?? '',
                subjectId: 'user-1',
                kind: 'linkedin',
                accountId: 'account-1',
                requiredScopes: ['w_member_social'],
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return

            expect(result.connection).toMatchObject({
                accountId: 'account-1',
                channelId: channel?.id,
                connectedByActorId: project.actor.id,
                kind: 'linkedin',
                providerId: 'linkedin',
            })
            expect(result.connection).not.toHaveProperty('accessToken')
            expect(result.connection).not.toHaveProperty('refreshToken')
            expect(database.select().from(publishers).all()).toHaveLength(1)
            expect(database.select().from(publisherConnections).all()).toHaveLength(1)
            expect(() => database.delete(account).run()).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects inaccessible, mismatched, and under-scoped accounts', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedAccount(database, { id: 'account-1', userId: 'user-1' })
            seedAccount(database, {
                id: 'account-2',
                userId: 'user-2',
            })
            seedAccount(database, {
                id: 'account-3',
                userId: 'user-1',
                scope: 'openid,profile',
            })
            seedAccount(database, {
                id: 'account-4',
                userId: 'user-1',
                providerId: 'mastodon',
                scope: 'write:statuses',
            })

            const manualStore = createManualStore(database, { now: () => now })
            const publisherStore = createPublisherStore(database, { now: () => now })
            const project = manualStore.createProject({
                name: 'Connection Checks',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn',
            })
            const input = {
                projectId: project.project.id,
                channelId: channel?.id ?? '',
                subjectId: 'user-1',
                kind: 'linkedin',
                requiredScopes: ['w_member_social'],
            } as const

            expect(
                publisherStore.createPublisherConnection({
                    ...input,
                    accountId: 'account-2',
                })
            ).toEqual({ kind: 'invalid_account' })
            expect(
                publisherStore.createPublisherConnection({
                    ...input,
                    accountId: 'account-3',
                })
            ).toEqual({ kind: 'missing_scopes', scopes: ['w_member_social'] })
            expect(
                publisherStore.createPublisherConnection({
                    ...input,
                    accountId: 'account-4',
                })
            ).toEqual({ kind: 'invalid_account' })
            expect(
                publisherStore.createPublisherConnection({
                    ...input,
                    projectId: 'missing-project',
                    accountId: 'account-1',
                })
            ).toEqual({ kind: 'not_found' })
        } finally {
            closeDatabase(database)
        }
    })

    it('does not create a second publisher for a channel', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedAccount(database, { id: 'account-1', userId: 'user-1' })
            const manualStore = createManualStore(database, { now: () => now })
            const publisherStore = createPublisherStore(database, { now: () => now })
            const project = manualStore.createProject({
                name: 'Unique Publisher',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn',
            })
            const input = {
                projectId: project.project.id,
                channelId: channel?.id ?? '',
                subjectId: 'user-1',
                kind: 'linkedin',
                accountId: 'account-1',
                requiredScopes: ['w_member_social'],
            } as const

            expect(publisherStore.createPublisherConnection(input).kind).toBe('created')
            expect(publisherStore.createPublisherConnection(input)).toEqual({
                kind: 'publisher_exists',
            })
            expect(database.select().from(publishers).all()).toHaveLength(1)
            expect(database.select().from(publisherConnections).all()).toHaveLength(1)

            expect(
                publisherStore.listPublisherConnections(project.project.id, 'user-1')
            ).toHaveLength(1)
            expect(publisherStore.listPublisherConnections(project.project.id, 'user-2')).toBeNull()

            const disconnected = publisherStore.disconnectPublisherConnection({
                projectId: project.project.id,
                channelId: channel?.id ?? '',
                subjectId: 'user-1',
            })
            expect(disconnected.kind).toBe('disconnected')
            expect(publisherStore.listPublisherConnections(project.project.id, 'user-1')).toEqual(
                []
            )
            expect(database.select().from(publishers).all()).toEqual([])
            expect(database.select().from(publisherConnections).all()).toEqual([])
            expect(() =>
                database.delete(account).where(eq(account.id, 'account-1')).run()
            ).not.toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('queues scheduled publications created before the publisher was connected', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedAccount(database, { id: 'account-1', userId: 'user-1' })
            const manualStore = createManualStore(database, { now: () => now })
            const publisherStore = createPublisherStore(database, { now: () => now })
            const project = manualStore.createProject({
                name: 'Backfill Scheduled Work',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn',
            })
            expect(channel).not.toBeNull()
            if (channel === null) throw new Error('The test channel was not created')

            const post = manualStore.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                content: 'Scheduled before account binding',
                publications: [{ channelId: channel.id, scheduledAt: now }],
            })
            expect(post?.publications[0]?.state).toBe('scheduled')
            expect(database.select().from(jobs).all()).toEqual([])

            const connection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel.id,
                subjectId: 'user-1',
                kind: 'linkedin',
                accountId: 'account-1',
                requiredScopes: ['w_member_social'],
            })
            expect(connection.kind).toBe('created')
            expect(database.select().from(jobs).all()).toHaveLength(1)
            expect(database.select().from(jobs).all()[0]?.runAt).toBe(now)
        } finally {
            closeDatabase(database)
        }
    })

    it('blocks disconnecting a publisher while a publication is active', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedAccount(database, { id: 'account-1', userId: 'user-1' })
            const manualStore = createManualStore(database, { now: () => now })
            const publisherStore = createPublisherStore(database, { now: () => now })
            const project = manualStore.createProject({
                name: 'Active Work',
                subjectId: 'user-1',
                displayName: 'Herald Operator',
            })
            const channel = manualStore.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'LinkedIn',
            })
            const connection = publisherStore.createPublisherConnection({
                projectId: project.project.id,
                channelId: channel?.id ?? '',
                subjectId: 'user-1',
                kind: 'linkedin',
                accountId: 'account-1',
            })
            expect(connection.kind).toBe('created')

            database
                .insert(posts)
                .values({
                    id: 'post-1',
                    projectId: project.project.id,
                    content: 'Active publication',
                    createdByActorId: project.actor.id,
                })
                .run()
            database
                .insert(publications)
                .values({
                    id: 'publication-1',
                    projectId: project.project.id,
                    postId: 'post-1',
                    channelId: channel?.id ?? '',
                    content: 'Active publication',
                    state: 'scheduled',
                    scheduledAt: now,
                    createdByActorId: project.actor.id,
                    scheduledByActorId: project.actor.id,
                    stateChangedByActorId: project.actor.id,
                })
                .run()

            expect(
                publisherStore.disconnectPublisherConnection({
                    projectId: project.project.id,
                    channelId: channel?.id ?? '',
                    subjectId: 'user-1',
                })
            ).toEqual({ kind: 'active_work' })
        } finally {
            closeDatabase(database)
        }
    })
})
