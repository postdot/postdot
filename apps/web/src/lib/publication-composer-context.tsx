import { adaptSourceContentToProfile } from '@postdot/core'
import { toast } from '@postdot/ui/components/toast'
import { useQueryClient } from '@tanstack/react-query'
import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    type Context,
    type FormEvent,
    type ReactNode,
} from 'react'

import { api, type Publication } from '@/lib/api'
import { useDashboardGlobal, useProjectDashboard } from '@/lib/dashboard-context'
import {
    dateTimeLocalErrorMessage,
    parseDateTimeLocal,
    type DateTimeLocalError,
} from '@/lib/date-time'
import { useProjectAction } from '@/lib/project-action'
import { useProjectChannelActions } from '@/lib/project-channel-actions'
import { refreshPublicationResources } from '@/lib/project-resources'
import { useProjectTagActions } from '@/lib/project-tags'
import { createPublicationTarget, type PublicationTargetDraft } from '@/lib/publication-authoring'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

export type PublicationCreationMode = 'draft' | 'schedule'

function useComposerSession() {
    const { project, channels, activeChannels } = useProjectDashboard()
    const userId = useDashboardGlobal().session.user.id
    const queryClient = useQueryClient()
    const { error, pending, setError, runAction } = useProjectAction()
    const tagActions = useProjectTagActions(project.id)
    const [postTitle, setPostTitle] = useState('')
    const [postContent, setPostContent] = useState('')
    const [sourceMedia, setSourceMedia] = useState<MediaSelection[]>([])
    const [publicationTargets, setPublicationTargets] = useState<PublicationTargetDraft[]>(() => [
        createPublicationTarget(activeChannels[0]?.id ?? '', project.timeZone),
    ])
    const [publicationTagIds, setPublicationTagIds] = useState<string[]>([])
    const channelActions = useProjectChannelActions(channelId => {
        setPublicationTargets(current =>
            current.map((target, index) =>
                index === 0 && target.channelId === '' ? { ...target, channelId } : target
            )
        )
    })
    const previousChannels = useRef(channels)
    useEffect(() => {
        if (previousChannels.current === channels) return
        previousChannels.current = channels
        const nextActiveChannelId = channels.find(channel => channel.state === 'active')?.id ?? ''
        setPublicationTargets(current => {
            const repaired = current.map(target => {
                const channel = channels.find(candidate => candidate.id === target.channelId)
                if (target.channelId === '' || channel?.state === 'active') return target
                return {
                    ...target,
                    channelId: channel?.state === 'archived' ? '' : nextActiveChannelId,
                }
            })
            return repaired.length === 0
                ? [createPublicationTarget(nextActiveChannelId, project.timeZone)]
                : repaired
        })
    }, [channels, project.timeZone])
    const refreshProject = () => refreshPublicationResources(queryClient, project.id)
    async function handleCreatePost(
        event: FormEvent<HTMLFormElement>,
        mode: PublicationCreationMode = 'schedule',
        onFailure?: (error: unknown) => void
    ): Promise<Publication[] | null> {
        event.preventDefault()
        const hasSharedText = postContent.trim() !== ''
        if (
            !hasSharedText &&
            sourceMedia.length === 0 &&
            (publicationTargets.length === 0 ||
                publicationTargets.some(target => target.content.trim() === ''))
        ) {
            setError(m.publication_new_source_required())
            return null
        }
        // A channel-only draft still needs a source body in the persistence contract.
        // Every text-only destination has its own explicit content in this case.
        const sourceBody = hasSharedText
            ? postContent
            : sourceMedia.length > 0
              ? ''
              : (publicationTargets[0]?.content ?? '')
        if (
            publicationTargets.length === 0 ||
            publicationTargets.some(target => target.channelId === '')
        ) {
            setError(m.publication_new_channel_required())
            return null
        }
        if (
            new Set(publicationTargets.map(target => target.channelId)).size !==
            publicationTargets.length
        ) {
            setError(m.publication_new_duplicate_channel())
            return null
        }

        let scheduleError: DateTimeLocalError | null = null
        const publicationInputs = publicationTargets.map(target => {
            let scheduledTimestamp: number | null = null
            if (mode === 'schedule') {
                const parsedSchedule = parseDateTimeLocal(target.scheduledAt, project.timeZone)
                if (typeof parsedSchedule !== 'number') {
                    if (typeof parsedSchedule === 'string') scheduleError = parsedSchedule
                    return null
                }
                if (parsedSchedule < Date.now()) {
                    scheduleError = 'past'
                    return null
                }
                scheduledTimestamp = parsedSchedule
            }

            const selectedChannel = activeChannels.find(channel => channel.id === target.channelId)
            if (selectedChannel === undefined) return null

            return {
                channelId: target.channelId,
                deliveryMode: target.deliveryMode,
                scheduledAt: scheduledTimestamp,
            }
        })

        if (publicationInputs.some(input => input === null)) {
            setError(
                scheduleError === null
                    ? m.publication_new_invalid_destination()
                    : dateTimeLocalErrorMessage(scheduleError)
            )
            return null
        }
        const validPublicationInputs = publicationInputs.filter(
            (input): input is NonNullable<typeof input> => input !== null
        )

        let createdPublications: Publication[] | null = null
        const succeeded = await runAction(async () => {
            try {
                // Read at submission, not from a potentially stale profile cache.
                // Unmodified destinations retain server-owned source projection.
                const publications = await Promise.all(
                    validPublicationInputs.map(async input => {
                        const target = publicationTargets.find(
                            item => item.channelId === input.channelId
                        )!
                        const channel = activeChannels.find(item => item.id === input.channelId)!
                        const copy = target.content.trim()
                        // Preserve the existing article override, including title-only drafts.
                        const preserveEmptyHeadline =
                            providerRegistry.forExecution(channel.execution)?.authoring
                                ?.preserveEmptyHeadline === true
                        if (copy === '' && !preserveEmptyHeadline) return input
                        const { active } = await api.getChannelProfileState(
                            project.id,
                            input.channelId
                        )
                        return {
                            ...input,
                            targetContent: adaptSourceContentToProfile(
                                {
                                    ...(postTitle.trim() === '' && !preserveEmptyHeadline
                                        ? {}
                                        : { headline: postTitle.trim() }),
                                    body: {
                                        text: copy === '' ? postContent : copy,
                                        format: 'plain_text',
                                    },
                                    media: sourceMedia,
                                },
                                active.profile
                            ),
                        }
                    })
                )
                const response = await api.createPost(project.id, {
                    expectedUserId: userId,
                    title: postTitle.trim() === '' ? undefined : postTitle,
                    sourceContent: {
                        ...(postTitle.trim() === '' ? {} : { headline: postTitle.trim() }),
                        ...(sourceBody.trim() === ''
                            ? {}
                            : { body: { text: sourceBody, format: 'plain_text' as const } }),
                        media: sourceMedia,
                    },
                    publications,
                })
                createdPublications = response.publications
                let tagAssignmentError: unknown = null
                if (publicationTagIds.length > 0) {
                    try {
                        await Promise.all(
                            response.publications.map(publication =>
                                api.replacePublicationTags(
                                    project.id,
                                    publication.id,
                                    publicationTagIds
                                )
                            )
                        )
                    } catch (caughtError) {
                        tagAssignmentError = caughtError
                    }
                }
                setPostTitle('')
                setPostContent('')
                setSourceMedia([])
                setPublicationTagIds([])
                setPublicationTargets([
                    createPublicationTarget(activeChannels[0]?.id ?? '', project.timeZone),
                ])
                await refreshProject()
                if (tagAssignmentError !== null) {
                    toast.add({ title: m.taxonomy_assignment_failed(), type: 'warning' })
                }
            } catch (error) {
                onFailure?.(error)
                throw error
            }
        })
        return succeeded ? createdPublications : null
    }

    return {
        postTitle,
        postContent,
        sourceMedia,
        publicationTargets,
        publicationTagIds,
        onPostTitleChange: setPostTitle,
        onPostContentChange: setPostContent,
        onSourceMediaChange: setSourceMedia,
        onPublicationTargetsChange: setPublicationTargets,
        onPublicationTagIdsChange: setPublicationTagIds,
        onCreatePost: handleCreatePost,
        onCreateChannel: channelActions.onCreateChannel,
        onCreateProjectTag: tagActions.onCreateProjectTag,
        error: error ?? channelActions.error,
        pending: pending || channelActions.pending,
    }
}

type ComposerSession = ReturnType<typeof useComposerSession>
const PublicationComposerContext =
    (import.meta.hot?.data.publicationComposerContext as
        | Context<ComposerSession | null>
        | undefined) ?? createContext<ComposerSession | null>(null)
if (import.meta.hot) import.meta.hot.data.publicationComposerContext = PublicationComposerContext

/** Preserve the draft across channel setup navigation without putting it in dashboard data. */
export function PublicationComposerProvider({ children }: { readonly children: ReactNode }) {
    const session = useComposerSession()
    return (
        <PublicationComposerContext.Provider value={session}>
            {children}
        </PublicationComposerContext.Provider>
    )
}

export function usePublicationComposer() {
    const session = useContext(PublicationComposerContext)
    if (session === null) throw new Error('Composition requires a publication composer session')
    return session
}
