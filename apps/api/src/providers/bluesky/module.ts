import { blueskyChannelProfile } from '@postdot/bluesky'

import type { ProviderWorkerContext } from '../worker-context'
import { blueskyApplicationPolicy } from './application-policy'
import { blueskyCommentPolicy } from './comment-policy'
import { blueskyPublisherConnectionPolicy } from './connection-policy'
import { createBlueskyProviderAdapter } from './worker'
export const blueskyModule = {
    id: 'bluesky',
    connection: blueskyPublisherConnectionPolicy,
    profile: blueskyChannelProfile,
    application: blueskyApplicationPolicy,
    comments: blueskyCommentPolicy,
} as const
export const createBlueskyAdapters = ({ publisher }: ProviderWorkerContext) =>
    (['post-v1', 'post-v2', 'post-v3'] as const).map(revision =>
        createBlueskyProviderAdapter({
            revision,
            oauth: publisher.bluesky,
            resolveOAuth: publisher.resolveBlueskyOAuth,
        })
    )
