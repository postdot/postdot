import type { PublicationSummary } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function publicationIdentityLabel(publication: PublicationSummary) {
    const title = publication.postTitle?.trim()
    if (title) return title
    const excerpt = publication.sourceExcerpt?.trim()
    if (excerpt) return excerpt
    if (publication.mediaCount > 0) {
        return m.publication_media_count({ count: publication.mediaCount })
    }
    return m.publication_untitled()
}
