import { describe, expect, it } from 'bun:test'

import { createManualChannelProfile } from '@postdot/core'

import { type DatabaseHandle } from './client'
import { describeSchema } from './sql/schema-introspection'
import {
    closeTestDatabase,
    foreignKeyViolations,
    insertRow,
    openTestDatabase,
    seedTestWorkspace,
    seedWorkspaceChannel,
    type TestRow,
    toDbValue,
    workspaceOf,
} from './testing'

async function seedProject(database: DatabaseHandle, suffix: string) {
    const projectId = `project-${suffix}`
    const actorId = `actor-${suffix}`
    const channelId = `channel-${suffix}`
    const postId = `post-${suffix}`
    const profileVersionId = `profile-${suffix}`
    const profile = createManualChannelProfile()

    await database.sql
        .statement('insert into "projects" ("id", "name", "workspace_id") values (?1, ?2, ?3)')
        .run(
            projectId,
            `Project ${suffix}`,
            await seedTestWorkspace(database, `workspace-${suffix}`)
        )
    await database.sql
        .statement(
            'insert into "actors" ("id", "project_id", "kind", "display_name") values (?1, ?2, ?3, ?4)'
        )
        .run(actorId, projectId, 'human', `Editor ${suffix}`)
    const owned = await seedWorkspaceChannel(database, {
        projectId,
        channelId: channelId,
        name: `Channel ${suffix}`,
        profileVersionId,
        profile: profile,
        createdByActorId: actorId,
    })
    await database.sql
        .statement(
            'insert into "posts" ("id", "project_id", "source_content", "source_revision", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5)'
        )
        .run(
            postId,
            projectId,
            toDbValue('json', {
                body: { text: `Post ${suffix}`, format: 'plain_text' },
                media: [],
            }),
            1,
            actorId
        )

    return { projectId, actorId, channelId, postId, ...owned }
}

