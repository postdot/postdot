import {
    createContext,
    useContext,
    useState,
    type Dispatch,
    type FormEvent,
    type ReactNode,
    type SetStateAction,
} from 'react'

import {
    api,
    type Channel,
    type ChannelCreationProfile,
    type CustomHttpAuthentication,
    type DuePublication,
    type LinkedInConnectionDestination,
    type Project,
    type PublisherConnection,
    type PublicationSummary,
    formatApiError,
} from '@/lib/api'
import {
    dateTimeLocalErrorMessage,
    parseDateTimeLocal,
    type DateTimeLocalError,
} from '@/lib/date-time'
import { createPublicationTarget, type PublicationTargetDraft } from '@/lib/publication-authoring'
import type { MediaSelection } from '@/lib/target-media'

export interface ProjectData {
    readonly channels: Channel[]
    readonly due: DuePublication[]
    readonly connections: PublisherConnection[]
    readonly publications: PublicationSummary[]
}

export async function loadProjectData(projectId: string): Promise<ProjectData> {
    const [channelResponse, dueResponse, publisherResponse, publicationResponse] =
        await Promise.all([
            api.listChannels(projectId),
            api.listDuePublications(projectId),
            api.listPublisherConnections(projectId),
            api.listPublications(projectId),
        ])

    return {
        channels: channelResponse.channels,
        due: dueResponse.publications,
        connections: publisherResponse.connections,
        publications: publicationResponse.publications,
    }
}

export interface DashboardGlobalContextValue {
    readonly error: string | null
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly onSignOut: () => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly session: {
        readonly user: {
            readonly id: string
            readonly name: string
            readonly email: string
        }
        readonly session: {
            readonly id: string
        }
    }
}

const DashboardGlobalContext = createContext<DashboardGlobalContextValue | null>(null)

export function DashboardGlobalProvider({
    children,
    value,
}: {
    readonly children: ReactNode
    readonly value: DashboardGlobalContextValue
}) {
    return (
        <DashboardGlobalContext.Provider value={value}>{children}</DashboardGlobalContext.Provider>
    )
}

export function useDashboardGlobal() {
    const context = useContext(DashboardGlobalContext)
    if (context === null)
        throw new Error('useDashboardGlobal must be used inside the dashboard route')
    return context
}

export interface ProjectDashboardContextValue extends ProjectData {
    readonly activeChannels: readonly Channel[]
    readonly error: string | null
    readonly onArchiveChannel: (channelId: string, expectedRevision: number) => Promise<boolean>
    readonly onConnectCustomHttpPublisher: (
        channelId: string,
        input: {
            endpointUrl: string
            authentication: CustomHttpAuthentication
            externalAccountName?: string | null
            secret: string
        }
    ) => Promise<boolean>
    readonly onCreateChannel: (name: string, profile: ChannelCreationProfile) => Promise<boolean>
    readonly onCreatePost: (event: FormEvent<HTMLFormElement>) => void
    readonly onDeleteChannel: (channelId: string, expectedRevision: number) => Promise<boolean>
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
    readonly onRefreshProject: () => Promise<void>
    readonly onRenameChannel: (
        channelId: string,
        name: string,
        expectedRevision: number
    ) => Promise<boolean>
    readonly onRestoreChannel: (channelId: string, expectedRevision: number) => Promise<boolean>
    readonly onPostContentChange: (value: string) => void
    readonly onPostTitleChange: (value: string) => void
    readonly onPublicationTargetsChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly onSourceMediaChange: (value: MediaSelection[]) => void
    readonly onStartLinkedInConnection: (
        channelId: string,
        destination?: LinkedInConnectionDestination
    ) => Promise<void>
    readonly onStartBlueskyConnection: (channelId: string, handle: string) => Promise<void>
    readonly onStartMastodonConnection: (channelId: string, instanceUrl: string) => Promise<void>
    readonly onPublish: (publicationId: string) => Promise<void>
    readonly pending: boolean
    readonly postContent: string
    readonly postTitle: string
    readonly project: Project
    readonly publicationTargets: readonly PublicationTargetDraft[]
    readonly sourceMedia: readonly MediaSelection[]
}

const ProjectDashboardContext = createContext<ProjectDashboardContextValue | null>(null)

