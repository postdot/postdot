import { Button, buttonVariants } from '@herald/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import {
    createFileRoute,
    Link,
    redirect,
    useRouter,
    type ErrorComponentProps,
} from '@tanstack/react-router'
import { useId } from 'react'

import { PublicationEditor } from '@/components/publication-editor'
import { api, ApiError } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { projectQueryKeys } from '@/lib/project-realtime'
import { isCalendarDateKey } from '@/lib/publication-calendar'
import {
    isPublicationCalendarView,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-events'
import * as m from '@/paraglide/messages.js'

export interface PublicationEditorSearch {
    editor?: 'tiptap'
    from?: 'calendar'
    date?: string
    view?: PublicationCalendarView
}

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/$publicationId')({
    validateSearch: (search: Record<string, unknown>): PublicationEditorSearch => ({
        ...(import.meta.env.DEV && search.editor === 'tiptap' ? { editor: 'tiptap' as const } : {}),
        ...(search.from === 'calendar' ? { from: 'calendar' as const } : {}),
        ...(isCalendarDateKey(search.date) ? { date: search.date } : {}),
        ...(isPublicationCalendarView(search.view) ? { view: search.view } : {}),
    }),
    loader: async ({ params }) => {
        const session = await api.getSession()
        if (session === null) {
            throw redirect({ to: '/login', search: { continue: undefined } })
        }

        const [{ editor }, { publications }, { tags: projectTags }, { tags: publicationTags }] =
            await Promise.all([
                api.getPublicationEditor(params.projectId, params.publicationId),
                api.listPublications(params.projectId, { limit: 100 }),
                api.listProjectTags(params.projectId, { includeArchived: true }),
                api.listPublicationTags(params.projectId, params.publicationId),
            ])
        const relatedPublications = publications.filter(
            publication => publication.postId === editor.post.id
        )
        return { editor, projectTags, publicationTags, relatedPublications }
    },
    component: PublicationEditorRoute,
    errorComponent: PublicationUnavailable,
})

function PublicationEditorRoute() {
    const { projectId, publicationId } = Route.useParams()
    const { date, from, view, editor: editorEngine } = Route.useSearch()
    const { editor, projectTags, publicationTags, relatedPublications } = Route.useLoaderData()
    const {
        activeChannels,
        onCancelPublications,
        onPublish,
        onRetryPublication,
        project,
        projectRole,
    } = useProjectDashboard()
    const readOnly = projectRole === 'viewer'
    const instanceId = useId()
    const editorQuery = useQuery({
        queryKey: projectQueryKeys.publicationEditorInstance(projectId, publicationId, instanceId),
        queryFn: () => api.getPublicationEditor(projectId, publicationId),
        initialData: { editor },
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const currentEditor = editorQuery.data?.editor ?? editor

    return (
        <PublicationEditor
            key={currentEditor.draft.id}
            projectId={projectId}
            experimentalEditor={import.meta.env.DEV && editorEngine === 'tiptap'}
            initialEditor={currentEditor}
            initialPublicationTags={publicationTags}
            onCancel={
                readOnly ? undefined : () => onCancelPublications([currentEditor.publication.id])
            }
            onPublish={readOnly ? undefined : () => onPublish(currentEditor.publication.id)}
            onRetry={readOnly ? undefined : () => onRetryPublication(currentEditor.publication.id)}
            projectTags={projectTags}
            readOnly={readOnly}
            channels={activeChannels}
            relatedPublications={relatedPublications}
            backToCalendar={from === 'calendar' ? { date, view } : undefined}
            timeZone={project.timeZone}
        />
    )
}

function PublicationUnavailable({ error, reset }: ErrorComponentProps) {
    const { projectId } = Route.useParams()
    const router = useRouter()
    const unavailable = error instanceof ApiError && (error.status === 403 || error.status === 404)
    return (
        <div className="mx-auto grid max-w-md justify-items-center gap-4 px-6 py-12 text-center">
            <h1 className="font-heading text-xl font-semibold">
                {unavailable ? m.notifications_subject_unavailable() : m.common_error_title()}
            </h1>
            {unavailable ? null : (
                <p className="text-sm text-muted-foreground">{m.common_error_description()}</p>
            )}
            <div className="flex flex-wrap justify-center gap-3">
                <Link
                    className={buttonVariants({ variant: 'secondary' })}
                    to="/dashboard/projects/$projectId/overview"
                    params={{ projectId }}>
                    {m.nav_overview()}
                </Link>
                {unavailable ? null : (
                    <Button
                        onClick={() => {
                            reset()
                            void router.invalidate()
                        }}>
                        {m.common_retry()}
                    </Button>
                )}
            </div>
        </div>
    )
}
