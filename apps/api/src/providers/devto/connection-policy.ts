import type { PublisherConnectionPolicy } from '@postdot/db'

export const devtoPublisherConnectionPolicy: PublisherConnectionPolicy = {
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
