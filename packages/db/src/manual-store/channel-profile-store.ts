import { createHash } from 'node:crypto'

import {
    DomainInvariantError,
    fingerprintChannelProfile,
    requireNonBlank,
    requireTimestamp,
    type ChannelProfileDefinition,
    type ChannelProfileDraftDefinition,
    type ChannelProfileCompiler,
    type ChannelProfileVersionState,
    type PublicationReviewState,
    type ValidationIssue,
} from '@postdot/core'

import { createDatabaseTransaction, type PostbotDatabase } from '../client'
import type {
    ActivateChannelProfileInput,
    ChannelProfileActivationResult,
    ChannelProfileVersion,
    CreateChannelProfileDraftInput,
} from '../manual-store'
import {
    assertActiveAndDraftProfiles,
    createChannelProfileReadStore,
} from './channel-profile-read-store'
import { invalidProfileError } from './content-codec'
import { toChannel } from './project-channel-mappers'
import type { ActorRow, ProfileRow, PublicationChannelRow, TargetRevisionMediaRow } from './rows'

interface ActiveJob {
    readonly id: string
    readonly state: 'pending' | 'running'
}

interface WorkingDraftAssessmentUpdate {
    readonly reviewState: PublicationReviewState
    readonly issuesJson: string
    readonly profileVersionId: string
    readonly updatedByActorId: string
    readonly updatedAt: number
    readonly projectId: string
    readonly publicationId: string
}

interface PublicationAssessmentUpdate {
    readonly reviewState: PublicationReviewState
    readonly issuesJson: string
    readonly profileVersionId: string
    readonly updatedAt: number
    readonly actorId: string
    readonly projectId: string
    readonly publicationId: string
}

interface AutomaticJobReconciliation {
    readonly projectId: string
    readonly publicationId: string
    readonly channel: PublicationChannelRow
    readonly timestamp: number
}

interface AuditEventInput {
    readonly id: string
    readonly projectId: string
    readonly actorId: string
    readonly action: string
    readonly entityType: string
    readonly entityId: string
    readonly metadataJson: string | null
    readonly createdAt: number
}

export interface ChannelProfileStoreOptions {
    readonly now: () => number
    readonly createId: () => string
    readonly profileCompiler: ChannelProfileCompiler
    readonly loadActor: (projectId: string, subjectId: string) => ActorRow | null
    readonly loadChannel: (projectId: string, channelId: string) => PublicationChannelRow | null
    readonly loadProfile: (projectId: string, profileId: string) => ProfileRow | null
    readonly parseProfile: (value: string) => ChannelProfileDefinition
    readonly toProfileVersion: (row: ProfileRow) => ChannelProfileVersion
    readonly validateWorkingDraftMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string
    ) => readonly ValidationIssue[]
    readonly validatePinnedTargetMedia: (
        profile: ChannelProfileDefinition,
        content: unknown,
        projectId: string,
        subjectId: string,
        pinnedMedia: readonly TargetRevisionMediaRow[]
    ) => readonly ValidationIssue[]
    readonly updateWorkingDraftAssessment: (input: WorkingDraftAssessmentUpdate) => boolean
    readonly updatePublicationAssessment: (input: PublicationAssessmentUpdate) => boolean
    readonly loadActiveJob: (projectId: string, publicationId: string) => ActiveJob | null
    readonly cancelPendingJob: (projectId: string, jobId: string, completedAt: number) => boolean
    readonly ensureAutomaticJob: (input: AutomaticJobReconciliation) => void
    readonly insertAuditEvent: (input: AuditEventInput) => void
}

