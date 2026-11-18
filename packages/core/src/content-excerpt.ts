/**
 * A heading-sized excerpt of untitled text (audit P10): links dropped, whitespace collapsed,
 * cut on a word boundary with an ellipsis instead of mid-word or mid-URL.
 */
export function shortExcerpt(text: string, maxLength = 60) {
    const clean = text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s:,;\u2013\u2014-]+$/, '')
    if (clean.length <= maxLength) return clean
    const cut = clean.slice(0, maxLength)
    const boundary = cut.lastIndexOf(' ')
    return `${(boundary > maxLength / 2 ? cut.slice(0, boundary) : cut).replace(/[\s,.;:\u2013\u2014-]+$/, '')}…`
}
