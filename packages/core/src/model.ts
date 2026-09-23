import {
    DomainInvariantError,
    requireNonBlank,
    requireSameProject,
    requireTimestamp,
} from './invariants'
import { validateSourceContent, type SourceContent } from './source-content'
import { requireProjectTimeZone, type ProjectTimeZone } from './time-zone'

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
export const channelStates = ['active', 'archived'] as const
export const deliveryModes = ['manual', 'automatic'] as const
export const publicationReviewStates = ['compatible', 'review_required'] as const

export type ActorKind = (typeof actorKinds)[number]
export type PublicationState = (typeof publicationStates)[number]
export type JobState = (typeof jobStates)[number]
export type PublisherCredentialState = (typeof publisherCredentialStates)[number]
export type ChannelState = (typeof channelStates)[number]
export type DeliveryMode = (typeof deliveryModes)[number]
export type PublicationReviewState = (typeof publicationReviewStates)[number]
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
    readonly timeZone: ProjectTimeZone
    readonly workspaceId: string | null
    readonly primaryCategoryId: string | null
}

export interface Actor extends ProjectEntity {
    readonly kind: ActorKind
    readonly subjectId: string | null
    readonly displayName: string
}

export interface Channel extends ProjectEntity {
    readonly name: string
    readonly profileId: string
    readonly profileVersionId: string
    readonly state: ChannelState
    readonly archivedAt: Timestamp | null
    readonly revision: number
}

export interface Publisher extends ProjectEntity {
    readonly channelId: string
    readonly kind: string
}

export interface PublisherCredential extends ProjectEntity {
    readonly providerId: string
    /** The instance-owned OAuth application used to obtain this grant, when known. */
    readonly providerApplicationId?: string | null
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly scopes: readonly string[]
    readonly state: PublisherCredentialState
    readonly expiresAt: Timestamp | null
    readonly connectedByActorId: string
}

export interface Post extends ProjectEntity {
    readonly title: string | null
    readonly sourceContent: SourceContent
    readonly sourceRevision: number
    readonly createdByActorId: string
}

export interface Publication extends ProjectEntity {
    readonly postId: string
    readonly channelId: string
    readonly targetRevisionId: string | null
    readonly deliveryMode: DeliveryMode
    readonly reviewState: PublicationReviewState
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
    readonly lastAssessedProfileVersionId: string | null
    readonly profileAssessmentIssues: readonly Record<string, unknown>[]
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

export function createProject(
    input: CreateEntityInput & {
        readonly name: string
        readonly timeZone?: string
        readonly workspaceId?: string | null
    }
): Project {
    return {
        ...entityFields(input),
        name: requireNonBlank(input.name, 'name'),
        timeZone: requireProjectTimeZone(input.timeZone),
        workspaceId: input.workspaceId ?? null,
        primaryCategoryId: null,
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
    input: CreateEntityInput & {
        readonly project: Project
        readonly name: string
        readonly profileId: string
        readonly profileVersionId: string
    }
): Channel {
    return {
        ...projectEntityFields(input, input.project),
        name: requireNonBlank(input.name, 'name'),
        profileId: requireNonBlank(input.profileId, 'profileId'),
        profileVersionId: requireNonBlank(input.profileVersionId, 'profileVersionId'),
        state: 'active',
        archivedAt: null,
        revision: 1,
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
    if (input.channel.state !== 'active') {
        throw new DomainInvariantError(
            'invalid_transition',
            `Cannot create a publisher for an ${input.channel.state} channel`
        )
    }

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
        readonly providerApplicationId?: string | null
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
        ...(input.providerApplicationId === undefined
            ? {}
            : {
                  providerApplicationId:
                      input.providerApplicationId === null
                          ? null
                          : requireNonBlank(input.providerApplicationId, 'providerApplicationId'),
              }),
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
        readonly sourceContent: SourceContent
    }
): Post {
    requireSameProject(input.project.id, input.createdBy.projectId, 'createdBy actor')
    const sourceContent = validateSourceContent(input.sourceContent)
    if (!sourceContent.ok) {
        throw new DomainInvariantError(
            'invalid_content',
            `Source content is invalid: ${sourceContent.issues.map(issue => issue.message).join('; ')}`
        )
    }

    return {
        ...projectEntityFields(input, input.project),
        title:
            input.title === null || input.title === undefined
                ? null
                : requireNonBlank(input.title, 'title'),
        sourceContent: sourceContent.value,
        sourceRevision: 1,
        createdByActorId: input.createdBy.id,
    }
}

export function createPublication(
    input: CreateEntityInput & {
        readonly project: Project
        readonly post: Post
        readonly channel: Channel
        readonly createdBy: Actor
        readonly targetRevisionId?: string | null
        readonly deliveryMode?: DeliveryMode
        readonly reviewState?: PublicationReviewState
        readonly scheduledAt?: Timestamp | null
    }
): Publication {
    requireSameProject(input.project.id, input.post.projectId, 'post')
    requireSameProject(input.project.id, input.channel.projectId, 'channel')
    requireSameProject(input.project.id, input.createdBy.projectId, 'createdBy actor')
    if (input.channel.state !== 'active') {
        throw new DomainInvariantError(
            'invalid_transition',
            `Cannot create a publication for an ${input.channel.state} channel`
        )
    }

    const scheduledAt =
        input.scheduledAt === null || input.scheduledAt === undefined
            ? null
            : requireTimestamp(input.scheduledAt, 'scheduledAt')

    const deliveryMode = input.deliveryMode ?? 'manual'
    if (!(deliveryModes as readonly string[]).includes(deliveryMode)) {
        throw new DomainInvariantError('invalid_input', `Unknown delivery mode: ${deliveryMode}`)
    }

    const reviewState = input.reviewState ?? 'compatible'
    if (!(publicationReviewStates as readonly string[]).includes(reviewState)) {
        throw new DomainInvariantError(
            'invalid_input',
            `Unknown publication review state: ${reviewState}`
        )
    }

    const targetRevisionId =
        input.targetRevisionId === null || input.targetRevisionId === undefined
            ? null
            : requireNonBlank(input.targetRevisionId, 'targetRevisionId')

    if (scheduledAt !== null && targetRevisionId === null) {
        throw new DomainInvariantError(
            'invalid_input',
            'A scheduled publication must reference a target revision'
        )
    }
    if (scheduledAt !== null && reviewState !== 'compatible') {
        throw new DomainInvariantError(
            'invalid_content',
            'A publication with review-required content cannot be scheduled'
        )
    }

    if (scheduledAt !== null && scheduledAt < input.now) {
        throw new DomainInvariantError('invalid_time', 'scheduledAt must not be before now')
    }

    return {
        ...projectEntityFields(input, input.project),
        postId: input.post.id,
        channelId: input.channel.id,
        targetRevisionId,
        deliveryMode,
        reviewState,
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
        lastAssessedProfileVersionId: null,
        profileAssessmentIssues: [],
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
    if (input.publication.deliveryMode !== 'automatic') {
        throw new DomainInvariantError(
            'invalid_job_source',
            'Execution jobs require an automatic publication'
        )
    }
    if (input.publication.targetRevisionId === null) {
        throw new DomainInvariantError(
            'invalid_job_source',
            'Execution jobs require a target revision'
        )
    }
    if (input.publication.reviewState !== 'compatible') {
        throw new DomainInvariantError(
            'invalid_job_source',
            'Execution jobs require a compatible publication revision'
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
