import { mastodonChannelProfile } from '@postdot/mastodon'
import {
    MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
    MASTODON_VIDEO_EXECUTION_CONTRACT_REVISION,
} from '@postdot/mastodon'

import type { ProviderWorkerContext } from '../worker-context'
import { mastodonCommentPolicy } from './comment-policy'
import { mastodonPublisherConnectionPolicy } from './connection-policy'
import { createMastodonProviderAdapter } from './worker'
export const mastodonModule = {
    id: 'mastodon',
    connection: mastodonPublisherConnectionPolicy,
    profile: mastodonChannelProfile,
    comments: mastodonCommentPolicy,
} as const
export const createMastodonAdapters = ({ fetcher: mastodonFetcher }: ProviderWorkerContext) => [
    createMastodonProviderAdapter({
        revision: MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
        fetcher: mastodonFetcher,
    }),
    createMastodonProviderAdapter({
        revision: MASTODON_VIDEO_EXECUTION_CONTRACT_REVISION,
        fetcher: mastodonFetcher,
    }),
    createMastodonProviderAdapter({
        fetcher: mastodonFetcher,
    }),
]
