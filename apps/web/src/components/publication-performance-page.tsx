import { Button, buttonVariants } from '@postbot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { ChartSquareIcon } from '@solar-icons/react/linear/chart-square'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { useInfiniteQuery, useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmptyState } from '@/components/empty-state'
import { QueryErrorState } from '@/components/query-error-state'
import {
    api,
    type BlueskyAnalyticsCollection,
    type DevtoAnalyticsCollection,
    type ProviderAnalyticsItem,
    type PublicationSummary,
} from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import {
    createPerformanceProviderBatches,
    performanceProvider as analyticsProvider,
    groupPerformancePublications,
    groupLatestObservations,
} from '@/lib/publication-performance'
import * as m from '@/paraglide/messages.js'

const providerMetrics = {
    bluesky: [
        { key: 'likeCount', label: () => m.performance_likes() },
        { key: 'replyCount', label: () => m.performance_replies() },
        { key: 'repostCount', label: () => m.performance_reposts() },
        { key: 'quoteCount', label: () => m.performance_quotes() },
        { key: 'bookmarkCount', label: () => m.performance_bookmarks() },
    ],
    devto: [
        { key: 'page_views', label: () => m.performance_views() },
        { key: 'reactions', label: () => m.performance_reactions() },
        { key: 'comments', label: () => m.performance_comments() },
    ],
} as const

type AnalyticsProvider = keyof typeof providerMetrics
type MetricKey = (typeof providerMetrics)[AnalyticsProvider][number]['key']

function availabilityMessage(availability: ProviderAnalyticsItem['availability']): string {
    switch (availability) {
        case 'not_configured':
            return m.performance_status_not_configured()
        case 'not_authorized':
        case 'blocked':
            return m.performance_status_not_authorized()
        case 'rate_limited':
            return m.performance_status_rate_limited()
        case 'not_found':
            return m.performance_status_not_found()
        case 'temporarily_unavailable':
        case 'disabled':
            return m.performance_status_temporarily_unavailable()
        case 'invalid_response':
        case 'partial_response':
            return m.performance_status_invalid_response()
        case 'not_reported':
        case 'not_supported':
            return m.performance_status_default()
        case 'measured':
            return ''
    }
}

function collectProviderAnalytics(
    provider: AnalyticsProvider,
    projectId: string,
    channelId: string,
    publicationId: string
) {
    return provider === 'devto'
        ? api.collectDevtoProviderAnalytics(projectId, channelId, publicationId)
        : api.collectBlueskyProviderAnalytics(projectId, channelId, publicationId)
}

