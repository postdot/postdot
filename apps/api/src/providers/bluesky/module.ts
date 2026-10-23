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
export const createBlueskyAdapters = ({ publisher }: ProviderWorkerContext) => [
    createBlueskyProviderAdapter({
        revision: 'post-v1',
        oauth: publisher.bluesky,
        resolveOAuth: publisher.resolveBlueskyOAuth,
    }),
    createBlueskyProviderAdapter({
        oauth: publisher.bluesky,
        resolveOAuth: publisher.resolveBlueskyOAuth,
    }),
]
