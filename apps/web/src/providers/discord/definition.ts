import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'

export const discordProvider = {
    id: 'discord',
    name: 'Discord',
    suggestedName: 'Discord',
    profileLabel: () => m.channel_discord_profile(),
    editor: 'discord',
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_channel({
            provider: 'Discord',
            account:
                connection.destination?.name ??
                connection.destination?.id ??
                connection.externalAccountId,
        }),
    preview: { layout: 'message', accountDriven: true, sampleIdentity: true },
} as const satisfies ProviderDefinition
