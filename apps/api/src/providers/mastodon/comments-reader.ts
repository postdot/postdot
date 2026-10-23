import { createNetworkControlledFetcher } from '@postdot/custom-http'
import {
    createMastodonThreadReader,
    resolveMastodonStatusReference,
    type MastodonThreadReader,
} from '@postdot/mastodon'

import { presentMastodonComments } from './comments-view'
export function createMastodonCommentsReader(
    reader: MastodonThreadReader = createMastodonThreadReader({
        fetcher: createNetworkControlledFetcher(),
    })
) {
    return {
        id: 'mastodon' as const,
        resolve(externalId: string, externalUrl: string | null) {
            const reference = resolveMastodonStatusReference(externalId, externalUrl)
            if (!reference) return null
            return {
                externalUrl: externalUrl!,
                rootUri: reference.rootUri,
                async refresh(at: number) {
                    const read = await reader.getPostThread(reference)
                    return { read, snapshot: presentMastodonComments(read, at) }
                },
            }
        },
    }
}
