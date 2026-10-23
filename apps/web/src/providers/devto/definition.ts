import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'

export const devtoProvider = {
    id: 'devto',
    name: 'DEV.to',
    suggestedName: 'DEV.to',
    profileLabel: () => m.channel_devto_profile(),
    authoring: { preserveEmptyHeadline: true },
    editor: 'article',
    analytics: {
        legacyProfileIdentity: true,
        metrics: [
            { key: 'page_views', label: () => m.performance_views() },
            { key: 'reactions', label: () => m.performance_reactions() },
            { key: 'comments', label: () => m.performance_comments() },
        ],
        listLatest: async (reader, projectId, ids) => {
            const read = reader.listLatestDevtoProviderAnalytics
            if (!read) throw new Error('Provider analytics reader is unavailable')
            return read(projectId, ids)
        },
        collect: async (reader, projectId, channelId, publicationId) => {
            const collect = reader.collectDevtoProviderAnalytics
            if (!collect) throw new Error('Provider analytics collector is unavailable')
            return collect(projectId, channelId, publicationId)
        },
    },
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_account({
            provider: 'DEV.to',
            account:
                connection.destination?.name ??
                connection.externalAccountName ??
                connection.externalAccountId,
        }),
    preview: { layout: 'article', accountDriven: true, sampleIdentity: true },
} as const satisfies ProviderDefinition
