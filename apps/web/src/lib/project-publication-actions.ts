import { useQueryClient } from '@tanstack/react-query'

import { api, type Publication } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useProjectAction } from '@/lib/project-action'
import { refreshPublicationResources } from '@/lib/project-resources'

export function useProjectPublicationActions() {
    const { project } = useProjectDashboard()
    const queryClient = useQueryClient()
    const { error, pending, runAction } = useProjectAction()
    const refreshProject = () => refreshPublicationResources(queryClient, project.id)
    async function handlePublish(publicationId: string): Promise<boolean> {
        return runAction(async () => {
            await api.publishManualPublication(project.id, publicationId)
            await refreshProject()
        })
    }

    async function handleRetryPublication(publicationId: string): Promise<boolean> {
        return runAction(async () => {
            await api.retryFailedPublication(project.id, publicationId)
            await refreshProject()
        })
    }

    async function handleDeleteDraftPublication(publicationId: string): Promise<boolean> {
        return runAction(async () => {
            await api.deleteDraftPublication(project.id, publicationId)
            await refreshProject()
        })
    }

    async function handleDuplicateDraftPublication(
        publicationId: string
    ): Promise<Publication | null> {
        let duplicatedPublication: Publication | null = null
        const succeeded = await runAction(async () => {
            const response = await api.duplicateDraftPublication(project.id, publicationId)
            duplicatedPublication = response.publication
            await refreshProject()
        })
        return succeeded ? duplicatedPublication : null
    }

    async function handleReschedulePublications(
        publicationIds: readonly string[],
        scheduledAt: number
    ): Promise<boolean> {
        return runAction(async () => {
            await api.reschedulePublications(project.id, publicationIds, scheduledAt)
            await refreshProject()
        })
    }

    async function handleCancelPublications(publicationIds: readonly string[]): Promise<boolean> {
        return runAction(async () => {
            await api.cancelPublications(project.id, publicationIds)
            await refreshProject()
        })
    }

    return {
        error,
        pending,
        onPublish: handlePublish,
        onRetryPublication: handleRetryPublication,
        onDeleteDraftPublication: handleDeleteDraftPublication,
        onDuplicateDraftPublication: handleDuplicateDraftPublication,
        onCancelPublications: handleCancelPublications,
        onReschedulePublications: handleReschedulePublications,
    }
}
