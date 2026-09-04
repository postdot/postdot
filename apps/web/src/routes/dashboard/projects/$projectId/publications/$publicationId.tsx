import { createFileRoute, redirect } from '@tanstack/react-router'

import { PublicationEditor } from '@/components/publication-editor'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/$publicationId')({
    loader: async ({ params }) => {
        const session = await api.getSession()
        if (session === null) {
            throw redirect({ to: '/login' })
        }

        const { editor } = await api.getPublicationEditor(params.projectId, params.publicationId)
        return { editor }
    },
    component: PublicationEditorRoute,
})

function PublicationEditorRoute() {
    const { projectId } = Route.useParams()
    const { editor } = Route.useLoaderData()
    const { project } = useProjectDashboard()

    return (
        <PublicationEditor
            key={editor.draft.id}
            projectId={projectId}
            initialEditor={editor}
            timeZone={project.timeZone}
        />
    )
}
