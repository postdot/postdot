import { readTelegramPoll } from '@postdot/telegram/poll'

import * as m from '@/paraglide/messages.js'

import type { ProviderDefinition } from '../contract'
import { isTelegramPollProfile } from './poll'
import { telegramPollDuration } from './poll-format'
import { TelegramPollPreview } from './poll-preview'
import { telegramTextLimit } from './text-rules'

export const telegramProvider = {
    id: 'telegram',
    name: 'Telegram',
    suggestedName: 'Telegram',
    profileLabel: () => m.channel_telegram_profile(),
    editor: 'plain',
    textLimit: telegramTextLimit,
    fields: [
        {
            kind: 'provider:telegram:poll',
            path: '/poll',
            label: locale => m.poll_title({}, { locale }),
            supports: isTelegramPollProfile,
            loadControl: () =>
                import('./poll-control').then(module => ({ default: module.TelegramPollControl })),
            summarize: value => {
                const poll = readTelegramPoll(value)
                return poll
                    ? [
                          ...poll.options.map((option, index) => `${index + 1}. ${option}`),
                          m.telegram_poll_anonymous(),
                          ...(poll.multiple ? [m.poll_multiple()] : []),
                          poll.openPeriod === undefined
                              ? m.telegram_poll_no_closing()
                              : m.poll_closes_after({
                                    duration: telegramPollDuration(poll.openPeriod),
                                }),
                      ].join('\n')
                    : '—'
            },
        },
    ],
    loadConnection: () => import('./connection'),
    accountLabel: connection =>
        m.publisher_channel({
            provider: 'Telegram',
            account:
                connection.destination?.name ??
                connection.destination?.id ??
                connection.externalAccountId,
        }),
    preview: {
        layout: 'social',
        accountDriven: false,
        sampleIdentity: false,
        Poll: TelegramPollPreview,
    },
} as const satisfies ProviderDefinition
