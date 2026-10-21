import {
    MASTODON_POLL_LIMITS,
    mastodonPollOptionLength,
    readMastodonPoll,
} from '@postdot/mastodon/poll'
import { Button } from '@postdot/ui/components/button'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'

import * as m from '@/paraglide/messages.js'

const durations = [300, 1800, 3600, 21600, 86400, 259200, 604800, 2592000]
export function mastodonPollDuration(seconds: number): string {
    if (seconds === 86400) return m.poll_one_day()
    if (seconds === 3600) return m.poll_one_hour()
    if (seconds % 86400 === 0) return m.poll_days({ count: seconds / 86400 })
    if (seconds % 3600 === 0) return m.poll_hours({ count: seconds / 3600 })
    if (seconds % 60 === 0) return m.poll_minutes({ count: seconds / 60 })
    return m.poll_seconds({ count: seconds })
}
export function MastodonPollControl({
    value,
    disabled,
    fieldId,
    onChange,
    error,
}: {
    value: unknown
    disabled: boolean
    fieldId: string
    onChange: (value: unknown | undefined) => void
    error?: string
}) {
    const poll = readMastodonPoll(value)
    const enabled = value !== undefined
    const options = poll?.options ?? ['', '']
    const patch = (change: object) =>
        onChange({ ...poll, options, expiresIn: poll?.expiresIn ?? 86400, ...change })
    return (
        <fieldset
            disabled={disabled}
            className="min-w-0 space-y-3 rounded-md bg-surface-inset/35 p-3"
            aria-describedby={error ? `${fieldId}-error` : undefined}>
            <legend className="sr-only">{m.poll_title()}</legend>
            <label
                className="flex items-center gap-2 text-sm font-medium"
                htmlFor={`${fieldId}-enabled`}>
                <input
                    id={`${fieldId}-enabled`}
                    type="checkbox"
                    checked={enabled}
                    onChange={event =>
                        onChange(
                            event.target.checked
                                ? {
                                      options: ['', ''],
                                      expiresIn: 86400,
                                      multiple: false,
                                      hideTotals: false,
                                  }
                                : undefined
                        )
                    }
                />
                {m.poll_add()}
            </label>
            {enabled ? (
                <>
                    <p className="text-xs text-muted-foreground">{m.poll_no_media()}</p>
                    <div className="space-y-3">
                        {options.map((option, index) => (
                            <div key={index} className="space-y-1">
                                <label htmlFor={`${fieldId}-option-${index}`} className="text-xs">
                                    {m.poll_option({ number: index + 1 })}
                                </label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id={`${fieldId}-option-${index}`}
                                        value={option}
                                        maxLength={3000}
                                        aria-invalid={
                                            mastodonPollOptionLength(option) >
                                                MASTODON_POLL_LIMITS.maxCharactersPerOption ||
                                            undefined
                                        }
                                        onChange={event =>
                                            patch({
                                                options: options.map((text, position) =>
                                                    position === index ? event.target.value : text
                                                ),
                                            })
                                        }
                                    />
                                    {options.length > 2 ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            aria-label={m.poll_remove_option({ number: index + 1 })}
                                            onClick={() =>
                                                patch({
                                                    options: options.filter(
                                                        (_, position) => position !== index
                                                    ),
                                                })
                                            }>
                                            {m.common_remove()}
                                        </Button>
                                    ) : null}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {mastodonPollOptionLength(option)}/
                                    {MASTODON_POLL_LIMITS.maxCharactersPerOption}
                                </p>
                            </div>
                        ))}
                    </div>
                    {options.length < MASTODON_POLL_LIMITS.maxOptions ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => patch({ options: [...options, ''] })}>
                            {m.poll_add_option()}
                        </Button>
                    ) : null}
                    <div className="space-y-1">
                        <label id={`${fieldId}-duration-label`} className="text-xs">
                            {m.poll_duration()}
                        </label>
                        <Select
                            value={String(poll?.expiresIn ?? 86400)}
                            onValueChange={selected => {
                                if (selected) patch({ expiresIn: Number(selected) })
                            }}>
                            <SelectTrigger aria-labelledby={`${fieldId}-duration-label`}>
                                <SelectValue>
                                    {mastodonPollDuration(poll?.expiresIn ?? 86400)}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {[...new Set([...durations, poll?.expiresIn ?? 86400])]
                                    .sort((a, b) => a - b)
                                    .map(duration => (
                                        <SelectItem key={duration} value={String(duration)}>
                                            {mastodonPollDuration(duration)}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={poll?.multiple ?? false}
                            onChange={event => patch({ multiple: event.target.checked })}
                        />
                        {m.poll_multiple()}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={poll?.hideTotals ?? false}
                            onChange={event => patch({ hideTotals: event.target.checked })}
                        />
                        {m.poll_hide_totals()}
                    </label>
                    {!poll ? <p className="text-sm text-state-failed">{m.poll_invalid()}</p> : null}
                </>
            ) : null}
            {error ? (
                <p id={`${fieldId}-error`} role="alert" className="text-sm text-state-failed">
                    {error}
                </p>
            ) : null}
        </fieldset>
    )
}
