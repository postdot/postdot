import { devtoChannelProfile } from '@postdot/devto'

import type { ProviderWorkerContext } from '../worker-context'
import { devtoPublisherConnectionPolicy } from './connection-policy'
import { createDevtoProviderAdapter } from './worker'
export const devtoModule = {
    id: 'devto',
    connection: devtoPublisherConnectionPolicy,
    profile: devtoChannelProfile,
} as const
export const createDevtoAdapters = (_context: ProviderWorkerContext) => [
    createDevtoProviderAdapter(),
]
