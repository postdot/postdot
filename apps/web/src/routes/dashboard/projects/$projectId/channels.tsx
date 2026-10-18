import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ChannelManagementPage } from '@/components/channel-management-page'
import {
    parsePublisherCallbackResult,
    type PublisherCallbackResult,
} from '@/lib/publisher-connection-feedback'

export const Route = createFileRoute('/dashboard/projects/$projectId/channels')({
    validateSearch: (search: Record<string, unknown>): ChannelsSearch => ({
        publisher: parsePublisherCallbackResult(search.publisher),
        facebook_selection:
            typeof search.facebook_selection === 'string' &&
            /^[\x21-\x7e]{32,512}$/.test(search.facebook_selection)
                ? search.facebook_selection
                : undefined,
        publisher_channel:
            typeof search.publisher_channel === 'string' && search.publisher_channel.length > 0
                ? search.publisher_channel
                : undefined,
    }),
    component: ChannelsRoute,
})

export interface ChannelsSearch {
    facebook_selection?: string
    publisher?: PublisherCallbackResult
    publisher_channel?: string
}

function ChannelsRoute() {
    const navigate = useNavigate()
    const search = Route.useSearch()
    const { projectId } = Route.useParams()

    async function dismissPublisherFeedback() {
        await navigate({
            to: '/dashboard/projects/$projectId/channels',
            params: { projectId },
            search: previous => ({
                ...previous,
                publisher: undefined,
                facebook_selection: undefined,
                publisher_channel: undefined,
            }),
            replace: true,
        })
    }

    return (
        <ChannelManagementPage
            onDismissPublisherFeedback={dismissPublisherFeedback}
            facebookSelection={
                search.facebook_selection && search.publisher_channel
                    ? { selection: search.facebook_selection, channelId: search.publisher_channel }
                    : undefined
            }
            publisherFeedback={
                search.publisher === undefined
                    ? undefined
                    : {
                          channelId: search.publisher_channel,
                          result: search.publisher,
                      }
            }
        />
    )
}
