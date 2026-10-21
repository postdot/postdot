import type { PublisherConnectionPolicy } from '@postdot/db'
import { isTelegramChannelId } from '@postdot/telegram'

export const telegramPublisherConnectionPolicy: PublisherConnectionPolicy = {
    validateDestination: destination =>
        destination.type === 'channel' &&
        isTelegramChannelId(destination.id) &&
        (destination.name === null || destination.name.trim().length > 0),
}