export function ProjectDashboardProvider({
    children,
    initialData,
    project,
}: {
    readonly children: ReactNode
    readonly initialData: ProjectData
    readonly project: Project
}) {
    const [data, setData] = useState<ProjectData>(initialData)
    const [postTitle, setPostTitle] = useState('')
    const [postContent, setPostContent] = useState('')
    const [sourceMedia, setSourceMedia] = useState<MediaSelection[]>([])
    const [publicationTargets, setPublicationTargets] = useState<PublicationTargetDraft[]>(() => [
        createPublicationTarget(
            initialData.channels.find(channel => channel.state === 'active')?.id ?? '',
            project.timeZone
        ),
    ])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleCreateChannel(
        name: string,
        profile: ChannelCreationProfile
    ): Promise<boolean> {
        if (name.trim() === '') return false

        return runAction(async () => {
            const response = await api.createChannel(project.id, name.trim(), profile)
            setData(current => ({ ...current, channels: [...current.channels, response.channel] }))
            setPublicationTargets(current =>
                current.map((target, index) =>
                    index === 0 && target.channelId === ''
                        ? { ...target, channelId: response.channel.id }
                        : target
                )
            )
        })
    }

    async function handleCreatePost(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (postContent.trim() === '' && sourceMedia.length === 0) {
            setError('Add source text or at least one media attachment.')
            return
        }
        if (
            publicationTargets.length === 0 ||
            publicationTargets.some(target => target.channelId === '')
        ) {
            setError('Select a channel for each destination.')
            return
        }

        let scheduleError: DateTimeLocalError | null = null
        const publicationInputs = publicationTargets.map(target => {
            const scheduledTimestamp = parseDateTimeLocal(target.scheduledAt, project.timeZone)
            if (typeof scheduledTimestamp !== 'number') {
                if (typeof scheduledTimestamp === 'string') scheduleError = scheduledTimestamp
                return null
            }

            const selectedChannel = activeChannels.find(channel => channel.id === target.channelId)
            if (selectedChannel === undefined) return null

            const copy = target.content.trim()
            const targetContent =
                copy === ''
                    ? undefined
                    : selectedChannel.profileId === 'linkedin'
                      ? { commentary: copy, media: [...sourceMedia] }
                      : selectedChannel.profileId === 'bluesky' ||
                          selectedChannel.profileId === 'mastodon'
                        ? { text: copy, media: [...sourceMedia] }
                        : { body: copy, media: [...sourceMedia] }

            return {
                channelId: target.channelId,
                targetContent,
                deliveryMode: target.deliveryMode,
                scheduledAt: scheduledTimestamp,
            }
        })

        if (publicationInputs.some(input => input === null)) {
            setError(
                scheduleError === null
                    ? 'Choose a valid publication date and channel for each destination.'
                    : dateTimeLocalErrorMessage(scheduleError)
            )
            return
        }
        const validPublicationInputs = publicationInputs.filter(
            (input): input is NonNullable<typeof input> => input !== null
        )

        await runAction(async () => {
            await api.createPost(project.id, {
                title: postTitle.trim() === '' ? undefined : postTitle,
                sourceContent: {
                    ...(postContent.trim() === ''
                        ? {}
                        : { body: { text: postContent, format: 'plain_text' as const } }),
                    media: sourceMedia,
                },
                publications: validPublicationInputs,
            })
            setPostTitle('')
            setPostContent('')
            setSourceMedia([])
            setPublicationTargets([
                createPublicationTarget(activeChannels[0]?.id ?? '', project.timeZone),
            ])
            await refreshProject()
        })
    }

    async function handlePublish(publicationId: string) {
        await runAction(async () => {
            await api.publishManualPublication(project.id, publicationId)
            await refreshProject()
        })
    }

    async function handleStartLinkedInConnection(
        channelId: string,
        destination?: LinkedInConnectionDestination
    ) {
        await runAction(async () => {
            const { authorizationUrl } = await api.startLinkedInPublisherConnection(
                project.id,
                channelId,
                destination
            )
            window.location.assign(authorizationUrl)
        })
    }

    async function handleStartBlueskyConnection(channelId: string, handle: string) {
        await runAction(async () => {
            const { authorizationUrl } = await api.startBlueskyPublisherConnection(
                project.id,
                channelId,
                handle
            )
            window.location.assign(authorizationUrl)
        })
    }

    async function handleStartMastodonConnection(channelId: string, instanceUrl: string) {
        await runAction(async () => {
            const { authorizationUrl } = await api.startMastodonPublisherConnection(
                project.id,
                channelId,
                instanceUrl
            )
            window.location.assign(authorizationUrl)
        })
    }

    async function handleDisconnectPublisher(channelId: string) {
        await runAction(async () => {
            await api.disconnectPublisher(project.id, channelId)
            await refreshProject()
        })
    }

    async function handleConnectCustomHttpPublisher(
        channelId: string,
        input: {
            endpointUrl: string
            authentication: CustomHttpAuthentication
            externalAccountName?: string | null
            secret: string
        }
    ): Promise<boolean> {
        return runAction(async () => {
            await api.connectCustomHttpPublisher(project.id, channelId, input)
            await refreshProject()
        })
    }

    async function handleRenameChannel(
        channelId: string,
        name: string,
        expectedRevision: number
    ): Promise<boolean> {
        return runAction(async () => {
            const response = await api.renameChannel(
                project.id,
                channelId,
                name.trim(),
                expectedRevision
            )
            setData(current => ({
                ...current,
                channels: current.channels.map(channel =>
                    channel.id === response.channel.id ? response.channel : channel
                ),
            }))
        })
    }

    async function handleArchiveChannel(
        channelId: string,
        expectedRevision: number
    ): Promise<boolean> {
        return runAction(async () => {
            const response = await api.archiveChannel(project.id, channelId, expectedRevision)
            setData(current => ({
                ...current,
                channels: current.channels.map(channel =>
                    channel.id === response.channel.id ? response.channel : channel
                ),
            }))
            setPublicationTargets(current =>
                current.map(target =>
                    target.channelId === channelId ? { ...target, channelId: '' } : target
                )
            )
        })
    }

    async function handleRestoreChannel(
        channelId: string,
        expectedRevision: number
    ): Promise<boolean> {
        return runAction(async () => {
            const response = await api.restoreChannel(project.id, channelId, expectedRevision)
            setData(current => ({
                ...current,
                channels: current.channels.map(channel =>
                    channel.id === response.channel.id ? response.channel : channel
                ),
            }))
        })
    }

    async function handleDeleteChannel(
        channelId: string,
        expectedRevision: number
    ): Promise<boolean> {
        return runAction(async () => {
            await api.deleteChannel(project.id, channelId, expectedRevision)
            setData(current => ({
                ...current,
                channels: current.channels.filter(channel => channel.id !== channelId),
            }))
            setPublicationTargets(current =>
                current.map(target =>
                    target.channelId === channelId ? { ...target, channelId: '' } : target
                )
            )
            await refreshProject()
        })
    }

    async function refreshProject() {
        const nextData = await loadProjectData(project.id)
        setData(nextData)
        setPublicationTargets(current => {
            const nextActiveChannelId = nextData.channels.find(
                channel => channel.state === 'active'
            )?.id
            const repaired = current.map(target =>
                nextData.channels.some(
                    channel => channel.id === target.channelId && channel.state === 'active'
                )
                    ? target
                    : { ...target, channelId: nextActiveChannelId ?? '' }
            )
            return repaired.length === 0
                ? [createPublicationTarget(nextActiveChannelId ?? '', project.timeZone)]
                : repaired
        })
    }

    async function runAction(action: () => Promise<void>): Promise<boolean> {
        setError(null)
        setPending(true)
        try {
            await action()
            return true
        } catch (caughtError) {
            setError(formatApiError(caughtError))
            return false
        } finally {
            setPending(false)
        }
    }

    const activeChannels = data.channels.filter(channel => channel.state === 'active')

    const value: ProjectDashboardContextValue = {
        ...data,
        activeChannels,
        error,
        onArchiveChannel: handleArchiveChannel,
        onConnectCustomHttpPublisher: handleConnectCustomHttpPublisher,
        onCreateChannel: handleCreateChannel,
        onCreatePost: event => void handleCreatePost(event),
        onDeleteChannel: handleDeleteChannel,
        onDisconnectPublisher: handleDisconnectPublisher,
        onRefreshProject: refreshProject,
        onRenameChannel: handleRenameChannel,
        onRestoreChannel: handleRestoreChannel,
        onPostContentChange: setPostContent,
        onPostTitleChange: setPostTitle,
        onPublicationTargetsChange: setPublicationTargets,
        onSourceMediaChange: setSourceMedia,
        onStartLinkedInConnection: handleStartLinkedInConnection,
        onStartBlueskyConnection: handleStartBlueskyConnection,
        onStartMastodonConnection: handleStartMastodonConnection,
        onPublish: handlePublish,
        pending,
        postContent,
        postTitle,
        project,
        publicationTargets,
        sourceMedia,
    }

    return (
        <ProjectDashboardContext.Provider value={value}>
            {children}
        </ProjectDashboardContext.Provider>
    )
}

export function useProjectDashboard() {
    const context = useContext(ProjectDashboardContext)
    if (context === null) {
        throw new Error('useProjectDashboard must be used inside a project dashboard route')
    }
    return context
}
