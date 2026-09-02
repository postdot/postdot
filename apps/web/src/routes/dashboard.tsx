import {
    createFileRoute,
    Outlet,
    redirect,
    useNavigate,
    useRouterState,
} from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'

import { DashboardShell } from '@/components/dashboard-shell'
import { DashboardWorkspace } from '@/components/dashboard-workspace'
import type { MediaSelection } from '@/components/media-attachment-picker'
import {
    ApiError,
    api,
    type Channel,
    type DuePublication,
    type Project,
    type PublisherConnection,
    type PublicationSummary,
} from '@/lib/api'
import { parseDateTimeLocal, toDateTimeLocal } from '@/lib/date-time'

interface ProjectData {
    readonly channels: Channel[]
    readonly due: DuePublication[]
    readonly connections: PublisherConnection[]
    readonly publications: PublicationSummary[]
}

async function loadProjectData(projectId: string): Promise<ProjectData> {
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

export const Route = createFileRoute('/dashboard')({
    loader: async () => {
        const session = await api.getSession()
        if (session === null) {
            throw redirect({ to: '/login' })
        }

        const { projects } = await api.listProjects()
        const data =
            projects[0] === undefined
                ? { channels: [], connections: [], due: [], publications: [] }
                : await loadProjectData(projects[0].id)
        return { session, projects, ...data }
    },
    component: DashboardPage,
})

function DashboardPage() {
    const isPublicationEditor = useRouterState({
        select: state =>
            state.matches[state.matches.length - 1]?.routeId ===
            '/dashboard/projects/$projectId/publications/$publicationId',
    })

    const navigate = useNavigate()
    const initialData = Route.useLoaderData()
    const [projects, setProjects] = useState<Project[]>(initialData.projects)
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        initialData.projects[0]?.id ?? null
    )
    const [channels, setChannels] = useState<Channel[]>(initialData.channels)
    const [duePublications, setDuePublications] = useState<DuePublication[]>(initialData.due)
    const [publisherConnections, setPublisherConnections] = useState<PublisherConnection[]>(
        initialData.connections
    )
    const [publications, setPublications] = useState<PublicationSummary[]>(initialData.publications)
    const [projectName, setProjectName] = useState('')
    const [channelName, setChannelName] = useState('')
    const [channelProfile, setChannelProfile] = useState<'manual-message' | 'linkedin'>(
        'manual-message'
    )
    const [postTitle, setPostTitle] = useState('')
    const [postContent, setPostContent] = useState('')
    const [publicationContent, setPublicationContent] = useState('')
    const [sourceMedia, setSourceMedia] = useState<MediaSelection[]>([])
    const [publicationChannelId, setPublicationChannelId] = useState('')
    const [deliveryMode, setDeliveryMode] = useState<'manual' | 'automatic'>('manual')
    const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null

    useEffect(() => {
        if (selectedProjectId === null) {
            setChannels([])
            setDuePublications([])
            setPublisherConnections([])
            setPublications([])
            setPublicationChannelId('')
            setSourceMedia([])
            return
        }

        setSourceMedia([])
        let active = true
        loadProjectData(selectedProjectId)
            .then(data => {
                if (!active) return
                setChannels(data.channels)
                setDuePublications(data.due)
                setPublisherConnections(data.connections)
                setPublications(data.publications)
                setPublicationChannelId(current => current || data.channels[0]?.id || '')
            })
            .catch(caughtError => {
                if (active) setError(errorMessage(caughtError))
            })

        return () => {
            active = false
        }
    }, [selectedProjectId])

    async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (projectName.trim() === '') return
        await runAction(async () => {
            const response = await api.createProject(projectName)
            setProjects(current => [...current, response.project])
            setSelectedProjectId(response.project.id)
            setProjectName('')
        })
    }

    async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (selectedProjectId === null || channelName.trim() === '') return
        await runAction(async () => {
            const response = await api.createChannel(selectedProjectId, channelName, channelProfile)
            setChannels(current => [...current, response.channel])
            setPublicationChannelId(current => current || response.channel.id)
            setChannelName('')
            setChannelProfile('manual-message')
        })
    }

    async function handleCreatePost(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (selectedProjectId === null || publicationChannelId === '') return
        if (postContent.trim() === '' && sourceMedia.length === 0) {
            setError('Add source text or at least one media attachment.')
            return
        }
        const scheduledTimestamp = parseDateTimeLocal(scheduledAt)
        if (scheduledTimestamp === null || scheduledTimestamp === 'invalid') {
            setError('Choose a valid publication date.')
            return
        }

        const selectedChannel = channels.find(channel => channel.id === publicationChannelId)
        if (selectedChannel === undefined) return
        const copy = publicationContent.trim()
        const targetContent =
            copy === ''
                ? undefined
                : selectedChannel.profileId === 'linkedin'
                  ? { commentary: copy, media: sourceMedia }
                  : { body: copy, media: sourceMedia }

        await runAction(async () => {
            await api.createPost(selectedProjectId, {
                title: postTitle.trim() === '' ? undefined : postTitle,
                sourceContent: {
                    ...(postContent.trim() === ''
                        ? {}
                        : { body: { text: postContent, format: 'plain_text' as const } }),
                    media: sourceMedia,
                },
                publications: [
                    {
                        channelId: publicationChannelId,
                        targetContent,
                        deliveryMode,
                        scheduledAt: scheduledTimestamp,
                    },
                ],
            })
            setPostTitle('')
            setPostContent('')
            setPublicationContent('')
            setSourceMedia([])
            await refreshSelectedProject()
        })
    }

    async function handlePublish(publicationId: string) {
        if (selectedProjectId === null) return
        await runAction(async () => {
            await api.publishManualPublication(selectedProjectId, publicationId)
            await refreshSelectedProject()
        })
    }

    async function handleStartLinkedInConnection(channelId: string) {
        if (selectedProjectId === null) return
        await runAction(async () => {
            const { authorizationUrl } = await api.startLinkedInPublisherConnection(
                selectedProjectId,
                channelId
            )
            window.location.assign(authorizationUrl)
        })
    }

    async function handleDisconnectPublisher(channelId: string) {
        if (selectedProjectId === null) return
        await runAction(async () => {
            await api.disconnectPublisher(selectedProjectId, channelId)
            await refreshSelectedProject()
        })
    }

    async function handleSignOut() {
        await runAction(async () => {
            await api.signOut()
            await navigate({ to: '/login' })
        })
    }

    async function refreshSelectedProject() {
        if (selectedProjectId === null) return
        const data = await loadProjectData(selectedProjectId)
        setChannels(data.channels)
        setDuePublications(data.due)
        setPublisherConnections(data.connections)
        setPublications(data.publications)
        setPublicationChannelId(current => current || data.channels[0]?.id || '')
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

    return (
        <DashboardShell
            channels={channels}
            dueCount={duePublications.length}
            onCreateProject={handleCreateProject}
            onProjectChange={projectId => setSelectedProjectId(projectId)}
            onProjectNameChange={setProjectName}
            onSignOut={() => void handleSignOut()}
            pending={pending}
            projectName={projectName}
            projects={projects}
            publisherConnections={publisherConnections}
            selectedProjectId={selectedProjectId}
            session={initialData.session}
            publicationsCount={publications.length}>
            {isPublicationEditor ? (
                <Outlet />
            ) : (
                <DashboardWorkspace
                    channelName={channelName}
                    channelProfile={channelProfile}
                    channels={channels}
                    connections={publisherConnections}
                    deliveryMode={deliveryMode}
                    duePublications={duePublications}
                    error={error}
                    onChannelNameChange={setChannelName}
                    onChannelProfileChange={setChannelProfile}
                    onCreateChannel={handleCreateChannel}
                    onCreatePost={handleCreatePost}
                    onDisconnectPublisher={handleDisconnectPublisher}
                    onPostContentChange={setPostContent}
                    onPostTitleChange={setPostTitle}
                    onPublicationChannelChange={setPublicationChannelId}
                    onPublicationContentChange={setPublicationContent}
                    onDeliveryModeChange={setDeliveryMode}
                    onScheduledAtChange={setScheduledAt}
                    onSourceMediaChange={setSourceMedia}
                    onStartLinkedInConnection={handleStartLinkedInConnection}
                    onPublish={handlePublish}
                    pending={pending}
                    postContent={postContent}
                    postTitle={postTitle}
                    project={selectedProject}
                    publicationChannelId={publicationChannelId}
                    publicationContent={publicationContent}
                    publications={publications}
                    scheduledAt={scheduledAt}
                    sourceMedia={sourceMedia}
                />
            )}
        </DashboardShell>
    )
}

function defaultScheduleValue() {
    return toDateTimeLocal(Date.now() + 60 * 60 * 1000)
}

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The action could not be completed'
}
