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

        const [{ editor }, { tags: projectTags }, { tags: publicationTags }] = await Promise.all([
            api.getPublicationEditor(params.projectId, params.publicationId),
            api.listProjectTags(params.projectId, { includeArchived: true }),
            api.listPublicationTags(params.projectId, params.publicationId),
        ])
        return { editor, projectTags, publicationTags }
    },
    component: PublicationEditorRoute,
})

function PublicationEditorRoute() {
    const { projectId } = Route.useParams()
    const { editor, projectTags, publicationTags } = Route.useLoaderData()
    const { project } = useProjectDashboard()

    return (
        <PublicationEditor
            key={editor.draft.id}
            projectId={projectId}
            initialEditor={editor}
            initialPublicationTags={publicationTags}
            projectTags={projectTags}
            timeZone={project.timeZone}
        />
    )
}
