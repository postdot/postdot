import { describe, expect, it } from 'bun:test'

import { eq } from 'drizzle-orm'

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

interface Fixture {
    readonly database: ReturnType<typeof createDatabase>
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

function createFixture(suffix = 'one'): Fixture {
    const database = createDatabase(':memory:')
    runMigrations(database)

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
    database
        .insert(channels)
        .values({ id: channelId, projectId, name: 'Bluesky channel', profileVersionId })
        .run()
    database
        .insert(channelProfileVersions)
        .values({
            id: profileVersionId,
            projectId,
            channelId,
            profileId: blueskyProfile.id,
            version: blueskyProfile.version,
            origin: blueskyProfile.origin,
            state: 'active',
            profileJson: blueskyProfile,
            profileHash: blueskyProfile.profileHash,
            schemaHash: blueskyProfile.schemaHash,
            createdByActorId: editorActorId,
        })
        .run()
    database
        .insert(publishers)
        .values({ id: `publisher-${suffix}`, projectId, channelId, kind: 'bluesky' })
        .run()
    database
        .insert(publisherCredentials)
        .values({
            id: credentialId,
            projectId,
            providerId: 'bluesky',
            externalAccountId: accountDid,
            externalAccountName: 'Bluesky Operator',
            scopes: ['atproto'],
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
            profileHash: blueskyProfile.profileHash,
            schemaHash: blueskyProfile.schemaHash,
            validationIssuesJson: [],
            createdByActorId: editorActorId,
        })
        .run()

    return {
        database,
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
    }
): void {
    fixture.database
        .update(publications)
        .set({
            state: 'published',
            publishedAt: options.publishedAt,
            publishedByActorId: fixture.editorActorId,
            stateChangedByActorId: fixture.editorActorId,
            externalId: rootUri,
            externalUrl: `https://bsky.app/profile/${accountDid}/app.bsky.feed.post/comment1`,
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
            profileHash: blueskyProfile.profileHash,
            schemaHash: blueskyProfile.schemaHash,
        })
        .run()
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
    return createPublicationFirstCommentStore(fixture.database).save({
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
            const store = createPublicationFirstCommentStore(fixture.database)

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
                createPublicationFirstCommentStore(manual.database).canConfigure(
                    manual.projectId,
                    manual.publicationId
                )
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(manual.database)
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
            const store = createPublicationFirstCommentStore(failed.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(cancelled.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(disconnected.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
            const store = createPublicationFirstCommentStore(fixture.database)
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
