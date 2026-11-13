import { postdotClientIpHeader } from '@postdot/auth'
import { Elysia } from 'elysia'

import { createClientIpResolver, InvalidForwardedAddress } from '../client-ip'
import { requestPeerAddress } from '../serving'

export function createClientIpPolicy(trustedProxies: readonly string[] = []) {
    const resolve = createClientIpResolver(trustedProxies)
    return new Elysia({ name: 'postdot-client-ip' })
        .request(({ request, status }) => {
            // This header is owned by the socket boundary, never by a caller.
            request.headers.delete(postdotClientIpHeader)
            try {
                const address = resolve(
                    requestPeerAddress(request),
                    request.headers.get('x-forwarded-for')
                )
                if (address !== null) request.headers.set(postdotClientIpHeader, address)
            } catch (error) {
                if (!(error instanceof InvalidForwardedAddress)) throw error
                return status(400, {
                    error: { code: 'invalid_forwarded_address', message: error.message },
                })
            }
        })
        .as('global')
}
