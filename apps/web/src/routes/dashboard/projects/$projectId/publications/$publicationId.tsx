import { createFileRoute, redirect } from '@tanstack/react-router'

import { PublicationEditor } from '@/components/publication-editor'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { isCalendarDateKey } from '@/lib/publication-calendar'
import {
    isPublicationCalendarView,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-events'

export interface PublicationEditorSearch {
    from?: 'calendar'
    date?: string
    view?: PublicationCalendarView
}

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/$publicationId')({
    validateSearch: (search: Record<string, unknown>): PublicationEditorSearch => ({
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
})

function PublicationEditorRoute() {
    const { projectId } = Route.useParams()
    const { date, from, view } = Route.useSearch()
    const { editor, projectTags, publicationTags, relatedPublications } = Route.useLoaderData()
    const { activeChannels, onPublish, project } = useProjectDashboard()

    return (
        <PublicationEditor
            key={editor.draft.id}
            projectId={projectId}
            initialEditor={editor}
            initialPublicationTags={publicationTags}
            onPublish={() => onPublish(editor.publication.id)}
            projectTags={projectTags}
            channels={activeChannels}
            relatedPublications={relatedPublications}
            backToCalendar={from === 'calendar' ? { date, view } : undefined}
            timeZone={project.timeZone}
        />
    )
}
