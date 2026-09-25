import twitterText from 'twitter-text'

export const X_MAX_WEIGHTED_POST_LENGTH = 280
export const X_MAX_RAW_POST_TEXT_LENGTH = 1_000_000
export const X_TEXT_COUNTING_ALGORITHM = 'twitter-text-v3'

export interface XWeightedTextResult {
    readonly weightedLength: number | null
    readonly valid: boolean
    readonly hasInvalidCharacters: boolean
}

/** Parse text with twitter-text's v3 default configuration, used by X. */
export function parseXPostText(text: string): XWeightedTextResult {
    const normalized = text.normalize('NFC')
    const parsed = twitterText.parseTweet(normalized)
    const invalidCharacters =
        twitterText.hasInvalidCharacters(normalized) || !Number.isFinite(parsed.weightedLength)
    const weightedLength = Number.isFinite(parsed.weightedLength) ? parsed.weightedLength : null

    return {
        weightedLength,
        valid: text.trim().length > 0 && parsed.valid && !invalidCharacters,
        hasInvalidCharacters: invalidCharacters,
    }
}

/** Returns true when the post text fits X's weighted length and character rules. */
export function isXPostTextValid(text: string): boolean {
    return parseXPostText(text).valid
}
