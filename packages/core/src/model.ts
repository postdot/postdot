import {
    DomainInvariantError,
    requireNonBlank,
    requireSameProject,
    requireTimestamp,
} from './invariants'

export const actorKinds = ['human', 'agent', 'api_token', 'system'] as const
export const publicationStates = [
    'draft',
    'scheduled',
    'ready',
    'publishing',
    'published',
    'failed',
    'ambiguous',
    'cancelled',
] as const
export const jobStates = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const
export const publisherCredentialStates = ['active', 'reconnect_required', 'revoked'] as const

export type ActorKind = (typeof actorKinds)[number]
export type PublicationState = (typeof publicationStates)[number]
export type JobState = (typeof jobStates)[number]
export type PublisherCredentialState = (typeof publisherCredentialStates)[number]
export type Timestamp = number

interface Entity {
    readonly id: string
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

interface ProjectEntity extends Entity {
    readonly projectId: string
}

export interface Project extends Entity {
    readonly name: string
}

export interface Actor extends ProjectEntity {
    readonly kind: ActorKind
    readonly subjectId: string | null
    readonly displayName: string
}

export interface Channel extends ProjectEntity {
    readonly name: string
}

export interface Publisher extends ProjectEntity {
    readonly channelId: string
    readonly kind: string
}

export interface PublisherCredential extends ProjectEntity {
    readonly providerId: string
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly scopes: readonly string[]
    readonly state: PublisherCredentialState
    readonly expiresAt: Timestamp | null
    readonly connectedByActorId: string
}

export interface Post extends ProjectEntity {
    readonly title: string | null
    readonly content: string
    readonly createdByActorId: string
}

export interface Publication extends ProjectEntity {
    readonly postId: string
    readonly channelId: string
    readonly content: string
    readonly state: PublicationState
    readonly scheduledAt: Timestamp | null
    readonly publishedAt: Timestamp | null
    readonly externalId: string | null
    readonly externalUrl: string | null
    readonly errorMessage: string | null
    readonly createdByActorId: string
    readonly scheduledByActorId: string | null
    readonly stateChangedByActorId: string
    readonly publishedByActorId: string | null
}

export interface Job extends ProjectEntity {
    readonly publicationId: string
    readonly state: JobState
    readonly runAt: Timestamp
    readonly attempts: number
    readonly claimToken: string | null
    readonly claimedByActorId: string | null
    readonly claimedAt: Timestamp | null
    readonly leaseExpiresAt: Timestamp | null
    readonly effectStartedAt: Timestamp | null
    readonly startedAt: Timestamp | null
    readonly completedAt: Timestamp | null
    readonly errorMessage: string | null
}

interface CreateEntityInput {
    readonly id: string
    readonly now: Timestamp
}

function entityFields(input: CreateEntityInput): Entity {
    const now = requireTimestamp(input.now, 'now')

    return {
        id: requireNonBlank(input.id, 'id'),
        createdAt: now,
        updatedAt: now,
    }
}

function projectEntityFields(input: CreateEntityInput, project: Project): ProjectEntity {
    return {
        ...entityFields(input),
        projectId: project.id,
    }
}

export function createProject(input: CreateEntityInput & { readonly name: string }): Project {
    return {
        ...entityFields(input),
        name: requireNonBlank(input.name, 'name'),
    }
}

export function createActor(
    input: CreateEntityInput & {
        readonly project: Project
        readonly kind: ActorKind
        readonly subjectId?: string | null
        readonly displayName: string
    }
): Actor {
    if (!(actorKinds as readonly string[]).includes(input.kind)) {
        throw new DomainInvariantError('invalid_actor_kind', `Unknown actor kind: ${input.kind}`)
    }

    return {
        ...projectEntityFields(input, input.project),
        kind: input.kind,
        subjectId:
            input.subjectId === null || input.subjectId === undefined
                ? null
                : requireNonBlank(input.subjectId, 'subjectId'),
        displayName: requireNonBlank(input.displayName, 'displayName'),
    }
}

export function createChannel(
    input: CreateEntityInput & { readonly project: Project; readonly name: string }
): Channel {
    return {
        ...projectEntityFields(input, input.project),
        name: requireNonBlank(input.name, 'name'),
    }
}

export function createPublisher(
    input: CreateEntityInput & {
        readonly project: Project
        readonly channel: Channel
        readonly kind: string
    }
): Publisher {
    requireSameProject(input.project.id, input.channel.projectId, 'channel')

    return {
        ...projectEntityFields(input, input.project),
        channelId: input.channel.id,
        kind: requireNonBlank(input.kind, 'kind'),
    }
}

export function createPublisherCredential(
    input: CreateEntityInput & {
        readonly project: Project
        readonly connectedBy: Actor
        readonly providerId: string
        readonly externalAccountId: string
        readonly externalAccountName?: string | null
        readonly scopes?: readonly string[]
        readonly expiresAt?: Timestamp | null
    }
): PublisherCredential {
    requireSameProject(input.project.id, input.connectedBy.projectId, 'connectedBy actor')

    const scopes = [
        ...new Set((input.scopes ?? []).map(scope => requireNonBlank(scope, 'scope'))),
    ].sort()

    return {
        ...projectEntityFields(input, input.project),
        providerId: requireNonBlank(input.providerId, 'providerId'),
        externalAccountId: requireNonBlank(input.externalAccountId, 'externalAccountId'),
        externalAccountName:
            input.externalAccountName === null || input.externalAccountName === undefined
                ? null
                : requireNonBlank(input.externalAccountName, 'externalAccountName'),
        scopes,
        state: 'active',
        expiresAt:
            input.expiresAt === null || input.expiresAt === undefined
                ? null
                : requireTimestamp(input.expiresAt, 'expiresAt'),
        connectedByActorId: input.connectedBy.id,
    }
}

export function createPost(
    input: CreateEntityInput & {
        readonly project: Project
        readonly createdBy: Actor
        readonly title?: string | null
        readonly content: string
    }
): Post {
    requireSameProject(input.project.id, input.createdBy.projectId, 'createdBy actor')

    return {
        ...projectEntityFields(input, input.project),
        title:
            input.title === null || input.title === undefined
                ? null
                : requireNonBlank(input.title, 'title'),
        content: requireNonBlank(input.content, 'content'),
        createdByActorId: input.createdBy.id,
    }
}

export function createPublication(
    input: CreateEntityInput & {
        readonly project: Project
        readonly post: Post
        readonly channel: Channel
        readonly createdBy: Actor
        readonly content: string
        readonly scheduledAt?: Timestamp | null
    }
): Publication {
    requireSameProject(input.project.id, input.post.projectId, 'post')
    requireSameProject(input.project.id, input.channel.projectId, 'channel')
    requireSameProject(input.project.id, input.createdBy.projectId, 'createdBy actor')

    const scheduledAt =
        input.scheduledAt === null || input.scheduledAt === undefined
            ? null
            : requireTimestamp(input.scheduledAt, 'scheduledAt')

    if (scheduledAt !== null && scheduledAt < input.now) {
        throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
    }

    return {
        ...projectEntityFields(input, input.project),
        postId: input.post.id,
        channelId: input.channel.id,
        content: requireNonBlank(input.content, 'content'),
        state: scheduledAt === null ? 'draft' : 'scheduled',
        scheduledAt,
        publishedAt: null,
        externalId: null,
        externalUrl: null,
        errorMessage: null,
        createdByActorId: input.createdBy.id,
        scheduledByActorId: scheduledAt === null ? null : input.createdBy.id,
        stateChangedByActorId: input.createdBy.id,
        publishedByActorId: null,
    }
}

export function createJob(
    input: CreateEntityInput & {
        readonly publication: Publication
        readonly publisher: Publisher
        readonly runAt: Timestamp
    }
): Job {
    if (input.publication.state !== 'scheduled' && input.publication.state !== 'ready') {
        throw new DomainInvariantError(
            'invalid_job_source',
            `Cannot create a job for a ${input.publication.state} publication`
        )
    }
    requireSameProject(input.publication.projectId, input.publisher.projectId, 'publisher')
    if (input.publication.channelId !== input.publisher.channelId) {
        throw new DomainInvariantError(
            'invalid_job_source',
            'A job publisher must belong to the publication channel'
        )
    }

    const runAt = requireTimestamp(input.runAt, 'runAt')
    if (runAt < input.now) {
        throw new DomainInvariantError('invalid_time', 'runAt must not be before now')
    }

    return {
        ...entityFields(input),
        projectId: input.publication.projectId,
        publicationId: input.publication.id,
        state: 'pending',
        runAt,
        attempts: 0,
        claimToken: null,
        claimedByActorId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        effectStartedAt: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
    }
}
