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
    readonly availability:
        | 'available'
        | 'blocked'
        | 'disabled'
        | 'invalid_response'
        | 'not_authorized'
        | 'not_found'
        | 'not_supported'
        | 'partial_response'
        | 'rate_limited'
        | 'temporarily_unavailable'
    /** Local traversal coverage only; the provider may omit other replies. */
    readonly truncated: boolean
    readonly comments: readonly PublicationComment[]
}
