import { readMastodonPoll } from '@postdot/mastodon/poll'

import * as m from '@/paraglide/messages.js'

import { mastodonPollDuration } from './poll-format'
export function MastodonPollPreview({ poll: value }: { readonly poll: unknown }) {
    const poll = readMastodonPoll(value)
    if (!poll) return null
    return (
        <div
            data-mastodon-poll-preview="true"
            className="mt-4 space-y-2"
            aria-label={m.poll_preview()}>
            {poll.options.map((option, index) => (
                <div
                    key={index}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span
                        aria-hidden="true"
                        className={`size-3 shrink-0 border border-muted-foreground ${poll.multiple ? 'rounded-xs' : 'rounded-full'}`}
                    />
                    {option || m.poll_option({ number: index + 1 })}
                </div>
            ))}
            <p className="text-xs text-muted-foreground">
                {m.poll_closes_after({
                    duration: mastodonPollDuration(poll.expiresIn),
                })}
            </p>
            {poll.hideTotals ? (
                <p className="text-xs text-muted-foreground">{m.poll_hide_totals()}</p>
            ) : null}
        </div>
    )
}
