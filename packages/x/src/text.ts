/**
 * X-compatible weighted post-text validation.
 *
 * This implements the counting rules of the twitter-text weighted configuration
 * (v3: 280 maximum weighted length, scale 100, default weight 200, transformed
 * URL length 23, emoji parsing enabled) as used by X to validate post text:
 *
 * - Text is normalized to Unicode NFC before counting.
 * - Each extracted URL counts 23 characters (the t.co wrapped length),
 *   regardless of its actual length.
 * - Each emoji counts 2 characters, including zero-width-joiner clusters,
 *   skin-tone modifiers, flags, and keycaps.
 * - Characters in the Latin-oriented ranges (U+0000-U+10FF plus selected
 *   punctuation blocks) count 1 character; everything else (including CJK)
 *   counts 2 characters.
 *
 * Documented approximations relative to twitter-text: URL extraction uses a
 * practical matcher (http/https URLs terminated by whitespace, quotes,
 * angle brackets, or CJK text, with trailing-punctuation trimming) instead of
 * the full twitter-text extractor, and the invalid-character set covers C0
 * controls (except tab, LF, CR), DEL, and U+FFFE/U+FFFF rather than the full
 * directional-formatting set. Texts that are borderline under this
 * implementation remain subject to the provider's authoritative validation.
 */

export const X_MAX_WEIGHTED_POST_LENGTH = 280
export const X_WEIGHT_SCALE = 100
export const X_DEFAULT_CHAR_WEIGHT = 200
export const X_TRANSFORMED_URL_LENGTH = 23

interface WeightedRange {
    readonly start: number
    readonly end: number
    readonly weight: number
}

const X_WEIGHTED_RANGES: readonly WeightedRange[] = [
    { start: 0, end: 4351, weight: 100 },
    { start: 8192, end: 8205, weight: 100 },
    { start: 8208, end: 8223, weight: 100 },
    { start: 8242, end: 8247, weight: 100 },
]

const X_SCALED_URL_WEIGHT = X_TRANSFORMED_URL_LENGTH * X_WEIGHT_SCALE

const URL_PATTERN =
    /https?:\/\/[^\s<>"'`\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]+/gu

const TRAILING_URL_PUNCTUATION = /[.,;:!?)\]}'"]+$/u

const EMOJI_CLUSTER_PATTERN = new RegExp(
    '(?:\\p{RI}\\p{RI}' +
        '|[#*0-9]\\uFE0F?\\u20E3' +
        '|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2}\\u{E007F}' +
        '|\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*' +
        '(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*)*)',
    'gu'
)

/**
 * Conservative subset of the twitter-text invalid set: C0 controls (except
 * tab, LF, CR), DEL, and the U+FFFE/U+FFFF noncharacters. Rejected by the X
 * API; texts containing them are never valid.
 */
function isInvalidCodePoint(codePoint: number): boolean {
    return (
        codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f ||
        codePoint === 0xfffe ||
        codePoint === 0xffff
    )
}

export interface XWeightedTextResult {
    readonly weightedLength: number
    readonly valid: boolean
    readonly hasInvalidCharacters: boolean
}

interface TextEntity {
    readonly start: number
    readonly end: number
}

function trimTrailingPunctuation(url: string): string {
    let trimmed = url.replace(TRAILING_URL_PUNCTUATION, '')
    while (trimmed.endsWith(')') && countChar(trimmed, '(') < countChar(trimmed, ')')) {
        trimmed = trimmed.slice(0, -1)
    }
    return trimmed
}

function countChar(value: string, character: string): number {
    let count = 0
    for (const current of value) {
        if (current === character) count += 1
    }
    return count
}

function extractUrls(text: string): TextEntity[] {
    const entities: TextEntity[] = []
    URL_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = URL_PATTERN.exec(text)) !== null) {
        const raw = match[0]
        const trimmed = trimTrailingPunctuation(raw)
        if (trimmed.length === 0) continue
        entities.push({ start: match.index, end: match.index + trimmed.length })
    }
    return entities
}

function extractEmojiClusters(text: string): TextEntity[] {
    const entities: TextEntity[] = []
    EMOJI_CLUSTER_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = EMOJI_CLUSTER_PATTERN.exec(text)) !== null) {
        entities.push({ start: match.index, end: match.index + match[0].length })
    }
    return entities
}

function weightForCodePoint(codePoint: number): number {
    for (const range of X_WEIGHTED_RANGES) {
        if (codePoint >= range.start && codePoint <= range.end) return range.weight
    }
    return X_DEFAULT_CHAR_WEIGHT
}

/**
 * Parses post text with X-compatible weighted character counting.
 * An empty or blank text parses as invalid; blank rejection stays with the
 * caller alongside the existing non-blank text requirement.
 */
export function parseXPostText(text: string): XWeightedTextResult {
    const normalized = text.normalize('NFC')
    if (normalized.trim().length === 0) {
        return { weightedLength: 0, valid: false, hasInvalidCharacters: false }
    }

    const urls = extractUrls(normalized)
    const emojis = extractEmojiClusters(normalized)
    let urlIndex = 0
    let weightedCount = 0
    let hasInvalidCharacters = false
    let offset = 0

    while (offset < normalized.length) {
        if (urlIndex < urls.length && urls[urlIndex]!.start === offset) {
            const url = urls[urlIndex]!
            urlIndex += 1
            weightedCount += X_SCALED_URL_WEIGHT
            offset = url.end
            continue
        }

        const emoji = emojis.find(entity => entity.start === offset)
        if (emoji !== undefined) {
            weightedCount += X_DEFAULT_CHAR_WEIGHT
            offset = emoji.end
            continue
        }

        const codePoint = normalized.codePointAt(offset) ?? 0
        weightedCount += weightForCodePoint(codePoint)
        if (!hasInvalidCharacters && isInvalidCodePoint(codePoint)) {
            hasInvalidCharacters = true
        }
        offset += String.fromCodePoint(codePoint).length
    }

    const weightedLength = Math.floor(weightedCount / X_WEIGHT_SCALE)
    return {
        weightedLength,
        valid: !hasInvalidCharacters && weightedLength <= X_MAX_WEIGHTED_POST_LENGTH,
        hasInvalidCharacters,
    }
}

/** Returns true when the post text fits X's weighted length and character rules. */
export function isXPostTextValid(text: string): boolean {
    return parseXPostText(text).valid
}
