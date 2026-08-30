import { describe, expect, it } from 'bun:test'

import type { HeraldDatabase } from './client'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import {
    actors,
    channels,
    jobs,
    oauthAuthorizationAttempts,
    posts,
    projects,
    publications,
    publisherCredentials,
    publishers,
} from './schema'

function seedProject(database: HeraldDatabase, suffix: string) {
    const projectId = `project-${suffix}`
    const actorId = `actor-${suffix}`
    const channelId = `channel-${suffix}`
    const postId = `post-${suffix}`

    database
        .insert(projects)
        .values({ id: projectId, name: `Project ${suffix}` })
        .run()
    database
        .insert(actors)
        .values({
            id: actorId,
            projectId,
            kind: 'human',
            displayName: `Editor ${suffix}`,
        })
        .run()
    database
        .insert(channels)
        .values({ id: channelId, projectId, name: `Channel ${suffix}` })
        .run()
    database
        .insert(posts)
        .values({
            id: postId,
            projectId,
            content: `Post ${suffix}`,
            createdByActorId: actorId,
        })
        .run()

    return { projectId, actorId, channelId, postId }
}

describe('domain schema', () => {
    it('enforces project ownership with composite foreign keys', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const first = seedProject(database, 'first')
            const second = seedProject(database, 'second')

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        id: 'cross-project-publication',
                        projectId: first.projectId,
                        postId: first.postId,
                        channelId: second.channelId,
                        content: 'Impossible relation',
                        state: 'draft',
                        createdByActorId: first.actorId,
                        stateChangedByActorId: first.actorId,
                    })
                    .run()
            ).toThrow()

            database
                .insert(publications)
                .values({
                    id: 'first-publication',
                    projectId: first.projectId,
                    postId: first.postId,
                    channelId: first.channelId,
                    content: 'Valid relation',
                    state: 'ready',
                    createdByActorId: first.actorId,
                    stateChangedByActorId: first.actorId,
                })
                .run()

            expect(() =>
                database
                    .insert(jobs)
                    .values({
                        id: 'cross-project-job',
                        projectId: second.projectId,
                        publicationId: 'first-publication',
                        state: 'pending',
                        runAt: 1_800_000_000_000,
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(posts)
                    .values({
                        id: 'cross-project-post',
                        projectId: first.projectId,
                        content: 'Impossible attribution',
                        createdByActorId: second.actorId,
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('allows manual channels and limits each channel to one publisher', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'manual')

            expect(database.select().from(publishers).all()).toEqual([])

            database
                .insert(publishers)
                .values({
                    id: 'publisher-one',
                    projectId: fixture.projectId,
                    channelId: fixture.channelId,
                    kind: 'mastodon',
                })
                .run()

            expect(() =>
                database
                    .insert(publishers)
                    .values({
                        id: 'publisher-two',
                        projectId: fixture.projectId,
                        channelId: fixture.channelId,
                        kind: 'bluesky',
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects invalid and incomplete publication states', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'states')
            const basePublication = {
                projectId: fixture.projectId,
                postId: fixture.postId,
                channelId: fixture.channelId,
                content: 'Publication content',
                createdByActorId: fixture.actorId,
                stateChangedByActorId: fixture.actorId,
            }

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'invalid-state',
                        state: 'unknown' as 'draft',
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'incomplete-publication',
                        state: 'published',
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'missing-error',
                        state: 'ambiguous',
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(publications)
                    .values({
                        ...basePublication,
                        id: 'unexpected-error',
                        state: 'ready',
                        errorMessage: 'Stale failure',
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects incomplete credential envelopes and cross-project attribution', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const first = seedProject(database, 'credential-first')
            const second = seedProject(database, 'credential-second')
            const activeCredential = {
                projectId: first.projectId,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                scopes: [],
                state: 'active' as const,
                connectedByActorId: first.actorId,
                encryptionVersion: 1,
                encryptionKeyId: 'primary',
                accessTokenCiphertext: Buffer.alloc(17, 1),
            }

            expect(() =>
                database
                    .insert(publisherCredentials)
                    .values({
                        ...activeCredential,
                        id: 'missing-access-nonce',
                    })
                    .run()
            ).toThrow()
            expect(() =>
                database
                    .insert(publisherCredentials)
                    .values({
                        ...activeCredential,
                        id: 'partial-refresh-envelope',
                        accessTokenNonce: Buffer.alloc(12, 2),
                        refreshTokenCiphertext: Buffer.alloc(17, 3),
                    })
                    .run()
            ).toThrow()
            expect(() =>
                database
                    .insert(publisherCredentials)
                    .values({
                        ...activeCredential,
                        id: 'cross-project-actor',
                        connectedByActorId: second.actorId,
                        accessTokenNonce: Buffer.alloc(12, 2),
                    })
                    .run()
            ).toThrow()
            expect(() =>
                database
                    .insert(publisherCredentials)
                    .values({
                        ...activeCredential,
                        id: 'revoked-with-secret',
                        state: 'revoked',
                        accessTokenNonce: Buffer.alloc(12, 2),
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects incomplete and contradictory OAuth authorization attempts', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'oauth-attempt')
            const pendingAttempt = {
                projectId: fixture.projectId,
                channelId: fixture.channelId,
                providerId: 'linkedin',
                connectedByActorId: fixture.actorId,
                callbackUri: 'https://herald.example.com/api/oauth/linkedin/callback',
                scopes: [],
                returnPath: '/projects/one',
                stateDigest: Buffer.alloc(32, 1),
                status: 'pending' as const,
                pkceEncryptionVersion: 1,
                pkceEncryptionKeyId: 'primary',
                pkceVerifierCiphertext: Buffer.alloc(17, 2),
                expiresAt: 1_800_000_060_000,
                createdAt: 1_800_000_000_000,
                updatedAt: 1_800_000_000_000,
            }

            expect(() =>
                database
                    .insert(oauthAuthorizationAttempts)
                    .values({ ...pendingAttempt, id: 'missing-pkce-nonce' })
                    .run()
            ).toThrow()
            expect(() =>
                database
                    .insert(oauthAuthorizationAttempts)
                    .values({
                        ...pendingAttempt,
                        id: 'invalid-state-digest',
                        stateDigest: Buffer.alloc(31, 1),
                        pkceVerifierNonce: Buffer.alloc(12, 3),
                    })
                    .run()
            ).toThrow()
            expect(() =>
                database
                    .insert(oauthAuthorizationAttempts)
                    .values({
                        ...pendingAttempt,
                        id: 'consumed-with-verifier',
                        status: 'consumed',
                        completedAt: 1_800_000_000_001,
                        pkceVerifierNonce: Buffer.alloc(12, 3),
                    })
                    .run()
            ).toThrow()
            expect(() =>
                database
                    .insert(oauthAuthorizationAttempts)
                    .values({
                        ...pendingAttempt,
                        id: 'external-return-path',
                        returnPath: '//attacker.example.com',
                        pkceVerifierNonce: Buffer.alloc(12, 3),
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('rejects job rows that contradict their lifecycle state', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            const fixture = seedProject(database, 'jobs')
            database
                .insert(publications)
                .values({
                    id: 'ready-publication',
                    projectId: fixture.projectId,
                    postId: fixture.postId,
                    channelId: fixture.channelId,
                    content: 'Ready publication',
                    state: 'ready',
                    createdByActorId: fixture.actorId,
                    stateChangedByActorId: fixture.actorId,
                })
                .run()

            const baseJob = {
                projectId: fixture.projectId,
                publicationId: 'ready-publication',
                runAt: 1_800_000_000_000,
            }

            expect(() =>
                database
                    .insert(jobs)
                    .values({
                        ...baseJob,
                        id: 'dirty-pending-job',
                        state: 'pending',
                        completedAt: 1_800_000_000_001,
                    })
                    .run()
            ).toThrow()

            expect(() =>
                database
                    .insert(jobs)
                    .values({
                        ...baseJob,
                        id: 'unstarted-failed-job',
                        state: 'failed',
                        completedAt: 1_800_000_000_001,
                        errorMessage: 'Connection refused',
                    })
                    .run()
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('commits scheduler indexes and leaves no foreign-key violations', () => {
        const database = createDatabase(':memory:')

        try {
            runMigrations(database)
            seedProject(database, 'integrity')

            const publicationIndexes = database.$client
                .query<{ name: string }, []>('pragma index_list(publications)')
                .all()
                .map(index => index.name)
            const jobIndexes = database.$client
                .query<{ name: string }, []>('pragma index_list(jobs)')
                .all()
                .map(index => index.name)

            expect(publicationIndexes).toContain('publications_state_scheduled_at_idx')
            expect(jobIndexes).toContain('jobs_state_run_at_idx')
            expect(jobIndexes).toContain('jobs_state_lease_expires_at_idx')
            expect(database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(database)
        }
    })
})
