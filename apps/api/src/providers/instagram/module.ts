import { instagramChannelProfile } from '@postdot/instagram'

import type { ProviderWorkerContext } from '../worker-context'
import { instagramApplicationPolicy } from './application-policy'
import { instagramPublisherConnectionPolicy } from './connection-policy'
import { createInstagramProviderAdapter } from './worker'
export const instagramModule = {
    id: 'instagram',
    connection: instagramPublisherConnectionPolicy,
    profile: instagramChannelProfile,
    application: instagramApplicationPolicy,
} as const
export const createInstagramAdapters = ({
    publisher,
    fetcher: mastodonFetcher,
}: ProviderWorkerContext) => [
    createInstagramProviderAdapter({
        fetcher: mastodonFetcher,
        resolveOAuth: async applicationId =>
            (await publisher.resolveInstagramApplication(applicationId))?.oauth,
    }),
]
