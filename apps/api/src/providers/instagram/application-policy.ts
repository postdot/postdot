import { requireNonBlank, type ProviderApplicationPolicy } from '@postdot/core'
export const instagramApplicationPolicy = {
    id: 'instagram',
    normalize(input, options) {
        if (input.clientMetadataUrl !== undefined && input.clientMetadataUrl !== null)
            throw new Error('instagram application configuration does not accept clientMetadataUrl')
        if (input.handleResolver !== undefined && input.handleResolver !== null)
            throw new Error('instagram application configuration does not accept handleResolver')
        if (!/^[1-9]\d*$/.test(input.clientId ?? ''))
            throw new Error('Instagram application ID must be numeric')
        return {
            clientId: requireNonBlank(input.clientId ?? '', 'clientId'),
            clientMetadataUrl: null,
            handleResolver: null,
            clientSecret:
                input.clientSecret === undefined && options.preserveMissingSecret === true
                    ? null
                    : requireNonBlank(input.clientSecret ?? '', 'clientSecret'),
        }
    },
    oauthMode: () => null,
} as const satisfies ProviderApplicationPolicy<'instagram'>
