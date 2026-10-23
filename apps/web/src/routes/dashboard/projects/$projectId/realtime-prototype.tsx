import { createFileRoute, redirect } from '@tanstack/react-router'
import { lazy } from 'react'

const RealtimePrototypePage = import.meta.env.DEV
    ? lazy(() =>
          import('@/components/realtime-prototype-page').then(module => ({
              default: module.RealtimePrototypePage,
          }))
      )
    : () => null

export const Route = createFileRoute('/dashboard/projects/$projectId/realtime-prototype')({
    beforeLoad: ({ params }) => {
        if (!import.meta.env.DEV) {
            throw redirect({
                to: '/dashboard/projects/$projectId/overview',
                params: { projectId: params.projectId },
                replace: true,
            })
        }
    },
    component: RealtimePrototypeRoute,
})

function RealtimePrototypeRoute() {
    const { projectId } = Route.useParams()
    return <RealtimePrototypePage projectId={projectId} />
}
