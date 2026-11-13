import { mastodonThreadChannelProfile } from '@postdot/mastodon'
import {
    readMastodonStatusOptions,
    MASTODON_IMAGE_EXECUTION_CONTRACT_REVISION,
    MASTODON_VIDEO_EXECUTION_CONTRACT_REVISION,
} from '@postdot/mastodon'

import { withThreadExecution } from '../../modules/workflow/providers/thread'
import type { ProviderWorkerContext } from '../worker-context'
import { mastodonCommentPolicy } from './comment-policy'
import { mastodonPublisherConnectionPolicy } from './connection-policy'
import { createMastodonProviderAdapter } from './worker'
export const mastodonModule = {
    id: 'mastodon',
    thread: {
        validateReceipt: (receipt: { externalId: string }) => /^\d+$/.test(receipt.externalId),
    },
    connection: mastodonPublisherConnectionPolicy,
    profile: mastodonThreadChannelProfile,
    comments: mastodonCommentPolicy,
} as const
export const createMastodonAdapters = ({ fetcher: mastodonFetcher }: ProviderWorkerContext) => [
    withThreadExecution(
        createMastodonProviderAdapter({ fetcher: mastodonFetcher }),
        'status-v4',
        text => text.length <= 500,
        {
            validateContent: content =>
                ['public', 'unlisted', 'private'].includes(String(content.visibility))
                    ? null
                    : 'Choose public, unlisted or followers-only visibility for the thread',
            validateReceipt: mastodonModule.thread.validateReceipt,
            continuationContent: content => ({
                text: content.text,
                media: [],
                ...readMastodonStatusOptions(content),
            }),
        }
    ),
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
