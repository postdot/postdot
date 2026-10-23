import type { BlueskyThreadReader } from '@postdot/bluesky'
import type { MastodonThreadReader } from '@postdot/mastodon'

import { createBlueskyCommentsReader } from './bluesky/comments-reader'
import { createMastodonCommentsReader } from './mastodon/comments-reader'
export function createProviderCommentsReaders(options: {
    reader?: BlueskyThreadReader
    mastodonReader?: MastodonThreadReader
}) {
    return [
        createBlueskyCommentsReader(options.reader),
        createMastodonCommentsReader(options.mastodonReader),
    ] as const
}
