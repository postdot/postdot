import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import { application } from './application'
import SampleEngagement from './preview-engagement'
import Footer from './preview-footer'
import Glyph from './preview-glyph'

export const linkedinProvider = {
    id: 'linkedin',
    templateUpgrade: { revision: 'member-post-v2', presetId: 'linkedin' },
    markerClassName: 'text-primary',
    name: 'LinkedIn',
    suggestedName: 'LinkedIn',
    profileLabel: () => m.channel_linkedin_profile(),
    editor: 'plain',
    application,
    applicationProvider: 'linkedin',
    Glyph,
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        connection.destination?.type === 'organization'
            ? m.publisher_page({
                  account: connection.destination.name ?? connection.destination.id,
              })
            : m.publisher_member({
                  account: connection.externalAccountName ?? connection.externalAccountId,
              }),
    preview: {
        layout: 'professional',
        accountDriven: true,
        sampleIdentity: true,
        Footer,
        SampleEngagement,
        footerClassName: 'gap-1 px-3 pb-2 pt-2 text-[11px] text-[#61666b]',
    },
} as const satisfies ProviderDefinition
