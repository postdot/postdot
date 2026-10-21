import type { PublisherConnectionPolicy } from '@postdot/db'

/**
 * The Instagram destination is the professional account that publishes, not
 * the app-scoped identity the application sees. The Graph origin is fixed, so
 * a connection carries no per-channel endpoint.
 */
export const instagramPublisherConnectionPolicy: PublisherConnectionPolicy = {
    defaultDestination: credential => ({
        type: 'account',
        id: credential.externalAccountId,
        name: credential.externalAccountName,
    }),
    validateDestination: destination =>
        destination.type === 'account' &&
        /^[1-9]\d*$/.test(destination.id) &&
        (destination.name === null || destination.name.trim().length > 0),
}
