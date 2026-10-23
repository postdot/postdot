import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import { application } from './application'

export const instagramProvider = {
    id: 'instagram',
    name: 'Instagram',
    suggestedName: 'Instagram',
    profileLabel: () => m.channel_instagram_profile(),
    editor: 'plain',
    application,
    applicationProvider: 'instagram',
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_instagram_account({
            username:
                connection.destination?.name ??
                connection.externalAccountName ??
                connection.externalAccountId,
        }),
    accountDetails: connection =>
        m.publisher_instagram_account_id({
            id: connection.destination?.id ?? connection.externalAccountId,
        }),
    connectionHint: () => m.publisher_instagram_professional_account(),
    preview: { layout: 'social', accountDriven: false, sampleIdentity: false },
} as const satisfies ProviderDefinition
