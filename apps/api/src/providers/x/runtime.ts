import { clientSecretBasic, type OAuthAuthorizationServer } from '@postdot/oauth'
import {
    X_OAUTH_AUTHORIZATION_ENDPOINT,
    X_OAUTH_ISSUER,
    X_OAUTH_TOKEN_ENDPOINT,
    createXPublisher,
    type XPublisher,
} from '@postdot/x'

import type { ProviderRuntimeContext } from '../runtime-context'
export interface XRuntimeOptions {
    readonly x?: {
        readonly clientId: string
        readonly clientSecret: string
        readonly authorizationServer?: OAuthAuthorizationServer
        readonly publisher?: XPublisher
    }
}
const defaultXAuthorizationServer: OAuthAuthorizationServer = {
    issuer: X_OAUTH_ISSUER,
    authorizationEndpoint: X_OAUTH_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: X_OAUTH_TOKEN_ENDPOINT,
    pkce: 'required',
}
export function createXRuntime({ options, providerApplicationStore }: ProviderRuntimeContext) {
    const xCallbackUri = new URL('/api/oauth/x/callback', options.apiOrigin).toString()
    const x =
        options.x === undefined
            ? undefined
            : {
                  ...options.x,
                  authorizationServer: options.x.authorizationServer ?? defaultXAuthorizationServer,
                  clientAuthentication: clientSecretBasic(options.x.clientSecret),
                  publisher: options.x.publisher ?? createXPublisher(),
                  callbackUri: xCallbackUri,
              }

    async function resolveXApplication(applicationId?: string | null) {
        if (applicationId === null) {
            return x === undefined ? undefined : { applicationId: null, ...x }
        }
        const configured = await providerApplicationStore.resolveProviderApplication(
            'x',
            applicationId
        )
        if (configured !== null) {
            if (configured.clientId === null || configured.clientSecret === null) return undefined
            return {
                applicationId: configured.id,
                clientId: configured.clientId,
                clientSecret: configured.clientSecret,
                authorizationServer: options.x?.authorizationServer ?? defaultXAuthorizationServer,
                clientAuthentication: clientSecretBasic(configured.clientSecret),
                publisher: options.x?.publisher ?? createXPublisher(),
                callbackUri: xCallbackUri,
            }
        }
        if (applicationId !== undefined && applicationId !== null) return undefined
        if (providerApplicationStore.hasProviderApplication('x')) return undefined
        return x === undefined ? undefined : { applicationId: null, ...x }
    }

    return {
        x,
        xCallbackUri,
        resolveXApplication,
        resolveXOAuth: async (applicationId?: string | null) => {
            const resolved = await resolveXApplication(applicationId)
            if (resolved === undefined) return undefined
            return {
                clientId: resolved.clientId,
                clientAuthentication: resolved.clientAuthentication,
                authorizationServer: resolved.authorizationServer,
            }
        },
    }
}
