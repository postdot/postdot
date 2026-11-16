import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '@/components/empty-state'
import { ExistingPostPage } from '@/components/post-composer/existing-post-page'
import { loadExistingPost } from '@/components/post-composer/use-existing-post-composition'
import { QueryErrorState } from '@/components/query-error-state'
import { ApiError } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/dashboard/projects/$projectId/posts/$postId')({
    component: PostRoute,
})

function PostRoute() {
    useLanguage()
    const { projectId, postId } = Route.useParams()
    const query = useQuery({
        queryKey: [...projectQueryKeys.publicationEditors(projectId), 'post', postId],
        queryFn: () => loadExistingPost(projectId, postId),
        retry: false,
    })
    if (query.data) return <ExistingPostPage key={postId} initialData={query.data} />
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8">
            {query.isError ? (
                query.error instanceof ApiError && query.error.status === 404 ? (
                    <EmptyState
                        title={m.post_unavailable_title()}
                        description={m.detail_unavailable_description()}
                        illustration="result"
                        layout="compact"
                    />
                ) : (
                    <QueryErrorState onRetry={() => void query.refetch()} />
                )
            ) : (
                <p role="status">{m.common_loading()}</p>
            )}
        </main>
    )
}
