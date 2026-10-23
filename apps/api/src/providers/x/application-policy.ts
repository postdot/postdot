import { requireNonBlank, type ProviderApplicationPolicy } from '@postdot/core'
export const xApplicationPolicy = {
    id: 'x',
    normalize(input, options) {
        if (input.clientMetadataUrl !== undefined && input.clientMetadataUrl !== null)
            throw new Error('x application configuration does not accept clientMetadataUrl')
        if (input.handleResolver !== undefined && input.handleResolver !== null)
            throw new Error('x application configuration does not accept handleResolver')
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
} as const satisfies ProviderApplicationPolicy<'x'>
