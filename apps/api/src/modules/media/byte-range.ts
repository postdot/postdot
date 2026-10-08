/** One byte range, inclusive HTTP end translated to an exclusive storage end. */
export function parseMediaByteRange(
    value: string,
    size: number
): { start: number; end: number } | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec(value)
    if (!match || (!match[1] && !match[2]) || size <= 0) return null
    if (!match[1]) {
        const suffix = Number(match[2])
        return Number.isSafeInteger(suffix) && suffix > 0
            ? { start: Math.max(0, size - suffix), end: size }
            : null
    }
    const start = Number(match[1])
    const end = match[2] ? Math.min(size, Number(match[2]) + 1) : size
    return Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start >= 0 &&
        start < size &&
        end > start
        ? { start, end }
        : null
}
