/** Durable comment identity and text validation are supplied by the integration owner. */
export interface CommentParentReference {
    readonly rootUri: string
    readonly instanceOrigin: string | null
    readonly accountId: string | null
}
export interface ProviderCommentPolicy<Id extends string = string> {
    readonly id: Id
    readonly textLimit: number
    readonly maxTextLength: number
    readonly requiresInstanceOrigin: boolean
    normalizeText(value: string): string
    resolveParent(input: {
        readonly externalId: string | null
        readonly externalUrl: string | null
        readonly receiptExternalId: string | null
    }): CommentParentReference | null
    identityFailure(
        parent: CommentParentReference,
        identity: {
            readonly accountId: string
            readonly endpointUrl: string | null
            readonly scopes: string
        }
    ): 'account' | 'connection' | 'authorization' | null
    publicationId(rootUri: string): string | null
}
