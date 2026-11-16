export interface WordDiffPart {
    readonly text: string
    readonly changed: boolean
}

// Divide-and-conquer LCS keeps memory linear for long channel versions. Whitespace
// is a token too, so rendering either side reproduces its original text exactly.
function commonTokens(left: readonly string[], right: readonly string[]): string[] {
    let prefix = 0
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
        prefix += 1
    }
    let suffix = 0
    while (
        suffix < left.length - prefix &&
        suffix < right.length - prefix &&
        left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
    ) {
        suffix += 1
    }
    if (prefix > 0 || suffix > 0) {
        return [
            ...left.slice(0, prefix),
            ...commonTokens(
                left.slice(prefix, left.length - suffix),
                right.slice(prefix, right.length - suffix)
            ),
            ...left.slice(left.length - suffix),
        ]
    }
    if (left.length === 0 || right.length === 0) return []
    if (left.length === 1) return right.includes(left[0]!) ? [left[0]!] : []

    const middle = Math.floor(left.length / 2)
    const before = lengths(left.slice(0, middle), right)
    const after = lengths(left.slice(middle).toReversed(), right.toReversed())
    let split = 0
    for (let index = 1; index <= right.length; index += 1) {
        if (
            before[index]! + after[right.length - index]! >
            before[split]! + after[right.length - split]!
        ) {
            split = index
        }
    }
    return [
        ...commonTokens(left.slice(0, middle), right.slice(0, split)),
        ...commonTokens(left.slice(middle), right.slice(split)),
    ]
}

function lengths(left: readonly string[], right: readonly string[]): Uint32Array {
    const row = new Uint32Array(right.length + 1)
    for (const token of left) {
        let diagonal = 0
        for (let index = 1; index <= right.length; index += 1) {
            const previous = row[index]!
            row[index] =
                token === right[index - 1] ? diagonal + 1 : Math.max(row[index]!, row[index - 1]!)
            diagonal = previous
        }
    }
    return row
}

function mark(tokens: readonly string[], common: readonly string[]): WordDiffPart[] {
    let index = 0
    const parts: { text: string; changed: boolean }[] = []
    for (const text of tokens) {
        const changed = index >= common.length || text !== common[index]
        if (!changed) index += 1
        const last = parts.at(-1)
        if (last?.changed === changed) last.text += text
        else parts.push({ text, changed })
    }
    return parts
}

export function diffWords(current: string, post: string) {
    const left = current.match(/\s+|\S+/gu) ?? []
    const right = post.match(/\s+|\S+/gu) ?? []
    const common = commonTokens(left, right)
    return { current: mark(left, common), post: mark(right, common) }
}
