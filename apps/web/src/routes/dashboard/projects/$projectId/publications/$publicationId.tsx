import { createFileRoute, redirect } from '@tanstack/react-router'

import { PublicationEditor } from '@/components/publication-editor'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/$publicationId')({
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
    const { editor, projectTags, publicationTags, relatedPublications } = Route.useLoaderData()
    const { activeChannels, project } = useProjectDashboard()

    return (
        <PublicationEditor
            key={editor.draft.id}
            projectId={projectId}
            initialEditor={editor}
            initialPublicationTags={publicationTags}
            projectTags={projectTags}
            channels={activeChannels}
            relatedPublications={relatedPublications}
            timeZone={project.timeZone}
        />
    )
}
