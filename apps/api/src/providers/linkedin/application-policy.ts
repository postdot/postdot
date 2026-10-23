import { requireNonBlank, type ProviderApplicationPolicy } from '@postdot/core'
export const linkedinApplicationPolicy = {
    id: 'linkedin',
    normalize(input, options) {
        if (input.clientMetadataUrl !== undefined && input.clientMetadataUrl !== null)
            throw new Error('linkedin application configuration does not accept clientMetadataUrl')
        if (input.handleResolver !== undefined && input.handleResolver !== null)
            throw new Error('linkedin application configuration does not accept handleResolver')
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
} as const satisfies ProviderApplicationPolicy<'linkedin'>
