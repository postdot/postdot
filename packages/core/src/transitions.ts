import {
    DomainInvariantError,
    requireNonBlank,
    requireSameProject,
    requireTimestamp,
} from './invariants'
import type { Actor, Job, JobState, Publication, PublicationState, Timestamp } from './model'

export const publicationTransitions: Readonly<
    Record<PublicationState, readonly PublicationState[]>
> = {
    draft: ['scheduled', 'ready', 'cancelled'],
    scheduled: ['ready', 'cancelled'],
    ready: ['publishing', 'published', 'failed', 'cancelled'],
    publishing: ['published', 'failed', 'ambiguous'],
    published: [],
    failed: ['ready', 'cancelled'],
    ambiguous: ['published', 'failed', 'cancelled'],
    cancelled: [],
}

export const jobTransitions: Readonly<Record<JobState, readonly JobState[]>> = {
    pending: ['running', 'cancelled'],
    running: ['succeeded', 'failed'],
    succeeded: [],
    failed: ['pending', 'cancelled'],
    cancelled: [],
}

function requireTransitionTime(now: Timestamp, updatedAt: Timestamp): Timestamp {
    const timestamp = requireTimestamp(now, 'now')

    if (timestamp < updatedAt) {
        throw new DomainInvariantError('invalid_time', 'A transition cannot predate the entity')
    }

    return timestamp
}

function requireTransition<State extends string>(
    current: State,
    next: State,
    transitions: Readonly<Record<State, readonly State[]>>,
    entity: string
): void {
    if (!transitions[current].includes(next)) {
        throw new DomainInvariantError(
            'invalid_transition',
            `Cannot transition ${entity} from ${current} to ${next}`
        )
    }
}

interface TransitionPublicationInput {
    readonly publication: Publication
    readonly to: PublicationState
    readonly actor: Actor
    readonly now: Timestamp
    readonly scheduledAt?: Timestamp
    readonly errorMessage?: string
    readonly externalId?: string
    readonly externalUrl?: string
}

export function transitionPublication(input: TransitionPublicationInput): Publication {
    const { publication, to, actor } = input
    requireSameProject(publication.projectId, actor.projectId, 'state-changing actor')
    requireTransition(publication.state, to, publicationTransitions, 'publication')

    const now = requireTransitionTime(input.now, publication.updatedAt)
    let scheduledAt = publication.scheduledAt
    let scheduledByActorId = publication.scheduledByActorId

    if (to === 'scheduled') {
        scheduledAt = requireTimestamp(input.scheduledAt ?? Number.NaN, 'scheduledAt')
        if (scheduledAt < now) {
            throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
        }
        scheduledByActorId = actor.id
    }

    const hasFailure = to === 'failed' || to === 'ambiguous'
    const errorMessage = hasFailure
        ? requireNonBlank(input.errorMessage ?? '', 'errorMessage')
        : null

    return {
        ...publication,
        state: to,
        scheduledAt,
        scheduledByActorId,
        publishedAt: to === 'published' ? now : publication.publishedAt,
        publishedByActorId: to === 'published' ? actor.id : publication.publishedByActorId,
        externalId:
            to === 'published' && input.externalId !== undefined
                ? requireNonBlank(input.externalId, 'externalId')
                : publication.externalId,
        externalUrl:
            to === 'published' && input.externalUrl !== undefined
                ? requireNonBlank(input.externalUrl, 'externalUrl')
                : publication.externalUrl,
        errorMessage,
        stateChangedByActorId: actor.id,
        updatedAt: now,
    }
}

export function reschedulePublication(
    publication: Publication,
    scheduledAt: Timestamp,
    actor: Actor,
    now: Timestamp
): Publication {
    if (publication.state !== 'scheduled') {
        throw new DomainInvariantError(
            'invalid_transition',
            `Cannot reschedule a ${publication.state} publication`
        )
    }

    requireSameProject(publication.projectId, actor.projectId, 'scheduling actor')
    const changedAt = requireTransitionTime(now, publication.updatedAt)
    const nextScheduledAt = requireTimestamp(scheduledAt, 'scheduledAt')

    if (nextScheduledAt < changedAt) {
        throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
    }

    return {
        ...publication,
        scheduledAt: nextScheduledAt,
        scheduledByActorId: actor.id,
        stateChangedByActorId: actor.id,
        updatedAt: changedAt,
    }
}

interface TransitionJobInput {
    readonly job: Job
    readonly to: JobState
    readonly now: Timestamp
    readonly runAt?: Timestamp
    readonly errorMessage?: string
    readonly actor?: Actor
    readonly claimToken?: string
    readonly leaseExpiresAt?: Timestamp
}

