import { requireTimestamp } from '@postdot/core'
import type { MastodonThreadRead } from '@postdot/mastodon'

import type { PublicationCommentSnapshot } from '../comment-snapshot'
export function presentMastodonComments(
    read: MastodonThreadRead,
    fetchedAt: number
): PublicationCommentSnapshot {
    requireTimestamp(fetchedAt, 'comments fetchedAt')
    return {
        fetchedAt,
        rootUri: read.requestedUri,
        availability: read.kind === 'available' ? 'available' : read.availability,
        truncated: read.kind === 'available' && read.truncated,
        comments:
            read.kind === 'unavailable'
                ? []
                : read.comments.map(comment => ({
                      id: comment.uri,
                      parentUri: comment.parentUri,
                      depth: comment.depth,
                      availability: 'available',
                      authorDid: null,
                      authorHandle: comment.authorHandle,
                      text: comment.text,
                      createdAt: comment.createdAt,
                      externalUrl: comment.externalUrl,
                  })),
    }
}
