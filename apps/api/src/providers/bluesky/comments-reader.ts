import { createBlueskyThreadReader, type BlueskyThreadReader } from '@postdot/bluesky'

import { presentPublicationComments } from './comments-view'
export function createBlueskyCommentsReader(
    reader: BlueskyThreadReader = createBlueskyThreadReader()
) {
    return {
        id: 'bluesky' as const,
        resolve(externalId: string, _externalUrl: string | null) {
            if (!/^at:\/\/did:[^/\s]+\/app\.bsky\.feed\.post\/[^/\s]+$/.test(externalId))
                return null
            return {
                rootUri: externalId,
                async refresh(at: number) {
                    const read = await reader.getPostThread(externalId)
                    return { read, snapshot: presentPublicationComments(read, at) }
                },
            }
        },
    }
}
