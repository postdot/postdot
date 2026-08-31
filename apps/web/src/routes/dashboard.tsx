import { AddCircleIcon } from '@solar-icons/react/linear/add-circle'
import { CalendarIcon } from '@solar-icons/react/linear/calendar'
import { CheckCircleIcon } from '@solar-icons/react/linear/check-circle'
import { ClipboardTextIcon } from '@solar-icons/react/linear/clipboard-text'
import { LogoutIcon } from '@solar-icons/react/linear/logout'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'

import { PublisherConnectionPanel } from '@/components/publisher-connection-panel'
import { Button } from '@/components/ui/button'
import {
    ApiError,
    api,
    type Channel,
    type DuePublication,
    type Project,
    type PublisherConnection,
    type PublicationSummary,
} from '@/lib/api'

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
            return
        }

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
        const scheduledTimestamp = Date.parse(scheduledAt)
        if (!Number.isFinite(scheduledTimestamp)) {
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
                  ? { commentary: copy }
                  : { body: copy, media: [] }

        await runAction(async () => {
            await api.createPost(selectedProjectId, {
                title: postTitle.trim() === '' ? undefined : postTitle,
                sourceContent: {
                    body: { text: postContent, format: 'plain_text' },
                    media: [],
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
        <section className="py-10 pb-20 sm:py-14">
            <div className="flex flex-col justify-between gap-6 border-b pb-8 sm:flex-row sm:items-end">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                        Operator dashboard
                    </p>
                    <h1 className="mt-3 text-4xl font-semibold tracking-tight">Publication work</h1>
                    <p className="mt-3 max-w-2xl text-muted-foreground">
                        Keep every destination visible, including the ones that need a human click.
                    </p>
                </div>
                <Button variant="outline" onClick={handleSignOut} disabled={pending}>
                    <LogoutIcon aria-hidden="true" />
                    Sign out
                </Button>
            </div>

            {error ? (
                <p
                    role="alert"
                    className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            ) : null}

            <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
                <aside className="space-y-6">
                    <div className="rounded-2xl border bg-card p-5 shadow-sm">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <ClipboardTextIcon aria-hidden="true" />
                            Projects
                        </div>
                        <select
                            aria-label="Select project"
                            value={selectedProjectId ?? ''}
                            onChange={event => setSelectedProjectId(event.target.value || null)}
                            className="mt-4 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20">
                            <option value="">No project selected</option>
                            {projects.map(project => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                        <form
                            className="mt-5 space-y-3 border-t pt-5"
                            onSubmit={handleCreateProject}>
                            <label className="grid gap-2 text-sm font-medium">
                                New project
                                <input
                                    required
                                    value={projectName}
                                    onChange={event => setProjectName(event.target.value)}
                                    placeholder="Product launch"
                                    className="h-9 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                />
                            </label>
                            <Button className="w-full" size="sm" type="submit" disabled={pending}>
                                <AddCircleIcon aria-hidden="true" />
                                Add project
                            </Button>
                        </form>
                    </div>

                    <div className="rounded-2xl border bg-card p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <CalendarIcon aria-hidden="true" />
                                Channels
                            </div>
                            <span className="text-xs text-muted-foreground">{channels.length}</span>
                        </div>
                        <ul className="mt-4 space-y-2">
                            {channels.length === 0 ? (
                                <li className="text-sm text-muted-foreground">
                                    Create a destination to begin.
                                </li>
                            ) : (
                                channels.map(channel => (
                                    <li
                                        key={channel.id}
                                        className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                                        {channel.name}{' '}
                                        <span className="text-xs text-muted-foreground">
                                            · {channel.profileId}
                                        </span>
                                    </li>
                                ))
                            )}
                        </ul>
                        {selectedProject ? (
                            <form
                                className="mt-5 space-y-3 border-t pt-5"
                                onSubmit={handleCreateChannel}>
                                <label className="grid gap-2 text-sm font-medium">
                                    New manual channel
                                    <input
                                        required
                                        value={channelName}
                                        onChange={event => setChannelName(event.target.value)}
                                        placeholder="Community forum"
                                        className="h-9 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                    />
                                </label>
                                <label className="grid gap-2 text-sm font-medium">
                                    Channel profile
                                    <select
                                        value={channelProfile}
                                        onChange={event =>
                                            setChannelProfile(
                                                event.target.value as 'manual-message' | 'linkedin'
                                            )
                                        }
                                        className="h-9 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20">
                                        <option value="manual-message">Manual message</option>
                                        <option value="linkedin">LinkedIn text</option>
                                    </select>
                                </label>
                                <Button
                                    className="w-full"
                                    size="sm"
                                    type="submit"
                                    disabled={pending}>
                                    <AddCircleIcon aria-hidden="true" />
                                    Add channel
                                </Button>
                            </form>
                        ) : null}
                    </div>
                </aside>

                <div className="space-y-6">
                    <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                        <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                                {selectedProject?.name ?? 'Choose a project'}
                            </p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                                Create a publication
                            </h2>
                        </div>
                        {selectedProject ? (
                            <form className="mt-6 grid gap-4" onSubmit={handleCreatePost}>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="grid gap-2 text-sm font-medium">
                                        Post title
                                        <input
                                            value={postTitle}
                                            onChange={event => setPostTitle(event.target.value)}
                                            placeholder="Optional source title"
                                            className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                        />
                                    </label>
                                    <label className="grid gap-2 text-sm font-medium">
                                        Destination
                                        <select
                                            required
                                            value={publicationChannelId}
                                            onChange={event =>
                                                setPublicationChannelId(event.target.value)
                                            }
                                            className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20">
                                            <option value="" disabled>
                                                Select a channel
                                            </option>
                                            {channels.map(channel => (
                                                <option key={channel.id} value={channel.id}>
                                                    {channel.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <label className="grid gap-2 text-sm font-medium">
                                    Source content
                                    <textarea
                                        required
                                        value={postContent}
                                        onChange={event => setPostContent(event.target.value)}
                                        placeholder="Write the source content…"
                                        rows={4}
                                        className="resize-y rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                    />
                                </label>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="grid gap-2 text-sm font-medium">
                                        Channel copy
                                        <textarea
                                            value={publicationContent}
                                            onChange={event =>
                                                setPublicationContent(event.target.value)
                                            }
                                            placeholder="Optional override"
                                            rows={3}
                                            className="resize-y rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                        />
                                    </label>
                                    <label className="grid gap-2 text-sm font-medium">
                                        Delivery mode
                                        <select
                                            value={deliveryMode}
                                            onChange={event =>
                                                setDeliveryMode(
                                                    event.target.value as 'manual' | 'automatic'
                                                )
                                            }
                                            className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20">
                                            <option value="manual">Manual publication</option>
                                            <option value="automatic">Automatic publication</option>
                                        </select>
                                    </label>
                                    <label className="grid gap-2 text-sm font-medium">
                                        Scheduled for
                                        <input
                                            required
                                            type="datetime-local"
                                            value={scheduledAt}
                                            onChange={event => setScheduledAt(event.target.value)}
                                            className="h-10 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                        />
                                    </label>
                                </div>
                                <div>
                                    <Button
                                        type="submit"
                                        disabled={pending || channels.length === 0}>
                                        <AddCircleIcon aria-hidden="true" />
                                        Schedule{' '}
                                        {deliveryMode === 'automatic' ? 'automatic' : 'manual'}{' '}
                                        publication
                                    </Button>
                                </div>
                            </form>
                        ) : (
                            <p className="mt-5 text-sm text-muted-foreground">
                                Create or select a project before scheduling work.
                            </p>
                        )}
                    </div>

                    {selectedProject ? (
                        <PublisherConnectionPanel
                            key={selectedProject.id}
                            channels={channels}
                            connections={publisherConnections}
                            pending={pending}
                            onStartLinkedInConnection={handleStartLinkedInConnection}
                            onDisconnectPublisher={handleDisconnectPublisher}
                        />
                    ) : null}

                    <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                                    Publication queue
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                                    Drafts and targets
                                </h2>
                            </div>
                            <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
                                {publications.length}
                            </span>
                        </div>
                        <div className="mt-6 space-y-2">
                            {publications.length === 0 ? (
                                <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                                    Create a publication to open the editor.
                                </p>
                            ) : (
                                publications.map(publication => (
                                    <Link
                                        key={publication.id}
                                        to="/dashboard/projects/$projectId/publications/$publicationId"
                                        params={{
                                            projectId: selectedProjectId ?? '',
                                            publicationId: publication.id,
                                        }}
                                        className="block rounded-xl border px-4 py-3 transition-colors hover:bg-muted/50">
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                            <span className="font-semibold">
                                                {publication.postTitle ?? 'Untitled publication'}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {publication.state}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                            <span>{publication.channelName}</span>
                                            <span>·</span>
                                            <span>{formatSchedule(publication.scheduledAt)}</span>
                                            {publication.draftDiffersFromTarget ? (
                                                <span className="font-medium text-amber-700 dark:text-amber-300">
                                                    · draft changes pending
                                                </span>
                                            ) : null}
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                                    Human action required
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                                    Due manual work
                                </h2>
                            </div>
                            <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
                                {duePublications.length}
                            </span>
                        </div>
                        <div className="mt-6 space-y-3">
                            {duePublications.length === 0 ? (
                                <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                                    Nothing is due for this project.
                                </p>
                            ) : (
                                duePublications.map(publication => (
                                    <article
                                        key={publication.id}
                                        className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                                <span className="font-semibold">
                                                    {publication.channelName}
                                                </span>
                                                <span className="text-muted-foreground">·</span>
                                                <span className="text-muted-foreground">
                                                    {formatSchedule(publication.scheduledAt)}
                                                </span>
                                            </div>
                                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                                {targetPreview(publication.targetContent)}
                                            </p>
                                        </div>
                                        <Button
                                            className="sm:self-center"
                                            size="sm"
                                            variant="secondary"
                                            disabled={pending}
                                            onClick={() => handlePublish(publication.id)}>
                                            <CheckCircleIcon aria-hidden="true" />
                                            Mark published
                                        </Button>
                                    </article>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function defaultScheduleValue() {
    const date = new Date(Date.now() + 60 * 60 * 1000)
    return date.toISOString().slice(0, 16)
}

function formatSchedule(timestamp: number | null) {
    if (timestamp === null) return 'Unscheduled'
    return new Date(timestamp).toLocaleString()
}

function targetPreview(targetContent: Record<string, unknown>) {
    const candidates = [targetContent.body, targetContent.commentary, targetContent.text]
    const text = candidates.find(value => typeof value === 'string')
    return typeof text === 'string' ? text : 'Structured target content'
}

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The action could not be completed'
}
