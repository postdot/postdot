import { discordChannelProfile } from '@postdot/discord'
import { DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION } from '@postdot/discord'

import type { ProviderWorkerContext } from '../worker-context'
import { discordPublisherConnectionPolicy } from './connection-policy'
import { createDiscordProviderAdapter } from './worker'
export const discordModule = {
    id: 'discord',
    connection: discordPublisherConnectionPolicy,
    profile: discordChannelProfile,
} as const
export const createDiscordAdapters = (_context: ProviderWorkerContext) => [
    createDiscordProviderAdapter({ revision: DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION }),
    createDiscordProviderAdapter(),
]
