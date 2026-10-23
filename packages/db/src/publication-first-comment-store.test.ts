import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import { createMastodonCommentPolicy } from '../../../apps/api/src/providers/mastodon/comment-policy'
import { providerCommentPolicies } from '../../../apps/api/src/providers/registry'
import { user as users } from './auth-schema'
import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'
import { createPublicationFirstCommentStore } from './publication-first-comment-store'
import {
    actors,
    auditEvents,
    channelProfileVersions,
    channels,
    instanceMemberships,
    jobs,
    posts,
    projectUserGrants,
    projects,
    publicationExecutionRevisions,
    publicationFirstComments,
    publicationTargetRevisions,
    publications,
    publisherConnections,
    publisherCredentials,
    publishers,
} from './schema'

const now = 1_800_000_000_000
const accountDid = 'did:plc:bluesky-operator'
const rootUri = `at://${accountDid}/app.bsky.feed.post/comment1`
const leaseDuration = 60_000
const mastodonOrigin = 'https://social.example'
const mastodonAccountId = '10'
const mastodonStatusId = '100'
const mastodonPermalink = `${mastodonOrigin}/@owner/${mastodonStatusId}`
const mastodonRootUri = `${mastodonOrigin}/api/v1/statuses/${mastodonStatusId}`

const blueskyProfile = {
    id: 'bluesky',
    version: 2,
    profileHash: 'sha256:postbot-bluesky-post-v2',
    schemaHash: 'sha256:postbot-bluesky-post-schema-v2',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' as const, minLength: 1 } },
        required: ['text'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'text', semantic: 'primary_text' as const, path: '/text' }],
    capabilities: {
        revision: 'bluesky-post-v2',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 3_000,
                maxGraphemes: 300,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in' as const, contractId: 'bluesky', revision: 'post-v2' },
}

const mastodonProfile = {
    id: 'mastodon',
    version: 1,
    profileHash: 'sha256:postbot-mastodon-status-v1',
    schemaHash: 'sha256:postbot-mastodon-status-schema-v1',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' as const, minLength: 1, maxLength: 500 } },
        required: ['text'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'text', semantic: 'primary_text' as const, path: '/text' }],
    capabilities: {
        revision: 'mastodon-status-v1',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 500,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in' as const, contractId: 'mastodon', revision: 'status-v1' },
}

/**
 * A stand-in for the Mastodon protocol reference parser.
 *
 * The database package never depends on a provider package, so the protocol
 * parser is injected by the application. The double mirrors the contract the
 * store relies on: a numeric local status identifier and a retained permalink
 * identify one status of one instance.
 */
function resolveMastodonStatusReference(
    externalId: string | null,
    externalUrl: string | null
): { readonly origin: string; readonly statusId: string; readonly rootUri: string } | null {
    if (externalId === null || !/^\d+$/.test(externalId) || externalUrl === null) return null
    try {
        const url = new URL(externalUrl)
        if (url.username || url.password || url.search || url.hash) return null
        if (
            !new RegExp(`^/(?:@[^/]+/${externalId}|users/[^/]+/statuses/${externalId})$`).test(
                url.pathname
            )
        )
            return null
        return {
            origin: url.origin,
            statusId: externalId,
            rootUri: `${url.origin}/api/v1/statuses/${externalId}`,
        }
    } catch {
        return null
    }
}

interface Fixture {
    readonly database: ReturnType<typeof createDatabase>
    readonly provider: 'bluesky' | 'mastodon'
    readonly projectId: string
    readonly editorSubjectId: string
    readonly editorActorId: string
    readonly otherEditorSubjectId: string
    readonly otherEditorActorId: string
    readonly viewerSubjectId: string
    readonly outsiderSubjectId: string
    readonly publicationId: string
    readonly channelId: string
    readonly credentialId: string
    readonly connectionId: string
    readonly profileVersionId: string
    readonly targetRevisionId: string
    readonly jobId: string
    readonly executionRevisionId: string
}

function seedAccess(
    database: Fixture['database'],
    projectId: string,
    subjectId: string,
    role: 'owner' | 'editor' | 'viewer'
): void {
    database
        .insert(projectUserGrants)
        .values({ id: `grant:${projectId}:${subjectId}`, projectId, userId: subjectId, role })
        .run()
}

