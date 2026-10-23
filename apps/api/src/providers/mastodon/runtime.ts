import type { MastodonFetcher } from '@postdot/mastodon'

import type { ProviderRuntimeContext } from '../runtime-context'
export interface MastodonRuntimeOptions {
    readonly mastodon?: {
        readonly clientName?: string
        readonly fetcher?: MastodonFetcher
    }
}
export function createMastodonRuntime({ options }: ProviderRuntimeContext) {
    const mastodonCallbackUri = new URL(
        '/api/oauth/mastodon/callback',
        options.apiOrigin
    ).toString()
    const mastodon = {
        callbackUri: mastodonCallbackUri,
        clientName: options.mastodon?.clientName ?? 'Postdot',
        ...(options.mastodon?.fetcher === undefined ? {} : { fetcher: options.mastodon.fetcher }),
    }

    return { mastodon, mastodonCallbackUri }
}
