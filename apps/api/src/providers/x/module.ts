import { isXPostTextValid } from '@postdot/x'
import { xThreadChannelProfile } from '@postdot/x'

import { withThreadExecution } from '../../modules/workflow/providers/thread'
import type { ProviderWorkerContext } from '../worker-context'
import { xApplicationPolicy } from './application-policy'
import { xPublisherConnectionPolicy } from './connection-policy'
import { createXProviderAdapter } from './worker'
export const xModule = {
    id: 'x',
    thread: {
        validateReceipt: (receipt: { externalId: string }) => /^\d+$/.test(receipt.externalId),
    },
    connection: xPublisherConnectionPolicy,
    profile: xThreadChannelProfile,
    application: xApplicationPolicy,
} as const
export const createXAdapters = ({ publisher }: ProviderWorkerContext) => {
    const adapter = createXProviderAdapter({
        oauth: publisher.x,
        resolveOAuth: publisher.resolveXOAuth,
    })
    return [
        withThreadExecution(adapter, 'post-v2', isXPostTextValid, {
            validateReceipt: xModule.thread.validateReceipt,
        }),
        createXProviderAdapter({
            oauth: publisher.x,
            resolveOAuth: publisher.resolveXOAuth,
        }),
    ]
}
