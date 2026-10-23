import { createInstagramOAuth, type InstagramFetcher } from '@postdot/instagram'

import type { ProviderRuntimeContext } from '../runtime-context'
export interface InstagramRuntimeOptions {
    readonly instagram?: { readonly fetcher?: InstagramFetcher }
}
export function createInstagramRuntime({
    options,
    providerApplicationStore,
    now,
}: ProviderRuntimeContext) {
    const instagramCallbackUri = new URL(
        '/api/oauth/instagram/callback',
        options.apiOrigin
    ).toString()
    async function resolveInstagramApplication(applicationId?: string | null) {
        if (applicationId === null) return undefined
        const configured = await providerApplicationStore.resolveProviderApplication(
            'instagram',
            applicationId
        )
        if (!configured?.clientId || !configured.clientSecret) return undefined
        return {
            applicationId: configured.id,
            oauth: createInstagramOAuth({
                clientId: configured.clientId,
                clientSecret: configured.clientSecret,
                callbackUri: instagramCallbackUri,
                fetcher: options.instagram?.fetcher,
                now,
            }),
        }
    }
    return { instagramCallbackUri, resolveInstagramApplication }
}
