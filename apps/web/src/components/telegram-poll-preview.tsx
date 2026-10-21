import { readTelegramPoll } from '@postdot/telegram/poll'

import { telegramPollDuration } from '@/components/telegram-poll-control'
import * as m from '@/paraglide/messages.js'

/**
 * The Telegram poll as a reader will meet it.
 *
 * The preview shows the question through the message body, the answers, the
 * selection rule, the anonymity Telegram always applies, and the closing
 * period. It never simulates votes, because a publication has none yet.
 */
export function TelegramPollPreview({ poll }: { readonly poll: unknown }) {
    const value = readTelegramPoll(poll)
    if (value === null) return null
    return (
        <div
            data-telegram-poll-preview="true"
            className="mt-4 space-y-2"
            aria-label={m.poll_preview()}>
            {value.options.map((option, index) => (
                <div
                    key={index}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span
                        aria-hidden="true"
                        className={`size-3 shrink-0 border border-muted-foreground ${value.multiple ? 'rounded-xs' : 'rounded-full'}`}
                    />
                    {option || m.poll_option({ number: index + 1 })}
                </div>
            ))}
            <p className="text-xs text-muted-foreground">{m.telegram_poll_anonymous()}</p>
            {value.multiple ? (
                <p className="text-xs text-muted-foreground">{m.poll_multiple()}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
                {value.openPeriod === undefined
                    ? m.telegram_poll_no_closing()
                    : m.poll_closes_after({ duration: telegramPollDuration(value.openPeriod) })}
            </p>
        </div>
    )
}
