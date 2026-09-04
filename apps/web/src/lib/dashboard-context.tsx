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
    ApiError,
    api,
    type Channel,
    type DuePublication,
    type LinkedInConnectionDestination,
    type Project,
    type PublisherConnection,
    type PublicationSummary,
} from '@/lib/api'
import {
    dateTimeLocalErrorMessage,
    parseDateTimeLocal,
    type DateTimeLocalError,
} from '@/lib/date-time'
import { createPublicationTarget, type PublicationTargetDraft } from '@/lib/publication-authoring'
import type { MediaSelection } from '@/lib/target-media'

export type ChannelProfile = 'manual-message' | 'linkedin'

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
    readonly channelName: string
    readonly channelProfile: ChannelProfile
    readonly error: string | null
    readonly onChannelNameChange: (value: string) => void
    readonly onChannelProfileChange: (value: ChannelProfile) => void
    readonly onCreateChannel: (event: FormEvent<HTMLFormElement>) => void
    readonly onCreatePost: (event: FormEvent<HTMLFormElement>) => void
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
    readonly onPostContentChange: (value: string) => void
    readonly onPostTitleChange: (value: string) => void
    readonly onPublicationTargetsChange: Dispatch<SetStateAction<PublicationTargetDraft[]>>
    readonly onSourceMediaChange: (value: MediaSelection[]) => void
    readonly onStartLinkedInConnection: (
        channelId: string,
        destination?: LinkedInConnectionDestination
    ) => Promise<void>
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
    const [channelName, setChannelName] = useState('')
    const [channelProfile, setChannelProfile] = useState<ChannelProfile>('manual-message')
    const [postTitle, setPostTitle] = useState('')
    const [postContent, setPostContent] = useState('')
    const [sourceMedia, setSourceMedia] = useState<MediaSelection[]>([])
    const [publicationTargets, setPublicationTargets] = useState<PublicationTargetDraft[]>(() => [
        createPublicationTarget(initialData.channels[0]?.id ?? '', project.timeZone),
    ])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (channelName.trim() === '') return

        await runAction(async () => {
            const response = await api.createChannel(project.id, channelName, channelProfile)
            setData(current => ({ ...current, channels: [...current.channels, response.channel] }))
            setPublicationTargets(current =>
                current.map((target, index) =>
                    index === 0 && target.channelId === ''
                        ? { ...target, channelId: response.channel.id }
                        : target
                )
            )
            setChannelName('')
            setChannelProfile('manual-message')
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

            const selectedChannel = data.channels.find(channel => channel.id === target.channelId)
            if (selectedChannel === undefined) return null

            const copy = target.content.trim()
            const targetContent =
                copy === ''
                    ? undefined
                    : selectedChannel.profileId === 'linkedin'
                      ? { commentary: copy, media: [...sourceMedia] }
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
                createPublicationTarget(data.channels[0]?.id ?? '', project.timeZone),
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

    async function handleDisconnectPublisher(channelId: string) {
        await runAction(async () => {
            await api.disconnectPublisher(project.id, channelId)
            await refreshProject()
        })
    }

    async function refreshProject() {
        const nextData = await loadProjectData(project.id)
        setData(nextData)
        setPublicationTargets(current =>
            current.length === 0
                ? [createPublicationTarget(nextData.channels[0]?.id ?? '', project.timeZone)]
                : current
        )
    }

    async function runAction(action: () => Promise<void>) {
        setError(null)
        setPending(true)
        try {
            await action()
        } catch (caughtError) {
            setError(errorMessage(caughtError))
        } finally {
            setPending(false)
        }
    }

    const value: ProjectDashboardContextValue = {
        ...data,
        channelName,
        channelProfile,
        error,
        onChannelNameChange: setChannelName,
        onChannelProfileChange: setChannelProfile,
        onCreateChannel: event => void handleCreateChannel(event),
        onCreatePost: event => void handleCreatePost(event),
        onDisconnectPublisher: handleDisconnectPublisher,
        onPostContentChange: setPostContent,
        onPostTitleChange: setPostTitle,
        onPublicationTargetsChange: setPublicationTargets,
        onSourceMediaChange: setSourceMedia,
        onStartLinkedInConnection: handleStartLinkedInConnection,
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

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The action could not be completed'
}