function createFixture(
    suffix = 'one',
    provider: 'bluesky' | 'mastodon' = 'bluesky',
    options: { readonly migrationsFolder?: string } = {}
): Fixture {
    const database = createDatabase(':memory:')
    if (options.migrationsFolder === undefined) runMigrations(database)
    else runMigrations(database, options.migrationsFolder)

    const projectId = `project-${suffix}`
    const editorSubjectId = 'editor-user'
    const otherEditorSubjectId = 'other-editor-user'
    const viewerSubjectId = 'viewer-user'
    const outsiderSubjectId = 'outsider-user'
    const editorActorId = `actor-${suffix}-editor`
    const otherEditorActorId = `actor-${suffix}-other-editor`
    const channelId = `channel-${suffix}`
    const credentialId = `credential-${suffix}`
    const connectionId = `connection-${suffix}`
    const profileVersionId = `profile-${suffix}`
    const targetRevisionId = `target-${suffix}`
    const publicationId = `publication-${suffix}`
    const jobId = `job-${suffix}`
    const executionRevisionId = `execution-${suffix}`

    database
        .insert(projects)
        .values({ id: projectId, name: `First comment project ${suffix}` })
        .run()
    database
        .insert(users)
        .values(
            [editorSubjectId, otherEditorSubjectId, viewerSubjectId, outsiderSubjectId].map(
                subjectId => ({
                    id: subjectId,
                    name: subjectId,
                    email: `${subjectId}@first-comment.local`,
                })
            )
        )
        .run()
    database
        .insert(instanceMemberships)
        .values(
            [editorSubjectId, otherEditorSubjectId, viewerSubjectId, outsiderSubjectId].map(
                subjectId => ({
                    id: `instance-membership:${subjectId}`,
                    userId: subjectId,
                    role: 'member' as const,
                    state: 'enabled' as const,
                })
            )
        )
        .run()
    for (const [subjectId, role] of [
        [editorSubjectId, 'editor'],
        [otherEditorSubjectId, 'editor'],
        [viewerSubjectId, 'viewer'],
    ] as const) {
        seedAccess(database, projectId, subjectId, role)
    }
    database
        .insert(actors)
        .values([
            {
                id: editorActorId,
                projectId,
                kind: 'human',
                subjectId: editorSubjectId,
                displayName: 'Enabling Editor',
            },
            {
                id: otherEditorActorId,
                projectId,
                kind: 'human',
                subjectId: otherEditorSubjectId,
                displayName: 'Second Editor',
            },
            {
                id: `actor-${suffix}-viewer`,
                projectId,
                kind: 'human',
                subjectId: viewerSubjectId,
                displayName: 'Project Viewer',
            },
        ])
        .run()
    const profile = provider === 'bluesky' ? blueskyProfile : mastodonProfile
    database
        .insert(channels)
        .values({
            id: channelId,
            projectId,
            name: provider === 'bluesky' ? 'Bluesky channel' : 'Mastodon channel',
            profileVersionId,
        })
        .run()
    database
        .insert(channelProfileVersions)
        .values({
            id: profileVersionId,
            projectId,
            channelId,
            profileId: profile.id,
            version: profile.version,
            origin: profile.origin,
            state: 'active',
            profileJson: profile,
            profileHash: profile.profileHash,
            schemaHash: profile.schemaHash,
            createdByActorId: editorActorId,
        })
        .run()
    database
        .insert(publishers)
        .values({ id: `publisher-${suffix}`, projectId, channelId, kind: provider })
        .run()
    database
        .insert(publisherCredentials)
        .values({
            id: credentialId,
            projectId,
            providerId: provider,
            externalAccountId: provider === 'bluesky' ? accountDid : mastodonAccountId,
            externalAccountName: provider === 'bluesky' ? 'Bluesky Operator' : 'Mastodon Operator',
            scopes: provider === 'bluesky' ? ['atproto'] : ['read:accounts', 'write:statuses'],
            state: 'active',
            connectedByActorId: editorActorId,
            encryptionVersion: 1,
            encryptionKeyId: 'first-comment-test-key',
            accessTokenCiphertext: Buffer.alloc(24, 3),
            accessTokenNonce: Buffer.alloc(12, 4),
        })
        .run()
    database
        .insert(publisherConnections)
        .values({
            id: connectionId,
            projectId,
            publisherId: `publisher-${suffix}`,
            credentialId,
            endpointUrl: provider === 'bluesky' ? null : mastodonOrigin,
            connectedByActorId: editorActorId,
        })
        .run()
    database
        .insert(posts)
        .values({
            id: `post-${suffix}`,
            projectId,
            sourceContent: { body: { text: 'Parent post', format: 'plain_text' }, media: [] },
            sourceRevision: 1,
            createdByActorId: editorActorId,
        })
        .run()
    database
        .insert(publications)
        .values({
            id: publicationId,
            projectId,
            postId: `post-${suffix}`,
            channelId,
            targetRevisionId,
            deliveryMode: 'automatic',
            reviewState: 'compatible',
            state: 'scheduled',
            scheduledAt: now,
            createdByActorId: editorActorId,
            scheduledByActorId: editorActorId,
            stateChangedByActorId: editorActorId,
        })
        .run()
    database
        .insert(publicationTargetRevisions)
        .values({
            id: targetRevisionId,
            projectId,
            publicationId,
            sequence: 1,
            profileVersionId,
            sourceRevision: 1,
            deliveryMode: 'automatic',
            contentJson: { text: 'Parent post' },
            contentHash: `sha256:target-${suffix}`,
            profileHash: profile.profileHash,
            schemaHash: profile.schemaHash,
            validationIssuesJson: [],
            createdByActorId: editorActorId,
        })
        .run()

    return {
        database,
        provider,
        projectId,
        editorSubjectId,
        editorActorId,
        otherEditorSubjectId,
        otherEditorActorId,
        viewerSubjectId,
        outsiderSubjectId,
        publicationId,
        channelId,
        credentialId,
        connectionId,
        profileVersionId,
        targetRevisionId,
        jobId,
        executionRevisionId,
    }
}

/** Records a native, automatically delivered parent receipt. */
function publishNatively(
    fixture: Fixture,
    options: {
        readonly publishedAt: number
        readonly jobState?: 'succeeded' | 'failed'
        readonly deliveryMode?: 'automatic' | 'manual'
        readonly statusId?: string
        readonly permalink?: string
    }
): void {
    const profile = fixture.provider === 'bluesky' ? blueskyProfile : mastodonProfile
    fixture.database
        .update(publications)
        .set({
            state: 'published',
            publishedAt: options.publishedAt,
            publishedByActorId: fixture.editorActorId,
            stateChangedByActorId: fixture.editorActorId,
            externalId:
                fixture.provider === 'bluesky' ? rootUri : (options.statusId ?? mastodonStatusId),
            externalUrl:
                fixture.provider === 'bluesky'
                    ? `https://bsky.app/profile/${accountDid}/app.bsky.feed.post/comment1`
                    : (options.permalink ?? mastodonPermalink),
            deliveryMode: options.deliveryMode ?? 'automatic',
            scheduledAt: null,
            scheduledByActorId: null,
        })
        .where(eq(publications.id, fixture.publicationId))
        .run()
    if (options.deliveryMode === 'manual') return
    fixture.database
        .insert(jobs)
        .values({
            id: fixture.jobId,
            projectId: fixture.projectId,
            publicationId: fixture.publicationId,
            state: options.jobState ?? 'succeeded',
            runAt: options.publishedAt,
            startedAt: options.publishedAt,
            completedAt: options.publishedAt,
            errorMessage:
                options.jobState === 'failed' ? 'Provider rejected the parent post' : null,
        })
        .run()
    if (options.jobState === 'failed') return
    fixture.database
        .insert(publicationExecutionRevisions)
        .values({
            id: fixture.executionRevisionId,
            projectId: fixture.projectId,
            jobId: fixture.jobId,
            publicationId: fixture.publicationId,
            targetRevisionId: fixture.targetRevisionId,
            profileVersionId: fixture.profileVersionId,
            deliveryMode: 'automatic',
            mediaReferenceCount: 0,
            contentJson: { text: 'Parent post' },
            contentHash: `sha256:target-${fixture.targetRevisionId}`,
            profileHash: profile.profileHash,
            schemaHash: profile.schemaHash,
        })
        .run()
}

/**
 * Creates the store of a fixture.
 *
 * A Mastodon fixture always receives the protocol reference parser, unless the
 * test asks for a store without it.
 */
function createStore(fixture: Fixture, options: { readonly withParser?: boolean } = {}) {
    const withParser = options.withParser ?? true
    return createPublicationFirstCommentStore(fixture.database, {
        policies: providerCommentPolicies.map(policy =>
            policy.id === 'mastodon'
                ? createMastodonCommentPolicy(withParser ? resolveMastodonStatusReference : null)
                : policy
        ),
    })
}

