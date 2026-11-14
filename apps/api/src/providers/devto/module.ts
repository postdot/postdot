import {
    DEVTO_ARTICLE_V1_EXECUTION_CONTRACT_REVISION,
    DEVTO_EXECUTION_CONTRACT_REVISION,
    devtoChannelProfile,
} from '@postdot/devto'

import type { ProviderWorkerContext } from '../worker-context'
import { devtoPublisherConnectionPolicy } from './connection-policy'
import { createDevtoProviderAdapter } from './worker'

export const devtoModule = {
    id: 'devto',
    connection: devtoPublisherConnectionPolicy,
    profile: devtoChannelProfile,
} as const

export const createDevtoAdapters = (_context: ProviderWorkerContext) =>
    (
        [DEVTO_ARTICLE_V1_EXECUTION_CONTRACT_REVISION, DEVTO_EXECUTION_CONTRACT_REVISION] as const
    ).map(revision => createDevtoProviderAdapter({ revision }))
