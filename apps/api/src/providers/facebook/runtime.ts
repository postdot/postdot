import {
    createFacebookOAuth,
    createFacebookPublisher,
    type FacebookFetcher,
} from '@postdot/facebook'

import type { ProviderRuntimeContext } from '../runtime-context'
export interface FacebookRuntimeOptions {
    readonly facebook?: {
        readonly clientId: string
        readonly clientSecret: string
        readonly fetcher?: FacebookFetcher
    }
}
export function createFacebookRuntime({
    options,
    providerApplicationStore,
}: ProviderRuntimeContext) {
    const facebookCallbackUri = new URL(
        '/api/oauth/facebook/callback',
        options.apiOrigin
    ).toString()
    async function resolveFacebookApplication(applicationId?: string | null) {
        const configured =
            applicationId === null
                ? null
                : await providerApplicationStore.resolveProviderApplication(
                      'facebook',
                      applicationId
                  )
        if (
            configured === null &&
            applicationId !== null &&
            (applicationId !== undefined ||
                providerApplicationStore.hasProviderApplication('facebook'))
        )
            return undefined
        const credentials = configured ?? options.facebook
        if (!credentials?.clientId || !credentials.clientSecret) return undefined
        return {
            applicationId: configured?.id ?? null,
            oauth: createFacebookOAuth({
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                callbackUri: facebookCallbackUri,
                fetcher: options.facebook?.fetcher,
            }),
            graph: createFacebookPublisher({ fetcher: options.facebook?.fetcher }),
        }
    }
    return { facebookCallbackUri, resolveFacebookApplication }
}
