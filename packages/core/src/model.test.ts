import { describe, expect, test } from 'bun:test'

import {
    DomainInvariantError,
    classifyExpiredClaim,
    createActor,
    createChannel,
    createJob,
    createPost,
    createProject,
    createPublication,
    createPublisher,
    createPublisherCredential,
    reschedulePendingJob,
    startJobEffect,
    transitionJob,
    transitionPublication,
} from './index'

const now = 1_800_000_000_000

const sourceContent = (text: string) => ({
    body: { text, format: 'plain_text' as const },
    media: [],
})

function createFixture(prefix = 'one') {
    const project = createProject({ id: `${prefix}-project`, name: 'Herald', now })
    const actor = createActor({
        id: `${prefix}-actor`,
        project,
        kind: 'human',
        displayName: 'Editor',
        now,
    })
    const systemActor = createActor({
        id: `${prefix}-system-actor`,
        project,
        kind: 'system',
        displayName: 'Herald worker',
        now,
    })
    const channel = createChannel({
        id: `${prefix}-channel`,
        project,
        name: 'Release notes',
        profileId: 'test-profile',
        profileVersionId: `${prefix}-profile-v1`,
        now,
    })
    const post = createPost({
        id: `${prefix}-post`,
        project,
        createdBy: actor,
        title: 'Version 1',
        sourceContent: sourceContent('Canonical post content'),
        now,
    })

    return { project, actor, systemActor, channel, post }
}

function createExecutionFixture(prefix = 'one') {
    const fixture = createFixture(prefix)
    const publisher = createPublisher({
        id: `${prefix}-publisher`,
        project: fixture.project,
        channel: fixture.channel,
        kind: 'test',
        now,
    })

    return { ...fixture, publisher }
}

function expectInvariant(action: () => unknown, code: DomainInvariantError['code']): void {
    try {
        action()
        throw new Error(`Expected ${code}`)
    } catch (error) {
        expect(error).toBeInstanceOf(DomainInvariantError)
        expect((error as DomainInvariantError).code).toBe(code)
    }
}

describe('domain construction', () => {
    test('keeps manual channels valid and publishers channel-specific', () => {
        const { project, channel } = createFixture()

        expect(channel.projectId).toBe(project.id)
        expect('publisherId' in channel).toBe(false)

        const publisher = createPublisher({
            id: 'publisher',
            project,
            channel,
            kind: 'mastodon',
            now,
        })

        expect(publisher.channelId).toBe(channel.id)
        expect(publisher.kind).toBe('mastodon')
        expect('config' in publisher).toBe(false)
    })

    test('rejects relations across project boundaries', () => {
        const first = createFixture('first')
        const second = createFixture('second')

        expectInvariant(
            () =>
                createPublication({
                    id: 'publication',
                    project: first.project,
                    post: first.post,
                    channel: second.channel,
                    createdBy: first.actor,
                    now,
                }),
            'project_mismatch'
        )
    })

    test('keeps the source post separate from the target revision pointer', () => {
        const fixture = createFixture()
        const publication = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            targetRevisionId: 'target-revision',
            now,
        })

        expect(publication.postId).toBe(fixture.post.id)
        expect(publication.targetRevisionId).toBe('target-revision')
        expect(publication.targetRevisionId).not.toBe(fixture.post.sourceRevision.toString())
        expect(publication.state).toBe('draft')
    })

    test('records scheduling attribution at creation', () => {
        const fixture = createFixture()
        const publication = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            targetRevisionId: 'target-revision',
            scheduledAt: now + 60_000,
            now,
        })

        expect(publication.state).toBe('scheduled')
        expect(publication.scheduledByActorId).toBe(fixture.actor.id)
        expect(publication.scheduledAt).toBe(now + 60_000)
    })

    test('makes publisher credentials project-owned and records connection attribution', () => {
        const first = createFixture('first')
        const second = createFixture('second')
        const credential = createPublisherCredential({
            id: 'credential',
            project: first.project,
            connectedBy: first.actor,
            providerId: ' linkedin ',
            externalAccountId: ' member-1 ',
            externalAccountName: ' Herald Operator ',
            scopes: ['w_member_social', 'openid', 'w_member_social'],
            expiresAt: now + 60_000,
            now,
        })

        expect(credential).toMatchObject({
            projectId: first.project.id,
            connectedByActorId: first.actor.id,
            providerId: 'linkedin',
            externalAccountId: 'member-1',
            externalAccountName: 'Herald Operator',
            scopes: ['openid', 'w_member_social'],
            state: 'active',
        })
        expect(credential).not.toHaveProperty('userId')
        expectInvariant(
            () =>
                createPublisherCredential({
                    id: 'invalid-credential',
                    project: first.project,
                    connectedBy: second.actor,
                    providerId: 'linkedin',
                    externalAccountId: 'member-2',
                    now,
                }),
            'project_mismatch'
        )
    })
})

