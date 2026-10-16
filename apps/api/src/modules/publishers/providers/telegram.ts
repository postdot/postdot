import type { PublisherConnectionPolicy } from '@postbot/db'
import { isTelegramChannelId } from '@postbot/telegram'

export const telegramPublisherConnectionPolicy: PublisherConnectionPolicy = {
    validateDestination: destination =>
        destination.type === 'channel' &&
        isTelegramChannelId(destination.id) &&
        (destination.name === null || destination.name.trim().length > 0),
}
