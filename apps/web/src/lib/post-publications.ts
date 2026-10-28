import { api, type PublicationSummary } from './api'

type PublicationPage = Awaited<ReturnType<typeof api.listPublications>>

/** A source's destinations may be older than the project's first result page. */
export async function loadPostPublications(
    projectId: string,
    postId: string,
    initialPage?: PublicationPage
): Promise<PublicationSummary[]> {
    let page = initialPage ?? (await api.listPublications(projectId, { limit: 100 }))
    const publications: PublicationSummary[] = []
    for (;;) {
        publications.push(...page.publications.filter(item => item.postId === postId))
        if (page.nextCursor === null) return publications
        page = await api.listPublications(projectId, { limit: 100, cursor: page.nextCursor })
    }
}
