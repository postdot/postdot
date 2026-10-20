import type {
    BlueskyThreadNode,
    BlueskyThreadRead,
    BlueskyThreadUnavailableAvailability,
} from '@postbot/bluesky'
import { requireTimestamp } from '@postbot/core'
import type { MastodonThreadRead } from '@postbot/mastodon'

export interface PublicationComment {
    readonly id: string
    readonly parentUri: string | null
    readonly depth: number
    readonly availability: 'available' | 'blocked' | 'not_found' | 'invalid_response'
    readonly authorDid: string | null
    readonly authorHandle: string | null
    readonly text: string | null
    readonly createdAt: number | null
    readonly externalUrl: string | null
}

export interface PublicationCommentSnapshot {
    readonly fetchedAt: number
    readonly rootUri: string
    readonly availability: 'available' | BlueskyThreadUnavailableAvailability
    /** Local traversal coverage only; the provider may omit other replies. */
    readonly truncated: boolean
    readonly comments: readonly PublicationComment[]
}

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
