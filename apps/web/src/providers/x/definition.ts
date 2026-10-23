import {
    X_MAX_WEIGHTED_POST_LENGTH,
    X_TEXT_COUNTING_ALGORITHM,
    parseXPostText,
} from '@postdot/x/text'

import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import { application } from './application'
import Glyph from './preview-glyph'
import { XWeightedTextCount } from './text-count'

export const xProvider = {
    id: 'x',
    name: 'X',
    suggestedName: 'X.com',
    profileLabel: () => m.channel_x_profile(),
    editor: 'plain',
    application,
    applicationProvider: 'x',
    text: {
        algorithm: X_TEXT_COUNTING_ALGORITHM,
        parse: parseXPostText,
        Count: XWeightedTextCount,
    },
    legacyText: {
        bindingId: 'text',
        maxWeightedLength: X_MAX_WEIGHTED_POST_LENGTH,
        weightedLengthAlgorithm: X_TEXT_COUNTING_ALGORITHM,
    },
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
    preview: { layout: 'social', accountDriven: true, sampleIdentity: true },
} as const satisfies ProviderDefinition
