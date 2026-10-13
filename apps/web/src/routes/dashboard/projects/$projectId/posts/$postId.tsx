import { buttonVariants } from '@postbot/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { AddPostDestination } from '@/components/add-post-destination'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationList } from '@/components/dashboard-publication-parts'
import { PostSourceEditor } from '@/components/post-source-editor'
import { PostSourceReview } from '@/components/post-source-review'
import { QueryErrorState } from '@/components/query-error-state'
import { api, type PublicationSummary } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys, subscribeProjectAccessRevocation } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

export const Route = createFileRoute('/dashboard/projects/$projectId/posts/$postId')({
    component: PostRoute,
})

function PostRoute() {
    useLanguage()
    const { projectId, postId } = Route.useParams()
    const { project, projectRole, channels } = useProjectDashboard()
    const [editingSource, setEditingSource] = useState(false)
    const [suspended, setSuspended] = useState(false)
    const [epoch, setEpoch] = useState(0)
    const generation = useRef(0)
    useEffect(() => {
        setEditingSource(false)
    }, [postId])
    const query = useQuery({
        queryKey: [...projectQueryKeys.data(projectId), 'post', postId],
        queryFn: async () => {
            const [{ post }, { membership }] = await Promise.all([
                api.getPost(projectId, postId),
                api.getProjectMembership(projectId),
            ])
            const publications: PublicationSummary[] = []
            let cursor: string | undefined
            do {
                const page = await api.listPublications(projectId, {
                    limit: 100,
                    ...(cursor ? { cursor } : {}),
                })
                publications.push(...page.publications.filter(item => item.postId === postId))
                cursor = page.nextCursor ?? undefined
            } while (cursor)
            const assets = await Promise.allSettled(
                [...new Set(post.sourceContent.media.map(item => item.assetId))].map(id =>
                    api.getMedia(projectId, id)
                )
            )
            return {
                post,
                membership,
                publications,
                media: assets.flatMap(item => (item.status === 'fulfilled' ? [item.value] : [])),
            }
        },
    })
    useEffect(
        () =>
            subscribeProjectAccessRevocation(projectId, () => {
                generation.current += 1
                setEpoch(generation.current)
                setSuspended(true)
            }),
        [projectId]
    )
    async function retry() {
        const started = generation.current
        const result = await query.refetch()
        if (!result.isError && started === generation.current) setSuspended(false)
    }
    const canReview =
        !suspended &&
        !query.isError &&
        projectRole !== 'viewer' &&
        query.data?.membership.role !== 'viewer'
    return (
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
            <DashboardPageHeader
                title={m.post_title()}
                back={
                    <Link
                        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                        to="/dashboard/projects/$projectId/queue"
                        search={{ filter: undefined, sort: undefined, tagIds: undefined }}
                        params={{ projectId }}>
                        {m.nav_back_to_queue()}
                    </Link>
                }
            />
            {query.data ? (
                <div hidden={suspended || query.isError} className="mb-8">
                    <PostSourceEditor
                        key={query.data.post.id}
                        getAccessEpoch={() => generation.current}
                        projectId={projectId}
                        post={query.data.post}
                        media={query.data.media}
                        canEdit={Boolean(canReview)}
                        accessEpoch={epoch}
                        onSaved={() => void query.refetch()}
                        onEditingChange={setEditingSource}
                    />
                </div>
            ) : null}
            {suspended || query.isError ? (
                <QueryErrorState onRetry={() => void retry()} />
            ) : query.isPending ? (
                <p role="status">{m.common_loading()}</p>
            ) : (
                <div className="space-y-8">
                    <section aria-label={m.post_destinations()}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold">{m.post_destinations()}</h2>
                            {canReview && !editingSource ? (
                                <div className="flex flex-wrap gap-2">
                                    <AddPostDestination
                                        projectId={projectId}
                                        postId={postId}
                                        channels={channels}
                                        onAdded={async () => {
                                            await query.refetch()
                                        }}
                                    />
                                    <PostSourceReview
                                        projectId={projectId}
                                        postId={postId}
                                        disabled={!canReview}
                                        accessEpoch={epoch}
                                        onApplied={() => {
                                            if (generation.current === epoch) void query.refetch()
                                        }}
                                    />
                                </div>
                            ) : null}
                        </div>
                        <PublicationList
                            publications={query.data.publications}
                            readOnly={!canReview}
                            timeZone={project.timeZone}
                        />
                    </section>
                </div>
            )}
        </main>
    )
}
