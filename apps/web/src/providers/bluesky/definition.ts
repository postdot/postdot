import paths from '@/assets/platform-preview-icons/paths.json'
import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import { safeSameOrigin } from '../safe-link'
import { application } from './application'

export const blueskyProvider = {
    id: 'bluesky',
    name: 'Bluesky',
    suggestedName: 'Bluesky',
    profileLabel: () => m.channel_bluesky_profile(),
    editor: 'plain',
    application,
    applicationProvider: 'bluesky',
    glyphs: {
        reply: paths.bluesky_reply,
        repost: paths.bluesky_repost,
        like: paths.bluesky_like,
        share: paths.bluesky_share,
    },
    analytics: {
        legacyProfileIdentity: true,
        metrics: [
            { key: 'likeCount', label: () => m.performance_likes() },
            { key: 'replyCount', label: () => m.performance_replies() },
            { key: 'repostCount', label: () => m.performance_reposts() },
            { key: 'quoteCount', label: () => m.performance_quotes() },
            { key: 'bookmarkCount', label: () => m.performance_bookmarks() },
        ],
        listLatest: async (reader, projectId, ids) => {
            const read = reader.listLatestBlueskyProviderAnalytics
            if (!read) throw new Error('Provider analytics reader is unavailable')
            return read(projectId, ids)
        },
        collect: async (reader, projectId, channelId, publicationId) => {
            const collect = reader.collectBlueskyProviderAnalytics
            if (!collect) throw new Error('Provider analytics collector is unavailable')
            return collect(projectId, channelId, publicationId)
        },
    },
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_account({
            provider: 'Bluesky',
            account:
                connection.destination?.name ??
                connection.externalAccountName ??
                connection.externalAccountId,
        }),
    preview: {
        layout: 'social',
        accountDriven: true,
        sampleIdentity: true,
        mosaic: 'spaced',
        handle: '@alex.example.com',
    },
    comments: {
        countUnit: 'graphemes',
        inspectable: (externalId: string, _externalUrl: string | null) =>
            externalId.startsWith('at://'),
        textLimit: 300,
        maxLength: 3000,
        count: (text: string) =>
            [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length,
        linkAllowed: (url: string) => safeSameOrigin(url, 'https://bsky.app'),
    },
} as const satisfies ProviderDefinition
