import type { PublicationSummary } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function publicationIdentityLabel(
    publication: Pick<PublicationSummary, 'postTitle' | 'sourceExcerpt' | 'mediaCount'>
) {
    const title = publication.postTitle?.trim()
    if (title) return title
    const excerpt = publication.sourceExcerpt?.trim()
    if (excerpt) return shortExcerpt(excerpt, 90)
    if (publication.mediaCount > 0) {
        return m.publication_media_count({ count: publication.mediaCount })
    }
    return m.publication_untitled()
}

/**
 * A heading-sized excerpt of untitled text (audit P10): links dropped, whitespace collapsed,
 * cut on a word boundary with an ellipsis instead of mid-word or mid-URL.
 */
export function shortExcerpt(text: string, maxLength = 60) {
    const clean = text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s:,;–—-]+$/, '')
    if (clean.length <= maxLength) return clean
    const cut = clean.slice(0, maxLength)
    const boundary = cut.lastIndexOf(' ')
    return `${(boundary > maxLength / 2 ? cut.slice(0, boundary) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}
