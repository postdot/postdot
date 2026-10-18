import {
    TELEGRAM_EXECUTION_REVISION,
    TELEGRAM_MAX_CAPTION_LENGTH,
    TELEGRAM_MAX_TEXT_LENGTH,
} from '@postbot/telegram'

/** Execution identity, including its supported revision, owns native authoring rules. */
export function telegramTextLimit(profile: unknown, target?: unknown): number | null {
    if (
        !record(profile) ||
        !record(profile.execution) ||
        profile.execution.kind !== 'built_in' ||
        profile.execution.contractId !== 'telegram' ||
        profile.execution.revision !== TELEGRAM_EXECUTION_REVISION
    )
        return null
    return record(target) && Array.isArray(target.media) && target.media.length > 0
        ? TELEGRAM_MAX_CAPTION_LENGTH
        : TELEGRAM_MAX_TEXT_LENGTH
}
function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