export function PublicationPerformancePage() {
    const { locale } = useLanguage()
    const { channels, project, projectRole } = useProjectDashboard()
    const queryClient = useQueryClient()
    const [refreshErrors, setRefreshErrors] = useState<Record<string, true>>({})
    const canRefresh = projectRole === 'owner' || projectRole === 'editor'
    const publicationsQuery = useInfiniteQuery({
        queryKey: [...projectQueryKeys.publicationQueues(project.id), 'performance'],
        queryFn: ({ pageParam }) =>
            api.listPublications(project.id, {
                cursor: pageParam,
                limit: 100,
                sort: 'updated_desc',
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: page => page.nextCursor ?? undefined,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const channelsById = new Map(channels.map(channel => [channel.id, channel]))
    const publications = (
        publicationsQuery.data?.pages.flatMap(page => page.publications) ?? []
    ).filter(
        publication =>
            publication.state === 'published' &&
            analyticsProvider(channelsById.get(publication.channelId)?.profileId) !== null
    )
    const groups = groupPerformancePublications(publications)
    const batches = createPerformanceProviderBatches(
        publications.map(publication => ({
            publicationId: publication.id,
            provider: analyticsProvider(channelsById.get(publication.channelId)?.profileId)!,
        }))
    )
    const analyticsQueries = useQueries({
        queries: batches.map(batch => ({
            queryKey: [
                ...projectQueryKeys.providerAnalytics(project.id, batch.provider),
                'latest',
                ...batch.publicationIds,
            ],
            queryFn: () =>
                batch.provider === 'bluesky'
                    ? api.listLatestBlueskyProviderAnalytics(project.id, batch.publicationIds)
                    : api.listLatestDevtoProviderAnalytics(project.id, batch.publicationIds),
            staleTime: Number.POSITIVE_INFINITY,
            retry: 1,
        })),
    })
    const readsByPublication = new Map(
        batches.flatMap((batch, index) =>
            batch.publicationIds.map(id => [id, analyticsQueries[index]!] as const)
        )
    )
    const latestObservations = groupLatestObservations(
        analyticsQueries.flatMap(query => query.data?.observations ?? [])
    )
    const refreshMutation = useMutation<
        BlueskyAnalyticsCollection | DevtoAnalyticsCollection,
        Error,
        { provider: AnalyticsProvider; channelId: string; publicationId: string }
    >({
        mutationFn: (input: {
            provider: AnalyticsProvider
            channelId: string
            publicationId: string
        }) =>
            collectProviderAnalytics(
                input.provider,
                project.id,
                input.channelId,
                input.publicationId
            ),
        onMutate: input => {
            setRefreshErrors(current => {
                const next = { ...current }
                delete next[input.publicationId]
                return next
            })
        },
        onError: (_error, input) => {
            setRefreshErrors(current => ({
                ...current,
                [input.publicationId]: true,
            }))
        },
        onSuccess: async (_response, input) => {
            await queryClient.invalidateQueries({
                queryKey: projectQueryKeys.providerAnalytics(project.id, input.provider),
            })
        },
    })

    function formatDate(timestamp: number): string {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp)
    }

    function renderPublication(publication: PublicationSummary) {
        const channel = channelsById.get(publication.channelId)
        const provider = analyticsProvider(channel?.profileId)
        const metricObservations =
            provider === null
                ? new Map<string, ProviderAnalyticsItem>()
                : (latestObservations.get(publication.id) ?? new Map())
        const metrics: readonly { key: MetricKey; label: () => string }[] =
            provider === null ? [] : providerMetrics[provider]
        const read = readsByPublication.get(publication.id)
        const latestFetch = [...metricObservations.values()].reduce<number | null>(
            (latest, observation) =>
                latest === null || observation.fetchedAt > latest ? observation.fetchedAt : latest,
            null
        )
        const unavailable = [...metricObservations.values()].find(
            observation => observation.availability !== 'measured'
        )
        const isRefreshing =
            refreshMutation.isPending && refreshMutation.variables?.publicationId === publication.id

        return (
            <article
                key={publication.id}
                className="grid min-w-0 gap-3 rounded-md bg-surface-inset/35 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.4fr)_auto] lg:items-center"
                data-performance-publication={publication.id}>
                <div className="min-w-0">
                    <Link
                        to="/dashboard/projects/$projectId/publications/$publicationId"
                        params={{ projectId: project.id, publicationId: publication.id }}
                        className="block break-words text-sm font-medium text-foreground hover:text-primary">
                        {publication.channelName}
                    </Link>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                        {publication.publishedAt === null
                            ? ''
                            : formatDate(publication.publishedAt)}
                    </p>
                    {refreshErrors[publication.id] !== undefined ? (
                        <p role="alert" className="mt-2 text-xs leading-5 text-state-failed">
                            {m.performance_refresh_failed()}
                        </p>
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
                    {metrics.map(metric => {
                        const observation = metricObservations.get(metric.key)
                        const value =
                            observation?.availability === 'measured' && observation.value !== null
                                ? formatNumber(observation.value, locale)
                                : '—'
                        return (
                            <div key={metric.key} className="min-w-12">
                                <p className="text-[0.65rem] text-muted-foreground">
                                    {metric.label()}
                                </p>
                                <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
                            </div>
                        )
                    })}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-end">
                    <p className="min-w-0 text-xs text-muted-foreground">
                        {provider === null
                            ? m.performance_status_not_supported()
                            : read?.isPending
                              ? m.common_loading()
                              : read?.isError
                                ? m.performance_read_failed()
                                : read?.data?.hasMore
                                  ? m.performance_read_incomplete()
                                  : unavailable === undefined
                                    ? latestFetch === null
                                        ? m.performance_not_collected()
                                        : m.performance_updated_at({
                                              date: formatDate(latestFetch),
                                          })
                                    : availabilityMessage(unavailable.availability)}
                    </p>
                    {canRefresh && provider !== null ? (
                        <Button
                            aria-label={`${m.performance_refresh()}: ${publication.channelName}`}
                            disabled={refreshMutation.isPending}
                            onClick={() =>
                                refreshMutation.mutate({
                                    provider,
                                    channelId: publication.channelId,
                                    publicationId: publication.id,
                                })
                            }
                            size="icon"
                            className="size-11 sm:h-7 sm:w-auto sm:gap-1 sm:px-2.5"
                            variant="ghost">
                            <RefreshIcon
                                aria-hidden="true"
                                className={isRefreshing ? 'animate-spin' : undefined}
                            />
                            <span className="hidden sm:inline">
                                {isRefreshing
                                    ? m.performance_refreshing()
                                    : m.performance_refresh()}
                            </span>
                        </Button>
                    ) : null}
                </div>
            </article>
        )
    }

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                back={
                    <Link
                        aria-label={m.nav_back_to_overview()}
                        className={buttonVariants({
                            variant: 'ghost',
                            size: 'icon',
                            className:
                                'justify-self-start text-muted-foreground hover:text-foreground lg:w-auto lg:gap-1.5 lg:px-2.5',
                        })}
                        params={{ projectId: project.id }}
                        to="/dashboard/projects/$projectId/overview">
                        <AltArrowLeftIcon aria-hidden="true" />
                        <span className="hidden lg:inline">{m.nav_back_to_overview()}</span>
                    </Link>
                }
                title={m.performance_title()}
            />
            {publicationsQuery.isError ? (
                <QueryErrorState
                    className="mt-4"
                    onRetry={() => void publicationsQuery.refetch()}
                />
            ) : publicationsQuery.isPending ? (
                <p className="py-8 text-sm text-muted-foreground" role="status">
                    {m.common_loading()}
                </p>
            ) : publications.length === 0 ? (
                <EmptyState
                    className="mt-4"
                    description={m.performance_empty_description()}
                    icon={<ChartSquareIcon aria-hidden="true" className="size-5" />}
                    layout="compact"
                    title={m.performance_empty_title()}
                    action={
                        publicationsQuery.hasNextPage ? (
                            <Button
                                disabled={publicationsQuery.isFetchingNextPage}
                                onClick={() => void publicationsQuery.fetchNextPage()}
                                size="sm"
                                variant="ghost">
                                {publicationsQuery.isFetchingNextPage
                                    ? m.common_loading()
                                    : m.performance_load_more()}
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <>
                    {analyticsQueries.some(query => query.isError) ? (
                        <QueryErrorState
                            className="mb-3"
                            onRetry={() => {
                                for (const query of analyticsQueries) {
                                    if (query.isError) void query.refetch()
                                }
                            }}
                        />
                    ) : null}
                    <section aria-label={m.performance_title()} className="space-y-1">
                        <p className="mb-4 text-sm text-muted-foreground">
                            {m.performance_grouped_description()}
                        </p>
                        {groups.map(group => (
                            <section
                                key={group.postId}
                                className="space-y-2 pb-6"
                                aria-labelledby={`performance-post-${group.postId}`}
                                data-performance-post={group.postId}>
                                <h2
                                    id={`performance-post-${group.postId}`}
                                    className="break-words text-base font-semibold">
                                    <Link
                                        to="/dashboard/projects/$projectId/posts/$postId"
                                        params={{ projectId: project.id, postId: group.postId }}
                                        className="hover:text-primary">
                                        {publicationIdentityLabel(group.publications[0]!)}
                                    </Link>
                                </h2>
                                {group.publications.map(renderPublication)}
                            </section>
                        ))}
                    </section>
                    {publicationsQuery.hasNextPage ? (
                        <div className="flex justify-center py-6">
                            <Button
                                disabled={publicationsQuery.isFetchingNextPage}
                                onClick={() => void publicationsQuery.fetchNextPage()}
                                variant="ghost">
                                {publicationsQuery.isFetchingNextPage
                                    ? m.common_loading()
                                    : m.performance_load_more()}
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </main>
    )
}
