import { telegramChannelProfile } from '@postdot/telegram'
import { TELEGRAM_EXECUTION_REVISION, TELEGRAM_POLL_EXECUTION_REVISION } from '@postdot/telegram'

import type { ProviderWorkerContext } from '../worker-context'
import { telegramPublisherConnectionPolicy } from './connection-policy'
import { createTelegramProviderAdapter } from './worker'
export const telegramModule = {
    id: 'telegram',
    connection: telegramPublisherConnectionPolicy,
    profile: telegramChannelProfile,
} as const
export const createTelegramAdapters = (_context: ProviderWorkerContext) => [
    createTelegramProviderAdapter(),
    createTelegramProviderAdapter({ revision: TELEGRAM_POLL_EXECUTION_REVISION }),
    createTelegramProviderAdapter({ revision: TELEGRAM_EXECUTION_REVISION }),
]
