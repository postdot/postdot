import type { MastodonFetcher } from '@postdot/mastodon'

import type { PublisherRuntime } from '../modules/publishers/runtime'
export interface ProviderWorkerContext {
    readonly publisher: PublisherRuntime
    readonly fetcher: MastodonFetcher
}