describe('domain schema', () => {
    it('enforces project ownership with composite foreign keys', async () => {
        const database = (await openTestDatabase()).database

        try {
            const first = await seedProject(database, 'first')
            const second = await seedProject(database, 'second')

            await expect(
                database.sql
                    .statement(
                        'insert into "publications" ("id", "project_id", "post_id", "channel_id", "target_revision_id", "delivery_mode", "review_state", "state", "created_by_actor_id", "state_changed_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
                    )
                    .run(
                        'cross-project-publication',
                        first.projectId,
                        first.postId,
                        second.channelId,
                        null,
                        'manual',
                        'compatible',
                        'draft',
                        first.actorId,
                        first.actorId
                    )
            ).rejects.toThrow()

            await database.sql
                .statement(
                    'insert into "publications" ("id", "project_id", "post_id", "channel_id", "target_revision_id", "delivery_mode", "review_state", "state", "created_by_actor_id", "state_changed_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
                )
                .run(
                    'first-publication',
                    first.projectId,
                    first.postId,
                    first.channelId,
                    null,
                    'manual',
                    'compatible',
                    'ready',
                    first.actorId,
                    first.actorId
                )

            await expect(
                database.sql
                    .statement(
                        'insert into "jobs" ("id", "project_id", "publication_id", "state", "run_at") values (?1, ?2, ?3, ?4, ?5)'
                    )
                    .run(
                        'cross-project-job',
                        second.projectId,
                        'first-publication',
                        'pending',
                        1_800_000_000_000
                    )
            ).rejects.toThrow()

            await expect(
                database.sql
                    .statement(
                        'insert into "posts" ("id", "project_id", "source_content", "source_revision", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5)'
                    )
                    .run(
                        'cross-project-post',
                        first.projectId,
                        toDbValue('json', {
                            body: { text: 'Impossible attribution', format: 'plain_text' },
                            media: [],
                        }),
                        1,
                        second.actorId
                    )
            ).rejects.toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('allows manual channels and limits each channel to one publisher', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedProject(database, 'manual')

            expect(
                await database.sql
                    .statement<TestRow>(
                        'select "publishers"."id" as "id", "publishers"."workspace_id" as "workspaceId", "publishers"."channel_id" as "channelId", "publishers"."kind" as "kind", "publishers"."created_at" as "createdAt", "publishers"."updated_at" as "updatedAt" from "publishers"'
                    )
                    .all()
            ).toEqual([])

            await database.sql
                .statement(
                    'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                )
                .run(
                    'publisher-one',
                    await workspaceOf(database, fixture.projectId),
                    fixture.channelId,
                    'mastodon'
                )

            const workspaceId = await workspaceOf(database, fixture.projectId)
            await expect(
                database.sql
                    .statement(
                        'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                    )
                    .run('publisher-two', workspaceId, fixture.channelId, 'bluesky')
            ).rejects.toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rejects invalid and incomplete publication states', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedProject(database, 'states')
            const basePublication = {
                projectId: fixture.projectId,
                postId: fixture.postId,
                channelId: fixture.channelId,
                targetRevisionId: null,
                deliveryMode: 'manual',
                reviewState: 'compatible',
                createdByActorId: fixture.actorId,
                stateChangedByActorId: fixture.actorId,
            } as const

            expect(
                async () =>
                    await insertRow(database, 'publications', {
                        ...basePublication,
                        id: 'invalid-state',
                        state: 'unknown' as 'draft',
                    })
            ).toThrow()

            expect(
                async () =>
                    await insertRow(database, 'publications', {
                        ...basePublication,
                        id: 'incomplete-publication',
                        state: 'published',
                    })
            ).toThrow()

            expect(
                async () =>
                    await insertRow(database, 'publications', {
                        ...basePublication,
                        id: 'missing-error',
                        state: 'ambiguous',
                    })
            ).toThrow()

            expect(
                async () =>
                    await insertRow(database, 'publications', {
                        ...basePublication,
                        id: 'unexpected-error',
                        state: 'ready',
                        errorMessage: 'Stale failure',
                    })
            ).toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rejects incomplete credential envelopes and cross-project attribution', async () => {
        const database = (await openTestDatabase()).database

        try {
            const first = await seedProject(database, 'credential-first')
            const second = await seedProject(database, 'credential-second')
            const activeCredential = {
                workspaceId: first.workspaceId,
                providerId: 'linkedin',
                externalAccountId: 'member-1',
                scopes: [],
                state: 'active' as const,
                connectedByActorId: first.workspaceActorId,
                encryptionVersion: 1,
                encryptionKeyId: 'primary',
                accessTokenCiphertext: Buffer.alloc(17, 1),
            }

            expect(
                async () =>
                    await insertRow(database, 'publisher_credentials', {
                        ...activeCredential,
                        id: 'missing-access-nonce',
                    })
            ).toThrow()
            expect(
                async () =>
                    await insertRow(database, 'publisher_credentials', {
                        ...activeCredential,
                        id: 'partial-refresh-envelope',
                        accessTokenNonce: Buffer.alloc(12, 2),
                        refreshTokenCiphertext: Buffer.alloc(17, 3),
                    })
            ).toThrow()
            expect(
                async () =>
                    await insertRow(database, 'publisher_credentials', {
                        ...activeCredential,
                        id: 'cross-project-actor',
                        connectedByActorId: second.workspaceActorId,
                        accessTokenNonce: Buffer.alloc(12, 2),
                    })
            ).toThrow()
            expect(
                async () =>
                    await insertRow(database, 'publisher_credentials', {
                        ...activeCredential,
                        id: 'revoked-with-secret',
                        state: 'revoked',
                        accessTokenNonce: Buffer.alloc(12, 2),
                    })
            ).toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rejects incomplete and contradictory OAuth authorization attempts', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedProject(database, 'oauth-attempt')
            const pendingAttempt = {
                projectId: fixture.projectId,
                channelId: fixture.channelId,
                providerId: 'linkedin',
                connectedByActorId: fixture.actorId,
                callbackUri: 'https://postdot.example.com/api/oauth/linkedin/callback',
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

            expect(
                async () =>
                    await insertRow(database, 'oauth_authorization_attempts', {
                        ...pendingAttempt,
                        id: 'pending-without-pkce',
                        stateDigest: Buffer.alloc(32, 2),
                        pkceEncryptionVersion: null,
                        pkceEncryptionKeyId: null,
                        pkceVerifierCiphertext: null,
                        pkceVerifierNonce: null,
                    })
            ).not.toThrow()

            expect(
                async () =>
                    await insertRow(database, 'oauth_authorization_attempts', {
                        ...pendingAttempt,
                        id: 'missing-pkce-nonce',
                    })
            ).toThrow()
            expect(
                async () =>
                    await insertRow(database, 'oauth_authorization_attempts', {
                        ...pendingAttempt,
                        id: 'invalid-state-digest',
                        stateDigest: Buffer.alloc(31, 1),
                        pkceVerifierNonce: Buffer.alloc(12, 3),
                    })
            ).toThrow()
            expect(
                async () =>
                    await insertRow(database, 'oauth_authorization_attempts', {
                        ...pendingAttempt,
                        id: 'consumed-with-verifier',
                        status: 'consumed',
                        completedAt: 1_800_000_000_001,
                        pkceVerifierNonce: Buffer.alloc(12, 3),
                    })
            ).toThrow()
            expect(
                async () =>
                    await insertRow(database, 'oauth_authorization_attempts', {
                        ...pendingAttempt,
                        id: 'external-return-path',
                        returnPath: '//attacker.example.com',
                        pkceVerifierNonce: Buffer.alloc(12, 3),
                    })
            ).toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('rejects job rows that contradict their lifecycle state', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedProject(database, 'jobs')
            await database.sql
                .statement(
                    'insert into "publications" ("id", "project_id", "post_id", "channel_id", "target_revision_id", "delivery_mode", "review_state", "state", "created_by_actor_id", "state_changed_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
                )
                .run(
                    'ready-publication',
                    fixture.projectId,
                    fixture.postId,
                    fixture.channelId,
                    null,
                    'manual',
                    'compatible',
                    'ready',
                    fixture.actorId,
                    fixture.actorId
                )

            const baseJob = {
                projectId: fixture.projectId,
                publicationId: 'ready-publication',
                runAt: 1_800_000_000_000,
            }

            expect(
                async () =>
                    await insertRow(database, 'jobs', {
                        ...baseJob,
                        id: 'dirty-pending-job',
                        state: 'pending',
                        completedAt: 1_800_000_000_001,
                    })
            ).toThrow()

            expect(
                async () =>
                    await insertRow(database, 'jobs', {
                        ...baseJob,
                        id: 'unstarted-failed-job',
                        state: 'failed',
                        completedAt: 1_800_000_000_001,
                        errorMessage: 'Connection refused',
                    })
            ).toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('enforces media representation facts and upload intent lifecycle timestamps', async () => {
        const database = (await openTestDatabase()).database

        try {
            const fixture = await seedProject(database, 'media-state')
            const timestamp = 1_800_000_000_000

            await database.sql
                .statement(
                    'insert into "media_assets" ("id", "project_id", "original_filename", "state", "created_by_actor_id", "created_at", "updated_at") values (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
                )
                .run(
                    'media-asset-state',
                    fixture.projectId,
                    'state.png',
                    'reserved',
                    fixture.actorId,
                    timestamp,
                    timestamp
                )

            const baseRepresentation = {
                projectId: fixture.projectId,
                assetId: 'media-asset-state',
                kind: 'original' as const,
                state: 'reserved' as const,
                storeId: 'local-default',
                objectKey: 'media/media-asset-state/media-representation-state/original',
                createdAt: timestamp,
                updatedAt: timestamp,
            }

            expect(
                async () =>
                    await insertRow(database, 'media_representations', {
                        ...baseRepresentation,
                        id: 'media-representation-ready-without-facts',
                        state: 'ready',
                    })
            ).toThrow()

            await insertRow(database, 'media_representations', {
                ...baseRepresentation,
                id: 'media-representation-state',
            })

            const baseIntent = {
                projectId: fixture.projectId,
                assetId: 'media-asset-state',
                representationId: 'media-representation-state',
                expectedSize: null,
                maxBytes: 1_000,
                contentTypeHint: null,
                expiresAt: timestamp + 60_000,
                createdAt: timestamp,
                updatedAt: timestamp,
            }

            expect(
                async () =>
                    await insertRow(database, 'media_upload_intents', {
                        ...baseIntent,
                        id: 'media-intent-uploading-without-start',
                        state: 'uploading',
                    })
            ).toThrow()

            await insertRow(database, 'media_upload_intents', {
                ...baseIntent,
                id: 'media-intent-state',
                state: 'pending',
            })

            await expect(
                database.sql
                    .statement(
                        'update "media_upload_intents" set "state" = ?1 where "media_upload_intents"."id" = ?2'
                    )
                    .run('uploaded', 'media-intent-state')
            ).rejects.toThrow()
        } finally {
            await closeTestDatabase(database)
        }
    })

    it('commits scheduler indexes and leaves no foreign-key violations', async () => {
        const database = (await openTestDatabase()).database

        try {
            await seedProject(database, 'integrity')

            const schema = await describeSchema(database)
            const publicationIndexes = Object.keys(schema.tables.publications!.indexes)
            const jobIndexes = Object.keys(schema.tables.jobs!.indexes)

            expect(publicationIndexes).toContain('publications_state_scheduled_at_idx')
            expect(jobIndexes).toContain('jobs_state_run_at_idx')
            expect(jobIndexes).toContain('jobs_state_lease_expires_at_idx')
            expect(await foreignKeyViolations(database)).toEqual([])
        } finally {
            await closeTestDatabase(database)
        }
    })
})
