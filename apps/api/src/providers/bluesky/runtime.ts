import { createBlueskyClientMetadata, createBlueskyLoopbackClientMetadata } from '@postdot/bluesky'

import type { ProviderRuntimeContext } from '../runtime-context'
export interface BlueskyRuntimeOptions {
    readonly bluesky?: {
        readonly clientMetadataUrl: string
        readonly handleResolver: string
    }
}
type BlueskyOAuthMode = 'loopback' | 'web'

function loopbackHost(value: string): '127.0.0.1' | '[::1]' | null {
    if (value === '127.0.0.1') return '127.0.0.1'
    if (value === '[::1]' || value === '::1') return '[::1]'
    return null
}

function createBlueskyLoopbackCallbackUri(apiOrigin: string, webOrigin: string): string {
    const api = new URL(apiOrigin)
    const web = new URL(webOrigin)
    const apiHost = loopbackHost(api.hostname)
    const webHost = loopbackHost(web.hostname)

    // Better Auth's session cookie is host-bound. Requiring the dashboard and
    // API to use the same loopback literal prevents a successful provider
    // callback from losing the operator session when localhost and 127.0.0.1
    // are mixed.
    if (
        api.protocol !== 'http:' ||
        web.protocol !== 'http:' ||
        apiHost === null ||
        webHost !== apiHost
    ) {
        throw new Error(
            'Bluesky loopback OAuth requires HTTP API and web origins that use the same loopback IP (127.0.0.1 or [::1])'
        )
    }

    api.hostname = apiHost
    return new URL('/api/oauth/bluesky/callback', api).toString()
}

function createBlueskyApplication(options: {
    readonly applicationId: string | null
    readonly clientMetadataUrl: string | null
    readonly handleResolver: string
    readonly apiOrigin: string
    readonly webOrigin: string
    readonly callbackUri: string
}) {
    if (options.clientMetadataUrl === null) {
        const callbackUri = createBlueskyLoopbackCallbackUri(options.apiOrigin, options.webOrigin)
        return {
            applicationId: options.applicationId,
            callbackUri,
            clientMetadata: createBlueskyLoopbackClientMetadata({ redirectUri: callbackUri }),
            handleResolver: options.handleResolver,
            oauthMode: 'loopback' as const satisfies BlueskyOAuthMode,
        }
    }

    return {
        applicationId: options.applicationId,
        callbackUri: options.callbackUri,
        clientMetadata: createBlueskyClientMetadata({
            clientId: options.clientMetadataUrl,
            clientName: 'Postdot',
            clientUri: options.webOrigin,
            redirectUri: options.callbackUri,
        }),
        handleResolver: options.handleResolver,
        oauthMode: 'web' as const satisfies BlueskyOAuthMode,
    }
}

export function createBlueskyRuntime({
    options,
    providerApplicationStore,
}: ProviderRuntimeContext) {
    const blueskyCallbackUri = new URL('/api/oauth/bluesky/callback', options.apiOrigin).toString()
    const bluesky =
        options.bluesky === undefined
            ? undefined
            : {
                  callbackUri: blueskyCallbackUri,
                  clientMetadata: createBlueskyClientMetadata({
                      clientId: options.bluesky.clientMetadataUrl,
                      clientName: 'Postdot',
                      clientUri: options.webOrigin,
                      redirectUri: blueskyCallbackUri,
                  }),
                  handleResolver: options.bluesky.handleResolver,
                  oauthMode: 'web' as const,
              }

    async function resolveBlueskyApplication(applicationId?: string | null) {
        if (applicationId === null) {
            return bluesky === undefined ? undefined : { applicationId: null, ...bluesky }
        }
        const configured = await providerApplicationStore.resolveProviderApplication(
            'bluesky',
            applicationId
        )
        if (configured !== null) {
            if (configured.handleResolver === null) {
                return undefined
            }
            return createBlueskyApplication({
                applicationId: configured.id,
                clientMetadataUrl: configured.clientMetadataUrl,
                handleResolver: configured.handleResolver,
                apiOrigin: options.apiOrigin,
                webOrigin: options.webOrigin,
                callbackUri: blueskyCallbackUri,
            })
        }
        if (applicationId !== undefined && applicationId !== null) return undefined
        if (providerApplicationStore.hasProviderApplication('bluesky')) return undefined
        return bluesky === undefined ? undefined : { applicationId: null, ...bluesky }
    }

    return {
        bluesky,
        blueskyCallbackUri,
        resolveBlueskyApplication,
        resolveBlueskyOAuth: async (applicationId?: string | null) => {
            const resolved = await resolveBlueskyApplication(applicationId)
            if (resolved === undefined) return undefined
            return {
                clientMetadata: resolved.clientMetadata,
                handleResolver: resolved.handleResolver,
            }
        },
    }
}
