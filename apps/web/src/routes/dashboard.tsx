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
import { parseDateTimeLocal } from '@/lib/date-time'
import { createPublicationTarget, type PublicationTargetDraft } from '@/lib/publication-authoring'

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
    const [sourceMedia, setSourceMedia] = useState<MediaSelection[]>([])
    const [publicationTargets, setPublicationTargets] = useState<PublicationTargetDraft[]>(() => [
        createPublicationTarget(initialData.channels[0]?.id ?? ''),
    ])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null

    useEffect(() => {
        if (selectedProjectId === null) {
            setChannels([])
            setDuePublications([])
            setPublisherConnections([])
            setPublications([])
            setPublicationTargets([createPublicationTarget()])
            setSourceMedia([])
            return
        }

        setSourceMedia([])
        setPublicationTargets([createPublicationTarget()])
        let active = true
        loadProjectData(selectedProjectId)
            .then(data => {
                if (!active) return
                setChannels(data.channels)
                setDuePublications(data.due)
                setPublisherConnections(data.connections)
                setPublications(data.publications)
                setPublicationTargets([createPublicationTarget(data.channels[0]?.id ?? '')])
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
        if (selectedProjectId === null) return
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

        const publicationInputs = publicationTargets.map(target => {
            const scheduledTimestamp = parseDateTimeLocal(target.scheduledAt)
            if (scheduledTimestamp === null || scheduledTimestamp === 'invalid') return null

            const selectedChannel = channels.find(channel => channel.id === target.channelId)
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
            setError('Choose a valid publication date and channel for each destination.')
            return
        }
        const validPublicationInputs = publicationInputs.filter(
            (input): input is NonNullable<typeof input> => input !== null
        )

        await runAction(async () => {
            await api.createPost(selectedProjectId, {
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
            setPublicationTargets([createPublicationTarget(channels[0]?.id ?? '')])
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
        setPublicationTargets(current =>
            current.length === 0 ? [createPublicationTarget(data.channels[0]?.id ?? '')] : current
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
                    duePublications={duePublications}
                    error={error}
                    onChannelNameChange={setChannelName}
                    onChannelProfileChange={setChannelProfile}
                    onCreateChannel={handleCreateChannel}
                    onCreatePost={handleCreatePost}
                    onDisconnectPublisher={handleDisconnectPublisher}
                    onPostContentChange={setPostContent}
                    onPostTitleChange={setPostTitle}
                    onPublicationTargetsChange={setPublicationTargets}
                    onSourceMediaChange={setSourceMedia}
                    onStartLinkedInConnection={handleStartLinkedInConnection}
                    onPublish={handlePublish}
                    pending={pending}
                    postContent={postContent}
                    postTitle={postTitle}
                    project={selectedProject}
                    publicationTargets={publicationTargets}
                    publications={publications}
                    sourceMedia={sourceMedia}
                />
            )}
        </DashboardShell>
    )
}

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The action could not be completed'
}
