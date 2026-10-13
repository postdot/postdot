import {
    DomainInvariantError,
    requireNonBlank,
    type ChannelProfileDefinition,
    type ChannelProfileImpactAssessment,
    type ValidationIssue,
} from '@postbot/core'

import type { PostbotDatabase } from '../client'
import type {
    ChannelProfileState,
    ChannelProfileVersion,
    PreviewChannelProfileActivationInput,
} from '../manual-store'
import {
    createChannelProfileImpactAssessor,
    type ChannelProfileImpactResult,
} from './channel-profile-impact'
import { toChannel } from './project-channel-mappers'
import type { ActorRow, ProfileRow, PublicationChannelRow, TargetRevisionMediaRow } from './rows'

export interface ChannelProfileReadStoreOptions {
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
}

export interface ChannelProfileReadStoreApi {
    readonly getChannelProfileState: (
        projectId: string,
        channelId: string,
        subjectId: string
    ) => ChannelProfileState | null
    readonly previewChannelProfileActivation: (
        input: PreviewChannelProfileActivationInput
    ) => ChannelProfileImpactAssessment | null
}

export interface ChannelProfileReadStoreHandle {
    readonly api: ChannelProfileReadStoreApi
    readonly loadDraftProfile: (projectId: string, channelId: string) => ProfileRow | null
    readonly assessChannelProfileImpact: (
        projectId: string,
        channelId: string,
        currentProfileRow: ProfileRow,
        proposedProfileRow: ProfileRow,
        subjectId: string
    ) => ChannelProfileImpactResult
}

export function createChannelProfileReadStore(
    database: PostbotDatabase,
    options: ChannelProfileReadStoreOptions
): ChannelProfileReadStoreHandle {
    const loadDraftProfileStatement = database.$client.query<
        ProfileRow,
        [projectId: string, channelId: string]
    >(`
        select id,
               project_id as projectId,
               channel_id as channelId,
               profile_id as profileId,
               version,
               origin,
               state,
               revision,
               profile_json as profileJson,
               profile_hash as profileHash,
               schema_hash as schemaHash,
               created_by_actor_id as createdByActorId,
               created_at as createdAt,
               updated_at as updatedAt
        from channel_profile_versions
        where project_id = ?1
          and channel_id = ?2
          and state = 'draft'
    `)
    const loadDraftProfile = (projectId: string, channelId: string) =>
        loadDraftProfileStatement.get(projectId, channelId)
    const assessChannelProfileImpact = createChannelProfileImpactAssessor(database, {
        parseProfile: options.parseProfile,
        validateWorkingDraftMedia: options.validateWorkingDraftMedia,
        validatePinnedTargetMedia: options.validatePinnedTargetMedia,
    })

    const api: ChannelProfileReadStoreApi = {
        getChannelProfileState(
            projectId: string,
            channelId: string,
            subjectId: string
        ): ChannelProfileState | null {
            const normalizedProjectId = requireNonBlank(projectId, 'projectId')
            const normalizedChannelId = requireNonBlank(channelId, 'channelId')
            const normalizedSubjectId = requireNonBlank(subjectId, 'subjectId')
            if (options.loadActor(normalizedProjectId, normalizedSubjectId) === null) return null

            const channelRow = options.loadChannel(normalizedProjectId, normalizedChannelId)
            if (channelRow === null) return null

            const activeRow = options.loadProfile(normalizedProjectId, channelRow.profileVersionId)
            if (activeRow === null || activeRow.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_input',
                    `Channel ${normalizedChannelId} has no active profile`
                )
            }

            const draftRow = loadDraftProfile(normalizedProjectId, normalizedChannelId)
            return {
                channel: toChannel(channelRow),
                active: options.toProfileVersion(activeRow),
                draft: draftRow === null ? null : options.toProfileVersion(draftRow),
            }
        },

        previewChannelProfileActivation(
            input: PreviewChannelProfileActivationInput
        ): ChannelProfileImpactAssessment | null {
            const normalizedProjectId = requireNonBlank(input.projectId, 'projectId')
            const normalizedChannelId = requireNonBlank(input.channelId, 'channelId')
            const normalizedProfileVersionId = requireNonBlank(
                input.profileVersionId,
                'profileVersionId'
            )
            const normalizedSubjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = options.loadActor(normalizedProjectId, normalizedSubjectId)
            const channelRow = options.loadChannel(normalizedProjectId, normalizedChannelId)
            if (actor === null || channelRow === null) return null

            const loadedActiveRow = options.loadProfile(
                normalizedProjectId,
                channelRow.profileVersionId
            )
            const loadedDraftRow = options.loadProfile(
                normalizedProjectId,
                normalizedProfileVersionId
            )
            const { activeRow, draftRow } = assertActiveAndDraftProfiles(
                {
                    ...input,
                    projectId: normalizedProjectId,
                    channelId: normalizedChannelId,
                    profileVersionId: normalizedProfileVersionId,
                    subjectId: normalizedSubjectId,
                },
                loadedActiveRow,
                loadedDraftRow
            )

            return assessChannelProfileImpact(
                normalizedProjectId,
                normalizedChannelId,
                activeRow,
                draftRow,
                normalizedSubjectId
            ).assessment
        },
    }

    return { api, loadDraftProfile, assessChannelProfileImpact }
}

export function assertActiveAndDraftProfiles(
    input: PreviewChannelProfileActivationInput,
    activeRow: ProfileRow | null,
    draftRow: ProfileRow | null
): {
    readonly activeRow: ProfileRow & { readonly state: 'active' }
    readonly draftRow: ProfileRow & { readonly state: 'draft' }
} {
    if (activeRow === null || activeRow.state !== 'active') {
        throw new DomainInvariantError(
            'invalid_input',
            `Channel ${input.channelId} has no active profile`
        )
    }
    if (draftRow === null || draftRow.channelId !== input.channelId || draftRow.state !== 'draft') {
        throw new DomainInvariantError(
            'invalid_input',
            `Profile ${input.profileVersionId} is not a draft for channel ${input.channelId}`
        )
    }

    return {
        activeRow: activeRow as ProfileRow & { readonly state: 'active' },
        draftRow: draftRow as ProfileRow & { readonly state: 'draft' },
    }
}