export function transitionJob(input: TransitionJobInput): Job {
    const { job, to } = input
    requireTransition(job.state, to, jobTransitions, 'job')
    const now = requireTransitionTime(input.now, job.updatedAt)

    if (to === 'running') {
        const actor = input.actor
        if (actor === undefined) {
            throw new DomainInvariantError(
                'invalid_actor_kind',
                'A system actor is required to claim a job'
            )
        }
        if (actor.kind !== 'system') {
            throw new DomainInvariantError(
                'invalid_actor_kind',
                'Only a system actor can claim an execution job'
            )
        }

        requireSameProject(job.projectId, actor.projectId, 'claiming actor')
        const leaseExpiresAt = requireTimestamp(
            input.leaseExpiresAt ?? Number.NaN,
            'leaseExpiresAt'
        )
        if (leaseExpiresAt <= now) {
            throw new DomainInvariantError('invalid_time', 'leaseExpiresAt must be after now')
        }

        return {
            ...job,
            state: 'running',
            attempts: job.attempts + 1,
            claimToken: requireNonBlank(input.claimToken ?? '', 'claimToken'),
            claimedByActorId: actor.id,
            claimedAt: now,
            leaseExpiresAt,
            effectStartedAt: null,
            startedAt: now,
            completedAt: null,
            errorMessage: null,
            updatedAt: now,
        }
    }

    if (job.state === 'failed' && to === 'pending') {
        const runAt = requireTimestamp(input.runAt ?? Number.NaN, 'runAt')
        if (runAt < now) {
            throw new DomainInvariantError('invalid_time', 'runAt must not be before now')
        }

        return {
            ...job,
            state: 'pending',
            runAt,
            claimToken: null,
            claimedByActorId: null,
            claimedAt: null,
            leaseExpiresAt: null,
            effectStartedAt: null,
            startedAt: null,
            completedAt: null,
            errorMessage: null,
            updatedAt: now,
        }
    }

    if (job.state === 'running') {
        requireClaimToken(job, input.claimToken)
    }

    return {
        ...job,
        state: to,
        claimToken: job.state === 'running' ? null : job.claimToken,
        leaseExpiresAt: job.state === 'running' ? null : job.leaseExpiresAt,
        completedAt: to === 'succeeded' || to === 'failed' || to === 'cancelled' ? now : null,
        errorMessage:
            to === 'failed' ? requireNonBlank(input.errorMessage ?? '', 'errorMessage') : null,
        updatedAt: now,
    }
}

function requireClaimToken(job: Job, claimToken: string | undefined): void {
    if (job.claimToken === null || claimToken !== job.claimToken) {
        throw new DomainInvariantError('claim_mismatch', 'The job claim token does not match')
    }
}

export function startJobEffect(job: Job, claimToken: string, now: Timestamp): Job {
    if (job.state !== 'running' || job.effectStartedAt !== null) {
        throw new DomainInvariantError(
            'invalid_transition',
            'The external effect can start only once on a running job'
        )
    }

    requireClaimToken(job, claimToken)
    const startedAt = requireTransitionTime(now, job.updatedAt)
    if (job.leaseExpiresAt === null || startedAt >= job.leaseExpiresAt) {
        throw new DomainInvariantError('claim_expired', 'The job claim has expired')
    }

    return {
        ...job,
        effectStartedAt: startedAt,
        updatedAt: startedAt,
    }
}

export type ExpiredClaimDisposition = 'requeue' | 'ambiguous'

export function classifyExpiredClaim(job: Job, now: Timestamp): ExpiredClaimDisposition {
    if (job.state !== 'running' || job.leaseExpiresAt === null) {
        throw new DomainInvariantError('invalid_transition', 'Only a running claim can expire')
    }

    const recoveredAt = requireTransitionTime(now, job.updatedAt)
    if (recoveredAt < job.leaseExpiresAt) {
        throw new DomainInvariantError('claim_not_expired', 'The job claim has not expired')
    }

    return job.effectStartedAt === null ? 'requeue' : 'ambiguous'
}

export function reschedulePendingJob(job: Job, runAt: Timestamp, now: Timestamp): Job {
    if (job.state !== 'pending') {
        throw new DomainInvariantError('invalid_transition', `Cannot reschedule a ${job.state} job`)
    }

    const changedAt = requireTransitionTime(now, job.updatedAt)
    const nextRunAt = requireTimestamp(runAt, 'runAt')

    if (nextRunAt < changedAt) {
        throw new DomainInvariantError('invalid_time', 'runAt must not be before now')
    }

    return {
        ...job,
        runAt: nextRunAt,
        updatedAt: changedAt,
    }
}
