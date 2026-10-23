import { facebookChannelProfile } from '@postdot/facebook'

import type { ProviderWorkerContext } from '../worker-context'
import { facebookApplicationPolicy } from './application-policy'
import { facebookPublisherConnectionPolicy } from './connection-policy'
import { createFacebookProviderAdapter } from './worker'
export const facebookModule = {
    id: 'facebook',
    connection: facebookPublisherConnectionPolicy,
    profile: facebookChannelProfile,
    application: facebookApplicationPolicy,
} as const
export const createFacebookAdapters = (_context: ProviderWorkerContext) => [
    createFacebookProviderAdapter(),
]
