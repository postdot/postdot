import type { PublisherConnectionPolicy } from '@herald/db'

export const blueskyPublisherConnectionPolicy: PublisherConnectionPolicy = {
    defaultDestination: credential => ({
        type: 'account',
        id: credential.externalAccountId,
        name: credential.externalAccountName,
    }),
    validateDestination: destination =>
        destination.type === 'account' &&
        /^did:[^\s:]+:[^\s]+$/.test(destination.id.trim()) &&
        (destination.name === null || destination.name.trim().length > 0),
}
