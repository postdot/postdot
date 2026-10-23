import type { PublisherConnectionPolicy } from '@postdot/db'

export const linkedInPublisherConnectionPolicy: PublisherConnectionPolicy = {
    defaultDestination: credential => ({
        type: 'member',
        id: credential.externalAccountId,
        name: credential.externalAccountName,
    }),
    validateDestination: destination =>
        (destination.type === 'member' || destination.type === 'organization') &&
        destination.id.trim().length > 0 &&
        !/\s/.test(destination.id) &&
        !destination.id.startsWith('urn:') &&
        (destination.type !== 'organization' || /^[1-9]\d*$/.test(destination.id)) &&
        (destination.name === null || destination.name.trim().length > 0),
}
