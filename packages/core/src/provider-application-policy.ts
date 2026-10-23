/** Application fields are a storage envelope, not a catalog of provider requirements. */
export interface ProviderApplicationFields {
    readonly clientId?: string | null
    readonly clientMetadataUrl?: string | null
    readonly handleResolver?: string | null
    readonly clientSecret?: string | null
}
export interface NormalizedProviderApplicationFields {
    readonly clientId: string | null
    readonly clientMetadataUrl: string | null
    readonly handleResolver: string | null
    readonly clientSecret: string | null
}
export interface ProviderApplicationPolicy<Id extends string = string> {
    readonly id: Id
    normalize(
        input: ProviderApplicationFields,
        options: { readonly preserveMissingSecret?: boolean }
    ): NormalizedProviderApplicationFields
    oauthMode(input: { readonly clientMetadataUrl: string | null }): 'loopback' | 'web' | null
}
