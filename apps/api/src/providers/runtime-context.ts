import type { createProviderApplicationStore } from '@postdot/db'

import type { PublisherRuntimeOptions } from '../modules/publishers/runtime'
import type { ProviderApplicationId } from './registry'
export interface ProviderRuntimeContext {
    readonly options: PublisherRuntimeOptions
    readonly providerApplicationStore: ReturnType<
        typeof createProviderApplicationStore<ProviderApplicationId>
    >
    readonly now: () => number
}
