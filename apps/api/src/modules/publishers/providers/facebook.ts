import type { PublisherConnectionPolicy } from '@postdot/db'

export const facebookPublisherConnectionPolicy: PublisherConnectionPolicy = {
    validateDestination: value =>
        value.type === 'channel' &&
        /^[1-9]\d*$/.test(value.id) &&
        (value.name === null || value.name.trim().length > 0),
}
