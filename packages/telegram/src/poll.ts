/**
 * Telegram native poll contract.
 *
 * The limits mirror the Bot API `sendPoll` documentation: a question of 1 to
 * 300 characters, 1 to 12 answer options of 1 to 100 characters each, and an
 * optional auto-closing period of 5 to 2628000 seconds. Only anonymous regular
 * polls are supported; quiz polls and poll media are out of scope.
 */
export const TELEGRAM_POLL_LIMITS = {
    minOptions: 1,
    maxOptions: 12,
    maxQuestionLength: 300,
    maxOptionLength: 100,
    minOpenPeriod: 5,
    maxOpenPeriod: 2628000,
} as const

export interface TelegramPollInput {
    readonly options: readonly string[]
    readonly multiple?: boolean
    readonly openPeriod?: number
}

const pollKeys = new Set(['options', 'multiple', 'openPeriod'])

/**
 * Read a poll draft without judging its content.
 *
 * The reader keeps editable values, including blank option strings, so an
 * editor can hold an incomplete draft and show a precise validation message
 * instead of silently dropping it. Anything that is not a poll shape at all,
 * including unknown fields, wrong types, or an impossible option count, reads
 * as `null`.
 */
export function readTelegramPoll(value: unknown): TelegramPollInput | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const poll = value as Record<string, unknown>
    if (Object.keys(poll).some(key => !pollKeys.has(key))) return null
    if (!Array.isArray(poll.options)) return null
    if (!poll.options.every(option => typeof option === 'string')) return null
    if (poll.options.length < TELEGRAM_POLL_LIMITS.minOptions) return null
    if (poll.options.length > TELEGRAM_POLL_LIMITS.maxOptions) return null
    if (poll.multiple !== undefined && typeof poll.multiple !== 'boolean') return null
    if (poll.openPeriod !== undefined && typeof poll.openPeriod !== 'number') return null
    return {
        options: [...poll.options],
        ...(typeof poll.multiple === 'boolean' ? { multiple: poll.multiple } : {}),
        ...(typeof poll.openPeriod === 'number' ? { openPeriod: poll.openPeriod } : {}),
    }
}

/**
 * Validate a poll against the Bot API bounds.
 *
 * The question is the publication text, so it is checked next to the options.
 * Lengths use the conservative UTF-16 code-unit budget the message path
 * already applies to Telegram text.
 */
export function telegramPollError(question: string, poll: TelegramPollInput): string | null {
    if (typeof question !== 'string' || !question.trim()) return 'Enter a poll question'
    if (question.length > TELEGRAM_POLL_LIMITS.maxQuestionLength)
        return 'The poll question exceeds the 300 UTF-16 code-unit budget'
    if (poll === null || typeof poll !== 'object' || !Array.isArray(poll.options))
        return 'Enter a valid Telegram poll'
    if (Object.keys(poll).some(key => !pollKeys.has(key))) return 'Enter a valid Telegram poll'
    if (!poll.options.every(option => typeof option === 'string'))
        return 'Enter a valid Telegram poll'
    if (
        poll.options.length < TELEGRAM_POLL_LIMITS.minOptions ||
        poll.options.length > TELEGRAM_POLL_LIMITS.maxOptions
    )
        return 'A Telegram poll needs between 1 and 12 options'
    if (poll.options.some(option => !option.trim())) return 'Poll options must not be blank'
    if (poll.options.some(option => option.length > TELEGRAM_POLL_LIMITS.maxOptionLength))
        return 'Poll options exceed the 100 UTF-16 code-unit budget'
    if (poll.multiple !== undefined && typeof poll.multiple !== 'boolean')
        return 'Enter a valid Telegram poll'
    if (
        poll.openPeriod !== undefined &&
        (!Number.isSafeInteger(poll.openPeriod) ||
            poll.openPeriod < TELEGRAM_POLL_LIMITS.minOpenPeriod ||
            poll.openPeriod > TELEGRAM_POLL_LIMITS.maxOpenPeriod)
    )
        return 'The poll auto-closing period must be a whole number of seconds between 5 and 2628000'
    return null
}
