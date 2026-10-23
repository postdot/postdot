import { TELEGRAM_MAX_CAPTION_LENGTH, TELEGRAM_MAX_TEXT_LENGTH } from '@postdot/telegram'
import { TELEGRAM_POLL_LIMITS } from '@postdot/telegram/poll'

import {
    hasTelegramPoll,
    isNativeTelegramProfile,
    isTelegramPollProfile,
} from '@/providers/telegram/poll'

/** Execution identity, including its supported revision, owns native authoring rules. */
export function telegramTextLimit(profile: unknown, target?: unknown): number | null {
    if (!isNativeTelegramProfile(profile)) return null
    // A published poll reuses the message field for its question.
    if (isTelegramPollProfile(profile) && hasTelegramPoll(target))
        return TELEGRAM_POLL_LIMITS.maxQuestionLength
    return isRecord(target) && Array.isArray(target.media) && target.media.length > 0
        ? TELEGRAM_MAX_CAPTION_LENGTH
        : TELEGRAM_MAX_TEXT_LENGTH
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
