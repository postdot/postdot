import type { BlueskyThreadRead, BlueskyThreadNode } from '@postdot/bluesky'
import { requireTimestamp } from '@postdot/core'

import type { PublicationComment, PublicationCommentSnapshot } from '../comment-snapshot'
/** Presentation shared by either retention strategy; excludes the source post. */
export function presentPublicationComments(
    read: BlueskyThreadRead,
    fetchedAt: number
): PublicationCommentSnapshot {
    requireTimestamp(fetchedAt, 'comments fetchedAt')
    if (read.kind === 'unavailable') {
        return {
            fetchedAt,
            rootUri: read.requestedUri,
            availability: read.availability,
            truncated: false,
            comments: [],
        }
    }
    const comments: PublicationComment[] = []
    function append(
        nodes: readonly BlueskyThreadNode[],
        parentUri: string,
        depth: number,
        path: string
    ) {
        for (const [index, node] of nodes.entries()) {
            const position = `${path}.${index}`
            if (node.kind === 'unavailable') {
                comments.push({
                    id: node.uri ?? `unavailable:${position}`,
                    parentUri,
                    depth,
                    availability: node.availability,
                    authorDid: null,
                    authorHandle: null,
                    text: null,
                    createdAt: null,
                    externalUrl: null,
                })
            } else {
                comments.push({
                    id: node.uri,
                    parentUri: node.parentUri ?? parentUri,
                    depth,
                    availability: 'available',
                    authorDid: node.authorDid,
                    authorHandle: node.authorHandle,
                    text: node.text,
                    createdAt: node.createdAt,
                    externalUrl: node.externalUrl,
                })
                append(node.replies, node.uri, depth + 1, position)
            }
        }
    }
    append(read.root.replies, read.root.uri, 0, 'root')
    return {
        fetchedAt,
        rootUri: read.requestedUri,
        availability: 'available',
        truncated: read.truncated,
        comments,
    }
}
