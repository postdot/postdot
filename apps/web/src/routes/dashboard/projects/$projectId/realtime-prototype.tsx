import { createFileRoute } from '@tanstack/react-router'

import { RealtimePrototypePage } from '@/components/realtime-prototype-page'

export const Route = createFileRoute('/dashboard/projects/$projectId/realtime-prototype')({
    component: RealtimePrototypeRoute,
})

function RealtimePrototypeRoute() {
    const { projectId } = Route.useParams()
    return <RealtimePrototypePage projectId={projectId} />
}
