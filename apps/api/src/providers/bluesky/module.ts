import { isBlueskyThreadReceipt } from '@postdot/bluesky'
import { blueskyThreadChannelProfile } from '@postdot/bluesky'

import { withThreadExecution } from '../../modules/workflow/providers/thread'
import type { ProviderWorkerContext } from '../worker-context'
import { blueskyApplicationPolicy } from './application-policy'
import { blueskyCommentPolicy } from './comment-policy'
import { blueskyPublisherConnectionPolicy } from './connection-policy'
import { createBlueskyProviderAdapter } from './worker'
export const blueskyModule = {
    id: 'bluesky',
    thread: { validateReceipt: isBlueskyThreadReceipt },
    connection: blueskyPublisherConnectionPolicy,
    profile: blueskyThreadChannelProfile,
    application: blueskyApplicationPolicy,
    comments: blueskyCommentPolicy,
} as const
export const createBlueskyAdapters = ({ publisher }: ProviderWorkerContext) => [
    withThreadExecution(
        createBlueskyProviderAdapter({
            oauth: publisher.bluesky,
            resolveOAuth: publisher.resolveBlueskyOAuth,
        }),
        'post-v4',
        text =>
            text.length <= 3000 &&
            [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length <=
                300,
        {
            validateReceipt: (receipt, target) =>
                isBlueskyThreadReceipt(receipt, target.externalAccountId),
        }
    ),
    ...(['post-v1', 'post-v2', 'post-v3'] as const).map(revision =>
        createBlueskyProviderAdapter({
            revision,
            oauth: publisher.bluesky,
            resolveOAuth: publisher.resolveBlueskyOAuth,
        })
    ),
]
