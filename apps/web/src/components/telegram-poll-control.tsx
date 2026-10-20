import { TELEGRAM_POLL_LIMITS, readTelegramPoll, telegramPollError } from '@postbot/telegram/poll'
import { Button } from '@postbot/ui/components/button'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'

import {
    TELEGRAM_POLL_DURATIONS,
    telegramPollOptionLength,
    telegramPollValue,
} from '@/lib/telegram-poll'
import * as m from '@/paraglide/messages.js'

const noClosingValue = 'none'

export function telegramPollDuration(seconds: number): string {
    if (seconds === 86400) return m.poll_one_day()
    if (seconds === 3600) return m.poll_one_hour()
    if (seconds % 86400 === 0) return m.poll_days({ count: seconds / 86400 })
    if (seconds % 3600 === 0) return m.poll_hours({ count: seconds / 3600 })
    if (seconds % 60 === 0) return m.poll_minutes({ count: seconds / 60 })
    return m.poll_seconds({ count: seconds })
}

export function TelegramPollControl({
    value,
    disabled,
    fieldId,
    question,
    onChange,
    error,
}: {
    value: unknown
    disabled: boolean
    fieldId: string
    question: string
    onChange: (value: unknown | undefined) => void
    error?: string
}) {
    const poll = readTelegramPoll(value)
    const enabled = value !== undefined
    const options = poll?.options ?? ['', '']
    const multiple = poll?.multiple === true
    const openPeriod = poll?.openPeriod
    const invalid = poll === null || telegramPollError(question, poll) !== null

    const update = (next: {
        options: readonly string[]
        multiple: boolean
        openPeriod: number | undefined
    }) => onChange(telegramPollValue(next))

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
                        onChange(event.target.checked ? { options: ['', ''] } : undefined)
                    }
                />
                {m.poll_add()}
            </label>
            {enabled ? (
                <>
                    <p className="text-xs text-muted-foreground">
                        {m.telegram_poll_question_hint()}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.telegram_poll_no_media()}</p>
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
                                        aria-invalid={
                                            telegramPollOptionLength(option) >
                                            TELEGRAM_POLL_LIMITS.maxOptionLength
                                                ? true
                                                : undefined
                                        }
                                        onChange={event =>
                                            update({
                                                options: options.map((text, position) =>
                                                    position === index ? event.target.value : text
                                                ),
                                                multiple,
                                                openPeriod,
                                            })
                                        }
                                    />
                                    {options.length > 1 ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            aria-label={m.poll_remove_option({ number: index + 1 })}
                                            onClick={() =>
                                                update({
                                                    options: options.filter(
                                                        (_, position) => position !== index
                                                    ),
                                                    multiple,
                                                    openPeriod,
                                                })
                                            }>
                                            {m.common_remove()}
                                        </Button>
                                    ) : null}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {telegramPollOptionLength(option)}/
                                    {TELEGRAM_POLL_LIMITS.maxOptionLength}
                                </p>
                            </div>
                        ))}
                    </div>
                    {options.length < TELEGRAM_POLL_LIMITS.maxOptions ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                                update({ options: [...options, ''], multiple, openPeriod })
                            }>
                            {m.poll_add_option()}
                        </Button>
                    ) : null}
                    <div className="space-y-1">
                        <label id={`${fieldId}-duration-label`} className="text-xs">
                            {m.poll_duration()}
                        </label>
                        <Select
                            value={openPeriod === undefined ? noClosingValue : String(openPeriod)}
                            onValueChange={selected => {
                                if (!selected) return
                                update({
                                    options,
                                    multiple,
                                    openPeriod:
                                        selected === noClosingValue ? undefined : Number(selected),
                                })
                            }}>
                            <SelectTrigger aria-labelledby={`${fieldId}-duration-label`}>
                                <SelectValue>
                                    {openPeriod === undefined
                                        ? m.telegram_poll_no_closing()
                                        : telegramPollDuration(openPeriod)}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={noClosingValue}>
                                    {m.telegram_poll_no_closing()}
                                </SelectItem>
                                {[
                                    ...new Set([
                                        ...TELEGRAM_POLL_DURATIONS,
                                        ...(openPeriod === undefined ? [] : [openPeriod]),
                                    ]),
                                ]
                                    .sort((left, right) => left - right)
                                    .map(duration => (
                                        <SelectItem key={duration} value={String(duration)}>
                                            {telegramPollDuration(duration)}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={multiple}
                            onChange={event =>
                                update({
                                    options,
                                    multiple: event.target.checked,
                                    openPeriod,
                                })
                            }
                        />
                        {m.poll_multiple()}
                    </label>
                    <p className="text-xs text-muted-foreground">{m.telegram_poll_anonymous()}</p>
                    {invalid ? (
                        <p className="text-sm text-state-failed">{m.telegram_poll_invalid()}</p>
                    ) : null}
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
