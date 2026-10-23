import { readMastodonPoll } from '@postdot/mastodon/poll'

import paths from '@/assets/platform-preview-icons/paths.json'
import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import { safeSameOrigin } from '../safe-link'
import { mastodonPollDuration } from './poll-format'
import { MastodonPollPreview } from './poll-preview'

export const mastodonProvider = {
    id: 'mastodon',
    name: 'Mastodon',
    suggestedName: 'Mastodon',
    profileLabel: () => m.channel_mastodon_profile(),
    editor: 'plain',
    fields: [
        {
            kind: 'provider:mastodon:poll',
            path: '/poll',
            label: locale => m.poll_title({}, { locale }),
            supports: (profile: unknown) => {
                if (typeof profile !== 'object' || profile === null || !('execution' in profile))
                    return false
                const execution = profile.execution
                return (
                    typeof execution === 'object' &&
                    execution !== null &&
                    'kind' in execution &&
                    execution.kind === 'built_in' &&
                    'contractId' in execution &&
                    execution.contractId === 'mastodon' &&
                    'revision' in execution &&
                    execution.revision === 'status-v3'
                )
            },
            loadControl: () =>
                import('./poll-control').then(module => ({ default: module.MastodonPollControl })),
            summarize: value => {
                const poll = readMastodonPoll(value)
                return poll
                    ? [
                          ...poll.options.map((option, index) => `${index + 1}. ${option}`),
                          m.poll_closes_after({ duration: mastodonPollDuration(poll.expiresIn) }),
                          ...(poll.multiple ? [m.poll_multiple()] : []),
                          ...(poll.hideTotals ? [m.poll_hide_totals()] : []),
                      ].join('\n')
                    : '—'
            },
        },
    ],
    glyphs: {
        reply: paths.mastodon_reply,
        repost: paths.mastodon_repost,
        like: paths.mastodon_like,
        share: paths.mastodon_share,
    },
    analytics: {
        legacyProfileIdentity: false,
        metrics: [
            { key: 'favourites_count', label: () => m.performance_favourites() },
            { key: 'reblogs_count', label: () => m.performance_boosts() },
            { key: 'replies_count', label: () => m.performance_replies() },
        ],
        listLatest: async (reader, projectId, ids) => {
            const read = reader.listLatestMastodonProviderAnalytics
            if (!read) throw new Error('Provider analytics reader is unavailable')
            return read(projectId, ids)
        },
        collect: async (reader, projectId, channelId, publicationId) => {
            const collect = reader.collectMastodonProviderAnalytics
            if (!collect) throw new Error('Provider analytics collector is unavailable')
            return collect(projectId, channelId, publicationId)
        },
    },
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_account({
            provider: 'Mastodon',
            account:
                connection.destination?.name ??
                connection.externalAccountName ??
                connection.externalAccountId,
        }),
    preview: {
        layout: 'social',
        accountDriven: true,
        sampleIdentity: true,
        mosaic: 'tight',
        handle: '@alex@example.social',
        Poll: MastodonPollPreview,
    },
    comments: {
        countUnit: 'utf16',
        inspectable: (externalId: string, externalUrl: string | null) => Boolean(externalUrl),
        textLimit: 500,
        maxLength: 500,
        count: (text: string) => text.length,
        linkAllowed: (url: string, origin: string | null) => safeSameOrigin(url, origin),
    },
} as const satisfies ProviderDefinition