export function createChannelProfileStore(
    database: PostbotDatabase,
    options: ChannelProfileStoreOptions
) {
    const client = database.$client
    const profileReadStore = createChannelProfileReadStore(database, {
        loadActor: options.loadActor,
        loadChannel: options.loadChannel,
        loadProfile: options.loadProfile,
        parseProfile: options.parseProfile,
        toProfileVersion: options.toProfileVersion,
        validateWorkingDraftMedia: options.validateWorkingDraftMedia,
        validatePinnedTargetMedia: options.validatePinnedTargetMedia,
    })
    const loadDraftProfile = profileReadStore.loadDraftProfile
    const assessChannelProfileImpact = profileReadStore.assessChannelProfileImpact
    const insertProfileStatement = client.query<
        void,
        [
            id: string,
            projectId: string,
            channelId: string,
            profileId: string,
            version: number,
            origin: ChannelProfileDefinition['origin'],
            state: ChannelProfileVersionState,
            revision: number,
            profileJson: string,
            profileHash: string,
            schemaHash: string,
            actorId: string,
            now: number,
        ]
    >(`
        insert into channel_profile_versions (
            id,
            project_id,
            channel_id,
            profile_id,
            version,
            origin,
            state,
            revision,
            profile_json,
            profile_hash,
            schema_hash,
            created_by_actor_id,
            created_at,
            updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
    `)
    const updateProfileDraftStatement = client.query<
        { changes: number },
        [
            profileJson: string,
            profileHash: string,
            schemaHash: string,
            updatedAt: number,
            projectId: string,
            channelId: string,
            profileVersionId: string,
            expectedRevision: number,
        ]
    >(`
        update channel_profile_versions
        set profile_json = ?1,
            profile_hash = ?2,
            schema_hash = ?3,
            revision = revision + 1,
            updated_at = ?4
        where project_id = ?5
          and channel_id = ?6
          and id = ?7
          and state = 'draft'
          and revision = ?8
    `)
    const updateProfileStateStatement = client.query<
        { changes: number },
        [
            state: ChannelProfileVersionState,
            updatedAt: number,
            projectId: string,
            profileVersionId: string,
        ]
    >(`
        update channel_profile_versions
        set state = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
    `)
    const updateChannelProfileStatement = client.query<
        { changes: number },
        [
            profileVersionId: string,
            updatedAt: number,
            projectId: string,
            channelId: string,
            expectedProfileVersionId: string,
        ]
    >(`
        update channels
        set profile_version_id = ?1,
            updated_at = ?2
        where project_id = ?3
          and id = ?4
          and profile_version_id = ?5
    `)

    const createChannelProfileDraftTransaction = createDatabaseTransaction(
        database,
        (input: CreateChannelProfileDraftInput): ChannelProfileVersion | null => {
            const actor = options.loadActor(input.projectId, input.subjectId)
            const channelRow = options.loadChannel(input.projectId, input.channelId)
            if (actor === null || channelRow === null) return null
            if (channelRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot edit the profile of an ${channelRow.state} channel`
                )
            }

            const activeRow = options.loadProfile(input.projectId, channelRow.profileVersionId)
            if (activeRow === null || activeRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Channel ${input.channelId} has no active profile`
                )
            }

            const expectedRevision = normalizeOptionalProfileRevision(input.expectedRevision)
            const draftProfile = profileForDraft(input.profile, activeRow)
            const profileResult = options.profileCompiler.compile(draftProfile)
            if (!profileResult.ok) throw invalidProfileError(profileResult.issues)

            const profile = profileResult.value.profile
            const timestamp = requireTimestamp(options.now(), 'now')
            const existingDraft = loadDraftProfile(input.projectId, input.channelId)

            if (existingDraft !== null) {
                if (expectedRevision === undefined || expectedRevision !== existingDraft.revision) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Channel profile draft ${input.channelId} changed after revision ${expectedRevision ?? 'unknown'}`
                    )
                }

                const updated = updateProfileDraftStatement.run(
                    JSON.stringify(profile),
                    profile.profileHash,
                    profile.schemaHash,
                    timestamp,
                    input.projectId,
                    input.channelId,
                    existingDraft.id,
                    expectedRevision
                )
                if (updated.changes !== 1) {
                    throw new DomainInvariantError(
                        'write_conflict',
                        `Channel profile draft ${input.channelId} changed before it could be saved`
                    )
                }

                options.insertAuditEvent({
                    id: options.createId(),
                    projectId: input.projectId,
                    actorId: actor.id,
                    action: 'channel.profile_draft.updated',
                    entityType: 'channel_profile_version',
                    entityId: existingDraft.id,
                    metadataJson: JSON.stringify({
                        channelId: input.channelId,
                        profileId: profile.id,
                        version: profile.version,
                        revision: existingDraft.revision + 1,
                    }),
                    createdAt: timestamp,
                })

                const saved = options.loadProfile(input.projectId, existingDraft.id)
                if (saved === null)
                    throw new DomainInvariantError('invalid_input', 'Draft disappeared')
                return options.toProfileVersion(saved)
            }

            if (expectedRevision !== undefined && expectedRevision !== 0) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Channel profile ${input.channelId} has no draft at revision ${expectedRevision}`
                )
            }

            const profileVersionId = options.createId()
            insertProfileStatement.run(
                profileVersionId,
                input.projectId,
                input.channelId,
                profile.id,
                profile.version,
                profile.origin,
                'draft',
                1,
                JSON.stringify(profile),
                profile.profileHash,
                profile.schemaHash,
                actor.id,
                timestamp
            )
            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actor.id,
                action: 'channel.profile_draft.created',
                entityType: 'channel_profile_version',
                entityId: profileVersionId,
                metadataJson: JSON.stringify({
                    channelId: input.channelId,
                    profileId: profile.id,
                    version: profile.version,
                    revision: 1,
                }),
                createdAt: timestamp,
            })

            const created = options.loadProfile(input.projectId, profileVersionId)
            if (created === null)
                throw new DomainInvariantError('invalid_input', 'Draft disappeared')
            return options.toProfileVersion(created)
        }
    )

    const activateChannelProfileTransaction = createDatabaseTransaction(
        database,
        (input: ActivateChannelProfileInput): ChannelProfileActivationResult | null => {
            const actor = options.loadActor(input.projectId, input.subjectId)
            const channelRow = options.loadChannel(input.projectId, input.channelId)
            if (actor === null || channelRow === null) return null
            if (channelRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot activate a profile on an ${channelRow.state} channel`
                )
            }

            const { activeRow, draftRow } = assertActiveAndDraftProfiles(
                input,
                options.loadProfile(input.projectId, channelRow.profileVersionId),
                options.loadProfile(input.projectId, input.profileVersionId)
            )

            const expectedRevision = normalizeOptionalProfileRevision(input.expectedRevision)
            if (expectedRevision !== undefined && expectedRevision !== draftRow.revision) {
                throw new DomainInvariantError(
                    'write_conflict',
                    `Channel profile draft ${input.profileVersionId} changed after revision ${expectedRevision}`
                )
            }

            const impact = assessChannelProfileImpact(
                input.projectId,
                input.channelId,
                activeRow,
                draftRow,
                input.subjectId
            )
            const timestamp = requireTimestamp(options.now(), 'now')

            if (
                updateProfileStateStatement.run(
                    'superseded',
                    timestamp,
                    input.projectId,
                    activeRow.id
                ).changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not supersede profile ${activeRow.id}`
                )
            }
            if (
                updateProfileStateStatement.run('active', timestamp, input.projectId, draftRow.id)
                    .changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not activate profile ${draftRow.id}`
                )
            }
            if (
                updateChannelProfileStatement.run(
                    draftRow.id,
                    timestamp,
                    input.projectId,
                    input.channelId,
                    activeRow.id
                ).changes !== 1
            ) {
                throw new DomainInvariantError(
                    'claim_mismatch',
                    `Could not attach profile ${draftRow.id} to channel ${input.channelId}`
                )
            }

            for (const workingDraft of impact.workingDraftRows) {
                const assessed = impact.assessment.workingDrafts.find(
                    candidate => candidate.id === workingDraft.publicationId
                )
                if (assessed === undefined) continue
                if (
                    !options.updateWorkingDraftAssessment({
                        reviewState: assessed.state,
                        issuesJson: JSON.stringify(assessed.issues),
                        profileVersionId: draftRow.id,
                        updatedByActorId: actor.id,
                        updatedAt: timestamp,
                        projectId: input.projectId,
                        publicationId: workingDraft.publicationId,
                    })
                ) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not assess working draft ${workingDraft.publicationId}`
                    )
                }
            }

            for (const target of impact.targetRows) {
                const assessed = impact.assessment.pendingTargets.find(
                    candidate => candidate.id === target.publicationId
                )
                if (assessed === undefined) continue
                if (
                    !options.updatePublicationAssessment({
                        reviewState: assessed.state,
                        issuesJson: JSON.stringify(assessed.issues),
                        profileVersionId: draftRow.id,
                        updatedAt: timestamp,
                        actorId: actor.id,
                        projectId: input.projectId,
                        publicationId: target.publicationId,
                    })
                ) {
                    throw new DomainInvariantError(
                        'claim_mismatch',
                        `Could not assess publication ${target.publicationId}`
                    )
                }

                const activeJob = options.loadActiveJob(input.projectId, target.publicationId)
                if (assessed.state === 'review_required') {
                    if (
                        activeJob?.state === 'pending' &&
                        !options.cancelPendingJob(input.projectId, activeJob.id, timestamp)
                    ) {
                        throw new DomainInvariantError(
                            'claim_mismatch',
                            `Could not cancel job ${activeJob.id}`
                        )
                    }
                    continue
                }

                if (
                    activeJob === null &&
                    target.deliveryMode === 'automatic' &&
                    channelRow.publisherId !== null
                ) {
                    options.ensureAutomaticJob({
                        projectId: input.projectId,
                        publicationId: target.publicationId,
                        channel: channelRow,
                        timestamp,
                    })
                }
            }

            options.insertAuditEvent({
                id: options.createId(),
                projectId: input.projectId,
                actorId: actor.id,
                action: 'channel.profile_activated',
                entityType: 'channel',
                entityId: input.channelId,
                metadataJson: JSON.stringify({
                    previousProfileVersionId: activeRow.id,
                    profileVersionId: draftRow.id,
                    compatibleWorkingDraftIds: impact.assessment.workingDrafts
                        .filter(candidate => candidate.state === 'compatible')
                        .map(candidate => candidate.id),
                    reviewRequiredWorkingDraftIds: impact.assessment.workingDrafts
                        .filter(candidate => candidate.state === 'review_required')
                        .map(candidate => candidate.id),
                    compatibleTargetIds: impact.assessment.pendingTargets
                        .filter(candidate => candidate.state === 'compatible')
                        .map(candidate => candidate.id),
                    reviewRequiredTargetIds: impact.assessment.pendingTargets
                        .filter(candidate => candidate.state === 'review_required')
                        .map(candidate => candidate.id),
                }),
                createdAt: timestamp,
            })

            const updatedChannel = options.loadChannel(input.projectId, input.channelId)
            const updatedProfile = options.loadProfile(input.projectId, draftRow.id)
            if (updatedChannel === null || updatedProfile === null) {
                throw new DomainInvariantError('invalid_input', 'Activated profile disappeared')
            }

            return {
                channel: toChannel(updatedChannel),
                profile: options.toProfileVersion(updatedProfile),
                assessment: impact.assessment,
            }
        }
    )

    return {
        ...profileReadStore.api,

        createChannelProfileDraft(
            input: CreateChannelProfileDraftInput
        ): ChannelProfileVersion | null {
            return createChannelProfileDraftTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        activateChannelProfile(
            input: ActivateChannelProfileInput
        ): ChannelProfileActivationResult | null {
            return activateChannelProfileTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                channelId: requireNonBlank(input.channelId, 'channelId'),
                profileVersionId: requireNonBlank(input.profileVersionId, 'profileVersionId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}

function profileForDraft(
    profile: ChannelProfileDraftDefinition,
    activeRow: ProfileRow
): ChannelProfileDefinition {
    if (profile.id !== undefined && profile.id !== activeRow.profileId) {
        throw new DomainInvariantError(
            'invalid_input',
            `A channel profile draft cannot change profile identity from ${activeRow.profileId}`
        )
    }
    if (profile.origin !== undefined && profile.origin !== activeRow.origin) {
        throw new DomainInvariantError(
            'invalid_input',
            `A channel profile draft cannot change profile origin from ${activeRow.origin}`
        )
    }

    try {
        return fingerprintChannelProfile(
            {
                ...profile,
                id: activeRow.profileId,
                version: activeRow.version + 1,
                origin: activeRow.origin,
                profileHash: '',
                schemaHash: '',
            },
            value => `sha256:${createHash('sha256').update(value).digest('hex')}`
        )
    } catch {
        throw new DomainInvariantError(
            'invalid_content',
            'Channel profile must contain only JSON values'
        )
    }
}

function normalizeOptionalProfileRevision(value: number | undefined): number | undefined {
    if (value === undefined) return undefined
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new DomainInvariantError(
            'invalid_input',
            'Profile expectedRevision must be a non-negative safe integer'
        )
    }
    return value
}
