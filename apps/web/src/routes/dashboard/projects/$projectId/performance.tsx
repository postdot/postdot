import { createFileRoute } from '@tanstack/react-router'

import { PublicationPerformancePage } from '@/components/publication-performance-page'
import {
    parsePerformanceTagSelection,
    parseDeliveryAnalyticsPeriod,
    parseDeliveryAnalyticsChannel,
} from '@/lib/publication-performance-search'

export const Route = createFileRoute('/dashboard/projects/$projectId/performance')({
    validateSearch: (search: Record<string, unknown>) => ({
        tagIds: parsePerformanceTagSelection(search.tagIds),
        days: parseDeliveryAnalyticsPeriod(search.days),
        deliveryChannel: parseDeliveryAnalyticsChannel(search.deliveryChannel),
    }),
    component: PerformanceRoute,
})

function PerformanceRoute() {
    const { tagIds, days, deliveryChannel } = Route.useSearch()
    return (
        <PublicationPerformancePage
            initialTagIds={tagIds ?? []}
            deliveryDays={days}
            deliveryChannel={deliveryChannel}
        />
    )
}
