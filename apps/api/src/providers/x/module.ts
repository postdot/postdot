import { xChannelProfile } from '@postdot/x'

import type { ProviderWorkerContext } from '../worker-context'
import { xApplicationPolicy } from './application-policy'
import { xPublisherConnectionPolicy } from './connection-policy'
import { createXProviderAdapter } from './worker'
export const xModule = {
    id: 'x',
    connection: xPublisherConnectionPolicy,
    profile: xChannelProfile,
    application: xApplicationPolicy,
} as const
export const createXAdapters = ({ publisher }: ProviderWorkerContext) => [
    createXProviderAdapter({
        oauth: publisher.x,
        resolveOAuth: publisher.resolveXOAuth,
    }),
]