describe('publication lifecycle', () => {
    test('supports direct manual publication without an execution job', () => {
        const fixture = createFixture()
        const draft = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            now,
        })
        const ready = transitionPublication({
            publication: draft,
            to: 'ready',
            actor: fixture.actor,
            now: now + 1,
        })
        const published = transitionPublication({
            publication: ready,
            to: 'published',
            actor: fixture.actor,
            now: now + 2,
            externalUrl: 'https://example.com/posts/one',
        })

        expect(published.publishedAt).toBe(now + 2)
        expect(published.publishedByActorId).toBe(fixture.actor.id)
        expect(published.externalUrl).toBe('https://example.com/posts/one')
    })

    test('makes ambiguous outcomes explicit and terminal states immutable', () => {
        const fixture = createFixture()
        const draft = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            now,
        })
        const ready = transitionPublication({
            publication: draft,
            to: 'ready',
            actor: fixture.actor,
            now: now + 1,
        })
        const publishing = transitionPublication({
            publication: ready,
            to: 'publishing',
            actor: fixture.actor,
            now: now + 2,
        })
        const ambiguous = transitionPublication({
            publication: publishing,
            to: 'ambiguous',
            actor: fixture.actor,
            now: now + 3,
            errorMessage: 'The provider timed out after accepting the request',
        })

        expect(ambiguous.errorMessage).toContain('timed out')

        const published = transitionPublication({
            publication: ambiguous,
            to: 'published',
            actor: fixture.actor,
            now: now + 4,
        })
        expectInvariant(
            () =>
                transitionPublication({
                    publication: published,
                    to: 'failed',
                    actor: fixture.actor,
                    now: now + 5,
                    errorMessage: 'Too late',
                }),
            'invalid_transition'
        )
    })
})

describe('job lifecycle', () => {
    test('tracks attempts independently and supports an explicit retry', () => {
        const fixture = createExecutionFixture()
        const publication = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            targetRevisionId: 'target-revision',
            deliveryMode: 'automatic',
            scheduledAt: now + 60_000,
            now,
        })
        const pending = createJob({
            id: 'job',
            publication,
            publisher: fixture.publisher,
            runAt: now + 60_000,
            now,
        })
        const running = transitionJob({
            job: pending,
            to: 'running',
            actor: fixture.systemActor,
            claimToken: 'claim-one',
            leaseExpiresAt: now + 120_000,
            now: now + 60_000,
        })
        const failed = transitionJob({
            job: running,
            to: 'failed',
            claimToken: 'claim-one',
            now: now + 60_001,
            errorMessage: 'Connection refused',
        })
        const retry = transitionJob({
            job: failed,
            to: 'pending',
            now: now + 60_002,
            runAt: now + 120_000,
        })
        const rescheduled = reschedulePendingJob(retry, now + 180_000, now + 60_003)

        expect(running.attempts).toBe(1)
        expect(running.claimedByActorId).toBe(fixture.systemActor.id)
        expect(failed.completedAt).toBe(now + 60_001)
        expect(failed.claimToken).toBeNull()
        expect(retry.attempts).toBe(1)
        expect(retry.errorMessage).toBeNull()
        expect(rescheduled.runAt).toBe(now + 180_000)
    })

    test('distinguishes safe recovery from an ambiguous external effect', () => {
        const fixture = createExecutionFixture()
        const publication = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            targetRevisionId: 'target-revision',
            deliveryMode: 'automatic',
            scheduledAt: now + 60_000,
            now,
        })
        const pending = createJob({
            id: 'job',
            publication,
            publisher: fixture.publisher,
            runAt: now + 60_000,
            now,
        })
        const running = transitionJob({
            job: pending,
            to: 'running',
            actor: fixture.systemActor,
            claimToken: 'claim-one',
            leaseExpiresAt: now + 120_000,
            now: now + 60_000,
        })

        expect(classifyExpiredClaim(running, now + 120_000)).toBe('requeue')

        const effectStarted = startJobEffect(running, 'claim-one', now + 60_001)
        expect(classifyExpiredClaim(effectStarted, now + 120_000)).toBe('ambiguous')
        expectInvariant(
            () => startJobEffect(running, 'stale-claim', now + 60_001),
            'claim_mismatch'
        )
    })

    test('does not create execution work for a draft', () => {
        const fixture = createExecutionFixture()
        const draft = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            deliveryMode: 'automatic',
            now,
        })

        expectInvariant(
            () =>
                createJob({
                    id: 'job',
                    publication: draft,
                    publisher: fixture.publisher,
                    runAt: now,
                    now,
                }),
            'invalid_job_source'
        )
    })

    test('does not create execution work in the past', () => {
        const fixture = createExecutionFixture()
        const publication = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            targetRevisionId: 'target-revision',
            deliveryMode: 'automatic',
            scheduledAt: now + 60_000,
            now,
        })

        expectInvariant(
            () =>
                createJob({
                    id: 'job',
                    publication,
                    publisher: fixture.publisher,
                    runAt: now - 1,
                    now,
                }),
            'invalid_time'
        )
    })

    test('does not create execution work with another channel publisher', () => {
        const fixture = createExecutionFixture('first')
        const otherChannel = createChannel({
            id: 'other-channel',
            project: fixture.project,
            name: 'Other channel',
            profileId: 'other-profile',
            profileVersionId: 'other-profile-v1',
            now,
        })
        const otherPublisher = createPublisher({
            id: 'other-publisher',
            project: fixture.project,
            channel: otherChannel,
            kind: 'test',
            now,
        })
        const publication = createPublication({
            id: 'publication',
            ...fixture,
            createdBy: fixture.actor,
            targetRevisionId: 'target-revision',
            deliveryMode: 'automatic',
            scheduledAt: now + 60_000,
            now,
        })

        expectInvariant(
            () =>
                createJob({
                    id: 'job',
                    publication,
                    publisher: otherPublisher,
                    runAt: now + 60_000,
                    now,
                }),
            'invalid_job_source'
        )
    })
})