function saveComment(
    fixture: Fixture,
    options: {
        readonly text?: string
        readonly delaySeconds?: number
        readonly expectedRevision?: number
        readonly recordKey?: string
        readonly subjectId?: string
        readonly at?: number
    } = {}
) {
    return createStore(fixture).save({
        projectId: fixture.projectId,
        publicationId: fixture.publicationId,
        subjectId: options.subjectId ?? fixture.editorSubjectId,
        text: options.text ?? 'Thanks for the update',
        delaySeconds: options.delaySeconds ?? 300,
        expectedRevision: options.expectedRevision ?? 0,
        recordKey: options.recordKey ?? 'comment1',
        now: options.at ?? now,
    })
}

function readRow(fixture: Fixture) {
    return fixture.database
        .select()
        .from(publicationFirstComments)
        .where(eq(publicationFirstComments.publicationId, fixture.publicationId))
        .get()
}

function journalActions(fixture: Fixture): string[] {
    return fixture.database
        .select()
        .from(auditEvents)
        .all()
        .map(event => event.action)
        .filter(action => action.startsWith('publication_first_comment.'))
}

describe('publication first comment store', () => {
    it('keeps mutations project-scoped and editor-gated', () => {
        const fixture = createFixture('permissions')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })

            expect(saveComment(fixture, { subjectId: fixture.viewerSubjectId })).toEqual({
                kind: 'not_found',
            })
            expect(saveComment(fixture, { subjectId: fixture.outsiderSubjectId })).toEqual({
                kind: 'not_found',
            })
            expect(
                store.cancel({
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    subjectId: fixture.viewerSubjectId,
                    expectedRevision: 0,
                    now,
                })
            ).toEqual({ kind: 'not_found' })
            expect(
                store.get(fixture.projectId, fixture.publicationId, fixture.outsiderSubjectId)
            ).toBeNull()

            const created = saveComment(fixture)
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return

            expect(
                store.get(fixture.projectId, fixture.publicationId, fixture.viewerSubjectId)
            ).toMatchObject({ id: created.firstComment.id, state: 'waiting' })
            expect(
                store.get(fixture.projectId, fixture.publicationId, fixture.outsiderSubjectId)
            ).toBeNull()
            expect(
                store.view(fixture.projectId, fixture.publicationId, fixture.viewerSubjectId)
            ).toEqual({
                id: created.firstComment.id,
                text: 'Thanks for the update',
                delaySeconds: 300,
                state: 'waiting',
                revision: 1,
                dueAt: null,
                createdAt: now,
                updatedAt: now,
                externalUrl: null,
                lastError: null,
                authorName: 'Enabling Editor',
            })
            expect(store.canManage(fixture.projectId, fixture.editorSubjectId)).toBe(true)
            expect(store.canManage(fixture.projectId, fixture.viewerSubjectId)).toBe(false)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects ineligible publications and invalid content', () => {
        const manual = createFixture('ineligible')

        try {
            manual.database
                .update(publications)
                .set({ deliveryMode: 'manual' })
                .where(eq(publications.id, manual.publicationId))
                .run()

            expect(saveComment(manual)).toEqual({ kind: 'conflict' })
            expect(
                createPublicationFirstCommentStore(manual.database, {
                    policies: providerCommentPolicies,
                }).canConfigure(manual.projectId, manual.publicationId)
            ).toBe(false)
        } finally {
            closeDatabase(manual.database)
        }

        const fixture = createFixture('content')

        try {
            expect(() => saveComment(fixture, { text: '   ' })).toThrow('must not be blank')
            expect(() => saveComment(fixture, { delaySeconds: 604_801 })).toThrow(
                'delaySeconds must be an integer between 0 and 604800'
            )
            expect(() => saveComment(fixture, { delaySeconds: -1 })).toThrow(
                'delaySeconds must be an integer between 0 and 604800'
            )
            expect(() => saveComment(fixture, { text: 'a'.repeat(3_001) })).toThrow(
                'must not exceed 3000 UTF-16 code units'
            )
            expect(() => saveComment(fixture, { text: 'e\u0301'.repeat(301) })).toThrow(
                'must not exceed 300 graphemes'
            )
            expect(saveComment(fixture, { text: 'e\u0301'.repeat(300) }).kind).toBe('saved')
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('arms only a natively confirmed parent and keeps the chosen due time', () => {
        const fixture = createFixture('native')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            const created = saveComment(fixture, { delaySeconds: 300 })
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return

            store.reconcile(now)
            expect(readRow(fixture)).toMatchObject({ state: 'waiting', dueAt: null })
            expect(store.getNextEventAt()).toBeNull()

            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })

            // A confirmed parent must wake the worker so the comment is armed
            // on the next tick instead of waiting for a timer that never fires.
            expect(store.getNextEventAt()).not.toBeNull()

            store.reconcile(publishedAt)

            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                dueAt: publishedAt + 300_000,
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
                revision: 1,
            })
            expect(store.getNextEventAt()).toBe(publishedAt + 300_000)

            expect(
                store.deliveries.claimNextDueJob({
                    actorId: fixture.editorActorId,
                    claimToken: 'claim-too-early',
                    now: publishedAt + 299_999,
                    leaseExpiresAt: publishedAt + 300_000 + leaseDuration,
                })
            ).toBeNull()

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-due',
                now: publishedAt + 300_000,
                leaseExpiresAt: publishedAt + 300_000 + leaseDuration,
            })
            expect(claimed).toMatchObject({ state: 'running', attempts: 1 })
            expect(journalActions(fixture)).toEqual([
                'publication_first_comment.requested',
                'publication_first_comment.armed',
            ])
            expect(fixture.database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps an overdue comment due after downtime without resetting its delay', () => {
        const fixture = createFixture('overdue')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture, { delaySeconds: 3_600 })
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            store.reconcile(publishedAt)

            const restartedAt = publishedAt + 10 * 3_600_000
            store.reconcile(restartedAt)

            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                dueAt: publishedAt + 3_600_000,
            })
            expect(store.getNextEventAt()).toBe(publishedAt + 3_600_000)

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-overdue',
                now: restartedAt,
                leaseExpiresAt: restartedAt + leaseDuration,
            })
            expect(claimed).toMatchObject({ state: 'running', dueAt: publishedAt + 3_600_000 })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('never arms a manual, failed or reconciled parent receipt', () => {
        const manual = createFixture('manual')

        try {
            const store = createPublicationFirstCommentStore(manual.database, {
                policies: providerCommentPolicies,
            })
            saveComment(manual)
            publishNatively(manual, { publishedAt: now + 1, deliveryMode: 'manual' })

            store.reconcile(now + 2)
            expect(readRow(manual)).toMatchObject({ state: 'waiting', dueAt: null })
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(manual.database)
        }

        const failed = createFixture('failed')

        try {
            const store = createPublicationFirstCommentStore(failed.database, {
                policies: providerCommentPolicies,
            })
            saveComment(failed)
            publishNatively(failed, { publishedAt: now + 1, jobState: 'failed' })

            store.reconcile(now + 2)
            expect(readRow(failed)).toMatchObject({ state: 'waiting', dueAt: null })
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(failed.database)
        }
    })

    it('cancels unsent work when the parent publication is cancelled', () => {
        const fixture = createFixture('parent-cancelled')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            fixture.database
                .update(publications)
                .set({
                    state: 'cancelled',
                    scheduledAt: null,
                    scheduledByActorId: null,
                    stateChangedByActorId: fixture.editorActorId,
                })
                .where(eq(publications.id, fixture.publicationId))
                .run()

            store.reconcile(now + 1)
            expect(readRow(fixture)).toMatchObject({ state: 'cancelled' })
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('refuses to create a comment for a revision that was never issued', () => {
        const fixture = createFixture('stale-create')

        try {
            expect(saveComment(fixture, { expectedRevision: 1 })).toEqual({ kind: 'conflict' })
            expect(saveComment(fixture, { expectedRevision: 3 })).toEqual({ kind: 'conflict' })
            expect(readRow(fixture)).toBeUndefined()
            expect(fixture.database.select().from(publicationFirstComments).all()).toHaveLength(0)

            const created = saveComment(fixture, { expectedRevision: 0 })
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return
            expect(created.firstComment.revision).toBe(1)

            // A duplicated create is the same request and never a second row.
            const retried = saveComment(fixture, { expectedRevision: 0, recordKey: 'other-key' })
            expect(retried.kind).toBe('saved')
            if (retried.kind !== 'saved') return
            expect(retried.firstComment.id).toBe(created.firstComment.id)
            expect(retried.firstComment.recordKey).toBe('comment1')
            expect(fixture.database.select().from(publicationFirstComments).all()).toHaveLength(1)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails a confirmed parent whose connection is gone instead of spinning', () => {
        const fixture = createFixture('missing-connection')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })

            // The receipt is confirmed, so the worker must wake up for it even
            // though the comment is still waiting.
            expect(store.getNextEventAt(now)).toBe(now)

            fixture.database
                .delete(publisherConnections)
                .where(eq(publisherConnections.id, fixture.connectionId))
                .run()

            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
            })
            // A terminal comment leaves the schedule instead of waking the
            // worker forever.
            expect(store.getNextEventAt(now)).toBeNull()

            store.reconcile(publishedAt + 1)
            expect(readRow(fixture)).toMatchObject({ state: 'failed' })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects a replaced account instead of arming a confirmed receipt', () => {
        const fixture = createFixture('replaced-account')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })

            fixture.database
                .update(publisherCredentials)
                .set({ externalAccountId: 'did:plc:someone-else' })
                .where(eq(publisherCredentials.id, fixture.credentialId))
                .run()

            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication does not belong to the connected account',
                rootUri: null,
                accountId: null,
                connectionId: null,
                credentialId: null,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('revalidates the pinned receipt and refuses a changed parent', () => {
        const fixture = createFixture('changed-parent')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
            })

            fixture.database
                .update(publications)
                .set({ externalId: `at://${accountDid}/app.bsky.feed.post/other` })
                .where(eq(publications.id, fixture.publicationId))
                .run()

            store.reconcile(publishedAt + 1)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed parent publication changed',
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails a comment whose succeeded delivery is no longer confirmed', () => {
        const fixture = createFixture('lost-receipt')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({ state: 'pending' })

            fixture.database
                .update(jobs)
                .set({ state: 'failed', errorMessage: 'The delivery was retried' })
                .where(eq(jobs.id, fixture.jobId))
                .run()

            store.reconcile(publishedAt + 1)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication receipt is no longer available',
                rootUri,
                accountId: accountDid,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('freezes the configuration capability with a terminal row', () => {
        const fixture = createFixture('capability')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            expect(store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(true)

            saveComment(fixture)
            expect(store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(true)

            const cancelled = store.cancel({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.editorSubjectId,
                expectedRevision: 1,
                now: now + 1,
            })
            expect(cancelled.kind).toBe('saved')

            // The publication is still scheduled, but the terminal row can no
            // longer be configured and the store refuses to save it.
            expect(store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(false)
            expect(saveComment(fixture, { expectedRevision: 2, text: 'Another attempt' })).toEqual({
                kind: 'conflict',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('re-enables a suspended comment instead of swallowing the request', () => {
        const fixture = createFixture('suspended-enable')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            const edited = saveComment(fixture, {
                expectedRevision: 1,
                text: 'An edited comment',
            })
            expect(edited.kind).toBe('saved')

            fixture.database
                .delete(projectUserGrants)
                .where(
                    eq(
                        projectUserGrants.id,
                        `grant:${fixture.projectId}:${fixture.editorSubjectId}`
                    )
                )
                .run()
            store.reconcile(now + 1)
            expect(readRow(fixture)).toMatchObject({ state: 'suspended', revision: 2 })

            // A stale request with other content can never re-enable the work.
            const staleChange = saveComment(fixture, {
                subjectId: fixture.otherEditorSubjectId,
                expectedRevision: 1,
                text: 'A different comment',
            })
            expect(staleChange.kind).toBe('conflict')
            expect(readRow(fixture)).toMatchObject({ state: 'suspended', revision: 2 })

            // A delayed duplicate must not lift a later access suspension.
            expect(
                saveComment(fixture, {
                    subjectId: fixture.otherEditorSubjectId,
                    expectedRevision: 1,
                    text: 'An edited comment',
                }).kind
            ).toBe('conflict')
            expect(readRow(fixture)).toMatchObject({ state: 'suspended', revision: 2 })

            // The explicit enable reviews the current revision and re-attributes it.
            const reenabled = saveComment(fixture, {
                subjectId: fixture.otherEditorSubjectId,
                expectedRevision: 2,
                text: 'An edited comment',
            })
            expect(reenabled.kind).toBe('saved')
            if (reenabled.kind !== 'saved') return
            expect(reenabled.firstComment).toMatchObject({
                state: 'waiting',
                revision: 3,
                text: 'An edited comment',
                actorId: fixture.otherEditorActorId,
                recordKey: 'comment1',
                lastError: null,
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('returns the same row for a retried save and refuses a stale revision', () => {
        const fixture = createFixture('save')

        try {
            const created = saveComment(fixture, { recordKey: 'first-key' })
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return

            const retried = saveComment(fixture, { recordKey: 'another-key' })
            expect(retried.kind).toBe('saved')
            if (retried.kind !== 'saved') return
            expect(retried.firstComment.id).toBe(created.firstComment.id)
            expect(retried.firstComment.revision).toBe(1)
            expect(retried.firstComment.recordKey).toBe('first-key')

            expect(
                fixture.database
                    .select()
                    .from(publicationFirstComments)
                    .where(eq(publicationFirstComments.publicationId, fixture.publicationId))
                    .all()
            ).toHaveLength(1)

            expect(saveComment(fixture, { expectedRevision: 7 }).kind).toBe('conflict')
            const edited = saveComment(fixture, {
                expectedRevision: 1,
                text: 'An edited comment',
                delaySeconds: 1_800,
            })
            expect(edited.kind).toBe('saved')
            if (edited.kind !== 'saved') return
            expect(edited.firstComment).toMatchObject({
                revision: 2,
                text: 'An edited comment',
                delaySeconds: 1_800,
                recordKey: 'first-key',
                state: 'waiting',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('serializes cancellation against a worker claim', () => {
        const fixture = createFixture('cancel')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-cancel-race',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()

            expect(
                store.cancel({
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    subjectId: fixture.editorSubjectId,
                    expectedRevision: 1,
                    now: dueAt + 1,
                })
            ).toEqual({ kind: 'conflict' })
            expect(readRow(fixture)).toMatchObject({ state: 'running' })
        } finally {
            closeDatabase(fixture.database)
        }

        const cancelled = createFixture('cancel-before-claim')

        try {
            const store = createPublicationFirstCommentStore(cancelled.database, {
                policies: providerCommentPolicies,
            })
            saveComment(cancelled)
            publishNatively(cancelled, { publishedAt: now + 1 })
            store.reconcile(now + 1)

            const cancelledRow = store.cancel({
                projectId: cancelled.projectId,
                publicationId: cancelled.publicationId,
                subjectId: cancelled.editorSubjectId,
                expectedRevision: 1,
                now: now + 2,
            })
            expect(cancelledRow.kind).toBe('saved')
            expect(
                store.deliveries.claimNextDueJob({
                    actorId: cancelled.editorActorId,
                    claimToken: 'claim-after-cancel',
                    now: now + 1 + 300_000,
                    leaseExpiresAt: now + 1 + 300_000 + leaseDuration,
                })
            ).toBeNull()
        } finally {
            closeDatabase(cancelled.database)
        }
    })

    it('suspends work when the enabling editor loses access and never resumes it alone', () => {
        const fixture = createFixture('suspend')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)

            fixture.database
                .delete(projectUserGrants)
                .where(
                    eq(
                        projectUserGrants.id,
                        `grant:${fixture.projectId}:${fixture.editorSubjectId}`
                    )
                )
                .run()

            store.reconcile(now + 2)
            expect(readRow(fixture)).toMatchObject({
                state: 'suspended',
                lastError: 'The enabling editor no longer has editor access',
            })

            store.reconcile(now + 3)
            expect(readRow(fixture)).toMatchObject({ state: 'suspended' })

            const reenabled = store.save({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.otherEditorSubjectId,
                text: 'Thanks for the update',
                delaySeconds: 300,
                expectedRevision: 1,
                recordKey: 'ignored-record-key',
                now: now + 4,
            })
            expect(reenabled.kind).toBe('saved')
            if (reenabled.kind !== 'saved') return
            expect(reenabled.firstComment).toMatchObject({
                state: 'pending',
                actorId: fixture.otherEditorActorId,
                recordKey: 'comment1',
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
                dueAt: now + 1 + 300_000,
                lastError: null,
            })
            expect(journalActions(fixture)).toEqual([
                'publication_first_comment.requested',
                'publication_first_comment.armed',
                'publication_first_comment.suspended',
                'publication_first_comment.enabled',
            ])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails closed instead of rebinding a replaced account', () => {
        const fixture = createFixture('rebind')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)

            fixture.database
                .update(publisherCredentials)
                .set({ externalAccountId: 'did:plc:someone-else' })
                .where(eq(publisherCredentials.id, fixture.credentialId))
                .run()

            store.reconcile(now + 2)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The original account is no longer available',
                accountId: accountDid,
                connectionId: fixture.connectionId,
            })
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }

        const disconnected = createFixture('disconnected')

        try {
            const store = createPublicationFirstCommentStore(disconnected.database, {
                policies: providerCommentPolicies,
            })
            saveComment(disconnected)
            publishNatively(disconnected, { publishedAt: now + 1 })
            store.reconcile(now + 1)

            disconnected.database
                .delete(publisherConnections)
                .where(eq(publisherConnections.id, disconnected.connectionId))
                .run()

            store.reconcile(now + 2)
            expect(readRow(disconnected)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
                accountId: accountDid,
            })
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(disconnected.database)
        }
    })

    it('recovers an expired claim without an effect and keeps the send identity', () => {
        const fixture = createFixture('recovery')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-recovery',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return
            expect(claimed.recordKey).toBe('comment1')

            expect(store.deliveries.recoverExpiredClaims(dueAt + leaseDuration)).toEqual({
                requeuedJobIds: [claimed.id],
                ambiguousJobIds: [],
            })
            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                dueAt,
                recordKey: 'comment1',
                rootUri,
                attempts: 1,
            })

            const reclaimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-recovery-second',
                now: dueAt + leaseDuration,
                leaseExpiresAt: dueAt + leaseDuration + leaseDuration,
            })
            expect(reclaimed).not.toBeNull()
            if (reclaimed === null) return
            expect(
                store.deliveries.startExternalEffect(
                    reclaimed.id,
                    'claim-recovery-second',
                    dueAt + leaseDuration + 1
                )
            ).toBe(true)
            expect(store.deliveries.recoverExpiredClaims(dueAt + 2 * leaseDuration)).toEqual({
                requeuedJobIds: [],
                ambiguousJobIds: [reclaimed.id],
            })
            expect(readRow(fixture)).toMatchObject({ state: 'ambiguous' })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps an uncertain outcome ambiguous and never sends a terminal comment again', () => {
        const fixture = createFixture('ambiguity')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-ambiguous',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return
            expect(
                store.deliveries.startExternalEffect(claimed.id, 'claim-ambiguous', dueAt + 1)
            ).toBe(true)
            expect(
                store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-ambiguous',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'ambiguous',
                        errorMessage: 'The provider response was lost',
                    },
                })
            ).toBe('ambiguous')
            expect(readRow(fixture)).toMatchObject({
                state: 'ambiguous',
                lastError: 'The provider response was lost',
            })
            expect(
                store.deliveries.claimNextDueJob({
                    actorId: fixture.editorActorId,
                    claimToken: 'claim-after-ambiguous',
                    now: dueAt + 3,
                    leaseExpiresAt: dueAt + 3 + leaseDuration,
                })
            ).toBeNull()
            expect(
                store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-ambiguous',
                    completedAt: dueAt + 4,
                    outcome: { type: 'published', externalId: 'remote-1' },
                })
            ).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('records a confirmed send and freezes the comment', () => {
        const fixture = createFixture('sent')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-sent',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return
            expect(store.deliveries.startExternalEffect(claimed.id, 'claim-sent', dueAt + 1)).toBe(
                true
            )
            expect(
                store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-sent',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'published',
                        externalId: 'at://did:plc:bluesky-operator/app.bsky.feed.post/comment1',
                        externalUrl:
                            'https://bsky.app/profile/did:plc:bluesky-operator/app.bsky.feed.post/comment1',
                    },
                })
            ).toBe('published')
            expect(readRow(fixture)).toMatchObject({
                state: 'sent',
                externalId: 'at://did:plc:bluesky-operator/app.bsky.feed.post/comment1',
                lastError: null,
            })
            expect(saveComment(fixture, { expectedRevision: 1, text: 'Another attempt' })).toEqual({
                kind: 'conflict',
            })
            // A retried identical save of the sent comment is the same request,
            // so the terminal row is returned instead of reopening the comment.
            const retried = saveComment(fixture, { expectedRevision: 0 })
            expect(retried.kind).toBe('saved')
            if (retried.kind !== 'saved') return
            expect(retried.firstComment).toMatchObject({ state: 'sent', revision: 1 })
            expect(store.getNextEventAt()).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('suspends a claimed comment whose enabling editor lost access before the effect', () => {
        const fixture = createFixture('claim-suspend')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-suspend',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()

            fixture.database
                .delete(projectUserGrants)
                .where(
                    eq(
                        projectUserGrants.id,
                        `grant:${fixture.projectId}:${fixture.editorSubjectId}`
                    )
                )
                .run()

            expect(
                store.deliveries.startExternalEffect(claimed!.id, 'claim-suspend', dueAt + 1)
            ).toBe(false)
            expect(readRow(fixture)).toMatchObject({
                state: 'suspended',
                lastError: 'The enabling editor no longer has editor access',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })
})

describe('publication first comment store (mastodon)', () => {
    it('prepares a Mastodon comment without any publisher connection', () => {
        const fixture = createFixture('mastodon-prepare', 'mastodon')

        try {
            fixture.database
                .delete(publisherConnections)
                .where(eq(publisherConnections.id, fixture.connectionId))
                .run()

            const store = createStore(fixture)
            expect(store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(true)

            const created = saveComment(fixture)
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return
            expect(created.firstComment).toMatchObject({
                providerId: 'mastodon',
                instanceOrigin: null,
                state: 'waiting',
                dueAt: null,
                rootUri: null,
                executionRevisionId: null,
                connectionId: null,
                credentialId: null,
                accountId: null,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('arms a native Mastodon receipt and binds the publishing instance', () => {
        const fixture = createFixture('mastodon-native', 'mastodon')

        try {
            const store = createStore(fixture)
            saveComment(fixture, { delaySeconds: 300 })

            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })

            // The confirmed receipt must wake the worker even though the
            // comment is still waiting.
            expect(store.getNextEventAt(now)).toBe(now)

            store.reconcile(publishedAt)

            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                providerId: 'mastodon',
                instanceOrigin: mastodonOrigin,
                rootUri: mastodonRootUri,
                accountId: mastodonAccountId,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
                dueAt: publishedAt + 300_000,
                revision: 1,
            })
            expect(store.getNextEventAt(now)).toBe(publishedAt + 300_000)
            expect(journalActions(fixture)).toEqual([
                'publication_first_comment.requested',
                'publication_first_comment.armed',
            ])
            expect(fixture.database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('refuses a parent that belongs to another instance', () => {
        const fixture = createFixture('mastodon-instance', 'mastodon')

        try {
            const store = createStore(fixture)
            saveComment(fixture)

            const publishedAt = now + 1_000
            // The same numeric status and account exist on another instance.
            publishNatively(fixture, {
                publishedAt,
                statusId: mastodonStatusId,
                permalink: `https://other.example/@owner/${mastodonStatusId}`,
            })

            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
                rootUri: null,
                instanceOrigin: null,
                accountId: null,
                connectionId: null,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails a replaced account and a credential that cannot write statuses', () => {
        const replaced = createFixture('mastodon-replaced', 'mastodon')

        try {
            const store = createStore(replaced)
            saveComment(replaced)
            const publishedAt = now + 1_000
            publishNatively(replaced, { publishedAt })
            store.reconcile(publishedAt)
            expect(readRow(replaced)).toMatchObject({
                state: 'pending',
                accountId: mastodonAccountId,
            })

            replaced.database
                .update(publisherCredentials)
                .set({ externalAccountId: '11' })
                .where(eq(publisherCredentials.id, replaced.credentialId))
                .run()

            store.reconcile(publishedAt + 1)
            expect(readRow(replaced)).toMatchObject({
                state: 'failed',
                lastError: 'The original account is no longer available',
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(replaced.database)
        }

        const scoped = createFixture('mastodon-scope', 'mastodon')

        try {
            const store = createStore(scoped)
            saveComment(scoped)
            scoped.database
                .update(publisherCredentials)
                .set({ scopes: ['read:accounts'] })
                .where(eq(publisherCredentials.id, scoped.credentialId))
                .run()

            const publishedAt = now + 1_000
            publishNatively(scoped, { publishedAt })

            store.reconcile(publishedAt)
            expect(readRow(scoped)).toMatchObject({
                state: 'failed',
                lastError: 'The original account is no longer available',
                rootUri: null,
                accountId: null,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(scoped.database)
        }
    })

    it('fails closed without a reference parser instead of waiting for one', () => {
        const fixture = createFixture('mastodon-parser', 'mastodon')

        try {
            const store = createStore(fixture, { withParser: false })
            const saved = store.save({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.editorSubjectId,
                text: 'Thanks for the update',
                delaySeconds: 300,
                expectedRevision: 0,
                recordKey: 'comment1',
                now,
            })
            expect(saved.kind).toBe('saved')

            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            expect(store.getNextEventAt(now)).toBe(now)

            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication could not be resolved',
                rootUri: null,
                instanceOrigin: null,
                accountId: null,
            })
            // The terminal comment leaves the schedule instead of waking the
            // worker forever.
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('stops the timer when the receipt or the connection disappears', () => {
        const receipt = createFixture('mastodon-receipt', 'mastodon')

        try {
            const store = createStore(receipt)
            saveComment(receipt)
            const publishedAt = now + 1_000
            publishNatively(receipt, { publishedAt })
            store.reconcile(publishedAt)
            expect(readRow(receipt)).toMatchObject({ state: 'pending' })

            receipt.database
                .update(jobs)
                .set({ state: 'failed', errorMessage: 'The delivery was retried' })
                .where(eq(jobs.id, receipt.jobId))
                .run()

            store.reconcile(publishedAt + 1)
            expect(readRow(receipt)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication receipt is no longer available',
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(receipt.database)
        }

        const connection = createFixture('mastodon-connection', 'mastodon')

        try {
            const store = createStore(connection)
            saveComment(connection)
            const publishedAt = now + 1_000
            publishNatively(connection, { publishedAt })
            store.reconcile(publishedAt)
            expect(readRow(connection)).toMatchObject({ state: 'pending' })

            connection.database
                .delete(publisherConnections)
                .where(eq(publisherConnections.id, connection.connectionId))
                .run()

            store.reconcile(publishedAt + 1)
            expect(readRow(connection)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(connection.database)
        }
    })

    it('accepts the conservative 500 unit reply envelope', () => {
        const fixture = createFixture('mastodon-text', 'mastodon')

        try {
            // Mastodon keeps its own envelope, so a comment that the Bluesky
            // grapheme limit would refuse is accepted here.
            expect(saveComment(fixture, { text: 'a'.repeat(400) }).kind).toBe('saved')
            expect(() => saveComment(fixture, { text: 'a'.repeat(501) })).toThrow(
                'must not exceed 500 UTF-16 code units'
            )
            expect(() => saveComment(fixture, { text: '   ' })).toThrow('must not be blank')
        } finally {
            closeDatabase(fixture.database)
        }

        const bluesky = createFixture('bluesky-text')

        try {
            expect(() => saveComment(bluesky, { text: 'a'.repeat(400) })).toThrow(
                'must not exceed 300 graphemes'
            )
        } finally {
            closeDatabase(bluesky.database)
        }
    })

    it('re-enables a suspended Mastodon comment from the current revision', () => {
        const fixture = createFixture('mastodon-suspend', 'mastodon')

        try {
            const store = createStore(fixture)
            saveComment(fixture)
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                instanceOrigin: mastodonOrigin,
                rootUri: mastodonRootUri,
            })

            fixture.database
                .delete(projectUserGrants)
                .where(
                    eq(
                        projectUserGrants.id,
                        `grant:${fixture.projectId}:${fixture.editorSubjectId}`
                    )
                )
                .run()
            store.reconcile(publishedAt + 1)
            expect(readRow(fixture)).toMatchObject({ state: 'suspended', revision: 1 })

            // A stale revision can never lift the suspension.
            expect(
                saveComment(fixture, {
                    subjectId: fixture.otherEditorSubjectId,
                    expectedRevision: 0,
                    text: 'An edited comment',
                }).kind
            ).toBe('conflict')

            const reenabled = saveComment(fixture, {
                subjectId: fixture.otherEditorSubjectId,
                expectedRevision: 1,
                text: 'An edited comment',
            })
            expect(reenabled.kind).toBe('saved')
            if (reenabled.kind !== 'saved') return
            expect(reenabled.firstComment).toMatchObject({
                state: 'pending',
                revision: 2,
                providerId: 'mastodon',
                instanceOrigin: mastodonOrigin,
                rootUri: mastodonRootUri,
                accountId: mastodonAccountId,
                actorId: fixture.otherEditorActorId,
                recordKey: 'comment1',
                lastError: null,
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps the claim fence, the cancellation and the uncertainty of a send', () => {
        const fixture = createFixture('mastodon-fence', 'mastodon')

        try {
            const store = createStore(fixture)
            saveComment(fixture)
            publishNatively(fixture, { publishedAt: now + 1 })
            store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-mastodon',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return

            // A cancellation cannot take a claimed comment.
            expect(
                store.cancel({
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    subjectId: fixture.editorSubjectId,
                    expectedRevision: 1,
                    now: dueAt + 1,
                })
            ).toEqual({ kind: 'conflict' })

            expect(
                store.deliveries.startExternalEffect(claimed.id, 'claim-mastodon', dueAt + 1)
            ).toBe(true)
            expect(
                store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-mastodon',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'ambiguous',
                        errorMessage: 'The provider response was lost',
                    },
                })
            ).toBe('ambiguous')
            expect(readRow(fixture)).toMatchObject({
                state: 'ambiguous',
                lastError: 'The provider response was lost',
            })
            expect(
                store.deliveries.claimNextDueJob({
                    actorId: fixture.editorActorId,
                    claimToken: 'claim-after-ambiguous',
                    now: dueAt + 3,
                    leaseExpiresAt: dueAt + 3 + leaseDuration,
                })
            ).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }

        const cancelled = createFixture('mastodon-cancel', 'mastodon')

        try {
            const store = createStore(cancelled)
            saveComment(cancelled)
            const cancelledRow = store.cancel({
                projectId: cancelled.projectId,
                publicationId: cancelled.publicationId,
                subjectId: cancelled.editorSubjectId,
                expectedRevision: 1,
                now: now + 2,
            })
            expect(cancelledRow.kind).toBe('saved')
            expect(
                store.deliveries.claimNextDueJob({
                    actorId: cancelled.editorActorId,
                    claimToken: 'claim-after-cancel',
                    now: now + 1 + 300_000,
                    leaseExpiresAt: now + 1 + 300_000 + leaseDuration,
                })
            ).toBeNull()
        } finally {
            closeDatabase(cancelled.database)
        }
    })

    it('pins the provider and refuses an edit that would change it', () => {
        const fixture = createFixture('mastodon-provider', 'mastodon')

        try {
            const created = saveComment(fixture)
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return
            expect(created.firstComment.providerId).toBe('mastodon')

            // The channel now publishes with another contract.
            fixture.database
                .update(channelProfileVersions)
                .set({
                    profileId: blueskyProfile.id,
                    profileJson: blueskyProfile,
                    profileHash: blueskyProfile.profileHash,
                    schemaHash: blueskyProfile.schemaHash,
                })
                .where(eq(channelProfileVersions.id, fixture.profileVersionId))
                .run()

            expect(
                saveComment(fixture, { expectedRevision: 1, text: 'An edited comment' })
            ).toEqual({ kind: 'conflict' })
            expect(readRow(fixture)).toMatchObject({
                providerId: 'mastodon',
                revision: 1,
                text: 'Thanks for the update',
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('never arms a receipt produced by another provider', () => {
        const fixture = createFixture('mastodon-wrong-receipt', 'mastodon')

        try {
            const store = createStore(fixture)
            saveComment(fixture)

            const blueskyProfileVersionId = 'profile-bluesky-wrong-receipt'
            fixture.database
                .insert(channelProfileVersions)
                .values({
                    id: blueskyProfileVersionId,
                    projectId: fixture.projectId,
                    channelId: fixture.channelId,
                    profileId: blueskyProfile.id,
                    version: 3,
                    origin: blueskyProfile.origin,
                    state: 'superseded',
                    profileJson: blueskyProfile,
                    profileHash: blueskyProfile.profileHash,
                    schemaHash: blueskyProfile.schemaHash,
                    createdByActorId: fixture.editorActorId,
                })
                .run()

            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            fixture.database
                .update(publicationExecutionRevisions)
                .set({ profileVersionId: blueskyProfileVersionId })
                .where(eq(publicationExecutionRevisions.id, fixture.executionRevisionId))
                .run()

            store.reconcile(publishedAt)
            expect(readRow(fixture)).toMatchObject({
                state: 'waiting',
                rootUri: null,
                instanceOrigin: null,
                accountId: null,
            })
            expect(store.getNextEventAt(now)).toBeNull()
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('leaves Bluesky comments untouched by the Mastodon parser', () => {
        const fixture = createFixture('bluesky-parser')

        try {
            let parserCalls = 0
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies.map(policy =>
                    policy.id === 'mastodon'
                        ? createMastodonCommentPolicy((externalId, externalUrl) => {
                              parserCalls += 1
                              return resolveMastodonStatusReference(externalId, externalUrl)
                          })
                        : policy
                ),
            })
            store.save({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.editorSubjectId,
                text: 'Thanks for the update',
                delaySeconds: 300,
                expectedRevision: 0,
                recordKey: 'comment1',
                now,
            })
            const publishedAt = now + 1_000
            publishNatively(fixture, { publishedAt })
            store.reconcile(publishedAt)

            expect(readRow(fixture)).toMatchObject({
                state: 'pending',
                providerId: 'bluesky',
                instanceOrigin: null,
                rootUri,
                accountId: accountDid,
            })
            expect(parserCalls).toBe(0)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('keeps historical Bluesky comments when the provider column is added', () => {
        const folder = mkdtempSync(join(tmpdir(), 'postbot-first-comment-migration-'))

        try {
            // The committed history without the provider column.
            const journal = JSON.parse(
                readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')
            ) as { entries: { idx: number; tag: string }[] }
            const historical = {
                ...journal,
                entries: journal.entries.filter(entry => entry.idx < 18),
            }
            mkdirSync(join(folder, 'meta'))
            for (const entry of historical.entries) {
                writeFileSync(
                    join(folder, `${entry.tag}.sql`),
                    readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url))
                )
            }
            writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(historical))

            const fixture = createFixture('historical', 'bluesky', {
                migrationsFolder: folder,
            })

            fixture.database.$client
                .query(
                    `insert into publication_first_comments
                        (id, project_id, publication_id, actor_id, text, delay_seconds, state,
                         revision, record_key, attempts, created_at, updated_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, 'sent', 1, ?7, 1, ?8, ?8)`
                )
                .run(
                    'historical-comment',
                    fixture.projectId,
                    fixture.publicationId,
                    fixture.editorActorId,
                    'A historical Bluesky comment',
                    300,
                    'historical-comment',
                    now
                )

            // The provider column is added by the committed migration.
            runMigrations(fixture.database)

            const row = fixture.database.$client
                .query<
                    {
                        readonly providerId: string
                        readonly instanceOrigin: string | null
                        readonly text: string
                        readonly state: string
                        readonly revision: number
                    },
                    [string]
                >(
                    `select provider_id as providerId,
                            instance_origin as instanceOrigin,
                            text,
                            state,
                            revision
                     from publication_first_comments
                     where id = ?1`
                )
                .get('historical-comment')

            expect(row).toEqual({
                providerId: 'bluesky',
                instanceOrigin: null,
                text: 'A historical Bluesky comment',
                state: 'sent',
                revision: 1,
            })
            expect(fixture.database.$client.query('pragma foreign_key_check').all()).toEqual([])
        } finally {
            rmSync(folder, { recursive: true, force: true })
        }
    })
})

it('uses a synthetic provider policy while retaining access, receipt and claim fences', () => {
    const fixture = createFixture('synthetic-policy')
    try {
        const baseline = providerCommentPolicies.find(policy => policy.id === 'bluesky')!
        const policy = {
            ...baseline,
            id: 'synthetic',
            normalizeText: (text: string) => baseline.normalizeText(text.toUpperCase()),
        }
        const store = createPublicationFirstCommentStore(fixture.database, { policies: [policy] })
        const profile = {
            ...blueskyProfile,
            execution: { ...blueskyProfile.execution, contractId: policy.id },
        }
        fixture.database
            .update(channelProfileVersions)
            .set({ profileJson: profile })
            .where(eq(channelProfileVersions.id, fixture.profileVersionId))
            .run()
        fixture.database.update(publishers).set({ kind: policy.id }).run()
        fixture.database.update(publisherCredentials).set({ providerId: policy.id }).run()
        const input = {
            projectId: fixture.projectId,
            publicationId: fixture.publicationId,
            subjectId: fixture.editorSubjectId,
            text: 'A synthetic comment',
            delaySeconds: 0,
            expectedRevision: 0,
            recordKey: 'synthetic-key',
            now,
        }
        expect(store.save({ ...input, subjectId: fixture.viewerSubjectId })).toEqual({
            kind: 'not_found',
        })
        const saved = store.save(input)
        expect(saved.kind).toBe('saved')
        expect(readRow(fixture)).toMatchObject({
            providerId: 'synthetic',
            text: 'A SYNTHETIC COMMENT',
            state: 'waiting',
        })
        publishNatively(fixture, { publishedAt: now + 1 })
        store.reconcile(now + 1)
        expect(readRow(fixture)).toMatchObject({
            providerId: 'synthetic',
            state: 'pending',
            rootUri,
            accountId: accountDid,
        })
        const claim = store.deliveries.claimNextDueJob({
            actorId: fixture.editorActorId,
            claimToken: 'synthetic-claim',
            now: now + 1,
            leaseExpiresAt: now + 1 + leaseDuration,
        })
        expect(claim).not.toBeNull()
        if (!claim) return
        expect(store.claimCurrent(claim, now + 2)).toBe(true)
        fixture.database.update(publisherCredentials).set({ state: 'reconnect_required' }).run()
        expect(store.claimCurrent(claim, now + 3)).toBe(false)
        expect(fixture.database.$client.query('pragma foreign_key_check').all()).toEqual([])
    } finally {
        closeDatabase(fixture.database)
    }
})
