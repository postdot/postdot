import type { PublisherConnectionPolicy } from '@herald/db'
import { normalizeMastodonInstanceOrigin } from '@herald/mastodon'

export const mastodonPublisherConnectionPolicy: PublisherConnectionPolicy = {
    endpointUrlRequired: true,
    normalizeEndpointUrl(endpointUrl) {
        try {
            return normalizeMastodonInstanceOrigin(endpointUrl)
        } catch {
            return null
        }
    },
    defaultDestination: credential => ({
        type: 'account',
        id: credential.externalAccountId,
        name: credential.externalAccountName,
    }),
    validateDestination: destination =>
        destination.type === 'account' &&
        destination.id.trim().length > 0 &&
        !/\s/.test(destination.id) &&
        (destination.name === null || destination.name.trim().length > 0),
}
