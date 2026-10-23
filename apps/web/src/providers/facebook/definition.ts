import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import Glyph from '../linkedin/preview-glyph'
import { application } from './application'
import Footer from './preview-footer'

export const facebookProvider = {
    id: 'facebook',
    name: 'Facebook',
    suggestedName: 'Facebook',
    profileLabel: () => m.provider_apps_provider_facebook(),
    editor: 'plain',
    application,
    applicationProvider: 'facebook',
    Glyph,
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_facebook_page({
            account:
                connection.destination?.name ??
                connection.externalAccountName ??
                connection.externalAccountId,
        }),
    preview: { layout: 'social', accountDriven: true, sampleIdentity: false, Footer },
} as const satisfies ProviderDefinition
