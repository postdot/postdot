import { buttonVariants } from '@postdot/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { EmptyState } from '@/components/empty-state'
import { ExistingPostPage } from '@/components/post-composer/existing-post-page'
import { loadExistingPost } from '@/components/post-composer/load-existing-post'
import { QueryErrorState } from '@/components/query-error-state'
import { ApiError } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/dashboard/projects/$projectId/posts/$postId')({
    validateSearch: (search: Record<string, unknown>): { editor?: 'tiptap' | 'legacy' } =>
        import.meta.env.DEV && (search.editor === 'legacy' || search.editor === 'tiptap')
            ? { editor: search.editor }
            : {},
    component: PostRoute,
})

function PostRoute() {
    useLanguage()
    const { editor } = Route.useSearch()
    const { projectId, postId } = Route.useParams()
    const query = useQuery({
        queryKey: [...projectQueryKeys.publicationEditors(projectId), 'post', postId],
        queryFn: () => loadExistingPost(projectId, postId),
        retry: false,
    })
    if (query.data)
        return (
            <ExistingPostPage
                key={postId}
                initialData={query.data}
                queryError={query.error}
                configuredEditor={!(import.meta.env.DEV && editor === 'legacy')}
            />
        )
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8">
            <Link
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                to="/dashboard/projects/$projectId/queue"
                params={{ projectId }}
                search={{ filter: undefined, sort: undefined, tagIds: undefined }}>
                {m.editor_back_to_queue()}
            </Link>
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
