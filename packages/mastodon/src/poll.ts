import type { ChannelProfileValidationAdapter } from '@postbot/core'

export const MASTODON_POLL_LIMITS = {
    maxOptions: 4,
    maxCharactersPerOption: 50,
    minExpiration: 300,
    maxExpiration: 2_629_746,
} as const
export interface MastodonPollLimits {
    readonly maxOptions: number
    readonly maxCharactersPerOption: number
    readonly minExpiration: number
    readonly maxExpiration: number
}
export interface MastodonPollInput {
    readonly options: readonly string[]
    readonly expiresIn: number
    readonly multiple?: boolean
    readonly hideTotals?: boolean
}
export function mastodonPollOptionLength(value: string): number {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length
}
export function readMastodonPoll(value: unknown): MastodonPollInput | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const poll = value as Record<string, unknown>
    if (
        !Array.isArray(poll.options) ||
        !poll.options.every(option => typeof option === 'string') ||
        typeof poll.expiresIn !== 'number' ||
        (poll.multiple !== undefined && typeof poll.multiple !== 'boolean') ||
        (poll.hideTotals !== undefined && typeof poll.hideTotals !== 'boolean')
    )
        return null
    return {
        options: poll.options,
        expiresIn: poll.expiresIn,
        ...(typeof poll.multiple === 'boolean' ? { multiple: poll.multiple } : {}),
        ...(typeof poll.hideTotals === 'boolean' ? { hideTotals: poll.hideTotals } : {}),
    }
}
export function mastodonPollError(
    poll: MastodonPollInput,
    limits: MastodonPollLimits = MASTODON_POLL_LIMITS
): string | null {
    if (poll.options.length < 2 || poll.options.length > limits.maxOptions)
        return 'The poll option count exceeds the supported range'
    if (
        poll.options.some(
            option =>
                !option.trim() || mastodonPollOptionLength(option) > limits.maxCharactersPerOption
        )
    )
        return 'Poll options must be nonblank and within the advertised character limit'
    if (new Set(poll.options).size !== poll.options.length) return 'Poll options must be distinct'
    if (
        !Number.isSafeInteger(poll.expiresIn) ||
        poll.expiresIn < limits.minExpiration ||
        poll.expiresIn > limits.maxExpiration
    )
        return 'The poll duration exceeds the supported range'
    return null
}
export const mastodonChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'mastodon',
    validate(profile, content) {
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.contractId !== 'mastodon' ||
            profile.execution.revision !== 'status-v3' ||
            content.poll === undefined
        )
            return []
        const poll = readMastodonPoll(content.poll)
        const message = poll === null ? 'Enter a valid Mastodon poll' : mastodonPollError(poll)
        if (!message && (!Array.isArray(content.media) || content.media.length === 0)) return []
        return [
            {
                path: '/poll',
                severity: 'error',
                source: 'capability',
                code: 'mastodon.poll_invalid',
                message: message ?? 'Choose a poll or attachments for this publication',
            },
        ]
    },
}
