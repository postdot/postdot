import {
    TELEGRAM_EXECUTION_REVISION,
    TELEGRAM_POLL_EXECUTION_REVISION,
    TELEGRAM_ALBUM_EXECUTION_REVISION,
} from '@postbot/telegram'
import type { TelegramPollInput } from '@postbot/telegram/poll'

/**
 * Relative closing periods offered by default.
 *
 * The published range is wider than this list. A persisted period outside the
 * list stays visible and selectable so an existing publication is never
 * rewritten into a different duration.
 */
export const TELEGRAM_POLL_DURATIONS = [3600, 86400, 604800, 2592000] as const

/**
 * Execution identity, including its supported revision, owns native authoring
 * rules.
 *
 * All supported Telegram revisions are native and share one message budget. A profile
 * that does not declare a native Telegram execution never reaches the Telegram
 * editor.
 */
export function isNativeTelegramProfile(profile: unknown): boolean {
    const execution = telegramExecution(profile)
    if (execution === null) return false
    return (
        execution.revision === TELEGRAM_EXECUTION_REVISION ||
        execution.revision === TELEGRAM_POLL_EXECUTION_REVISION ||
        execution.revision === TELEGRAM_ALBUM_EXECUTION_REVISION
    )
}

/**
 * The poll-capable revisions publish a poll, and only a
 * built-in profile may carry it.
 */
export function isTelegramPollProfile(profile: unknown): boolean {
    if (!isRecord(profile) || profile.origin !== 'built_in') return false
    const execution = telegramExecution(profile)
    if (execution === null) return false
    return (
        execution.revision === TELEGRAM_POLL_EXECUTION_REVISION ||
        execution.revision === TELEGRAM_ALBUM_EXECUTION_REVISION
    )
}

/** A target carries a poll when the destination field holds a poll value. */
export function hasTelegramPoll(target: unknown): boolean {
    return isRecord(target) && target.poll !== undefined
}

/**
 * Telegram counts poll content in UTF-16 code units.
 *
 * The count is deliberately conservative: an astral character spends two units
 * against the published budget instead of one.
 */
export function telegramPollOptionLength(value: string): number {
    return value.length
}

/**
 * Build the stored poll value.
 *
 * A single choice is the default, so the selection flag is written only when
 * it changes the published poll, and an absent closing period leaves the poll
 * open instead of writing an invented duration.
 */
export function telegramPollValue(input: {
    options: readonly string[]
    multiple: boolean
    openPeriod: number | undefined
}): TelegramPollInput {
    return {
        options: input.options,
        ...(input.multiple ? { multiple: true } : {}),
        ...(input.openPeriod === undefined ? {} : { openPeriod: input.openPeriod }),
    }
}

function telegramExecution(profile: unknown): Record<string, unknown> | null {
    if (!isRecord(profile)) return null
    const execution = isRecord(profile.execution) ? profile.execution : null
    if (execution === null) return null
    if (execution.kind !== 'built_in' || execution.contractId !== 'telegram') return null
    return execution
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
