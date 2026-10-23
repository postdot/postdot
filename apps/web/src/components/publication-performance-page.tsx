import { Button, buttonVariants } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { ChartSquareIcon } from '@solar-icons/react/linear/chart-square'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { useInfiniteQuery, useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmptyState } from '@/components/empty-state'
import { PerformanceTagFilter } from '@/components/performance-tag-filter'
import { QueryErrorState } from '@/components/query-error-state'
import { api, type ProviderAnalyticsItem, type PublicationSummary } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import { useProjectTagCatalog } from '@/lib/project-tags'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import {
    createPerformanceProviderBatches,
    performanceProviderForChannel as analyticsProvider,
    groupPerformancePublications,
    groupLatestObservations,
    normalizePerformanceTagSelection,
    performanceTagSelectionKey,
} from '@/lib/publication-performance'
import { readPerformanceCsv } from '@/lib/publication-performance-export'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

type AnalyticsProvider = string
type MetricKey = string

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
    const capability = providerRegistry.get(provider)?.analytics
    if (!capability) throw new Error('Provider analytics capability is unavailable')
    return capability.collect(api, projectId, channelId, publicationId)
}

function listLatestProviderAnalytics(
    provider: AnalyticsProvider,
    projectId: string,
    publicationIds: readonly string[]
) {
    const capability = providerRegistry.get(provider)?.analytics
    if (!capability) throw new Error('Provider analytics capability is unavailable')
    return capability.listLatest(api, projectId, publicationIds)
}

export function PublicationPerformancePage({
    initialTagIds = [],
}: {
    readonly initialTagIds?: readonly string[]
}) {
    const { locale } = useLanguage()
    const { channels, project, projectRole } = useProjectDashboard()
    const queryClient = useQueryClient()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/performance' })
    const [refreshErrors, setRefreshErrors] = useState<Record<string, true>>({})
    const canRefresh = projectRole === 'owner' || projectRole === 'editor'
    const [tagIds, setTagIds] = useState<string[]>(() =>
        normalizePerformanceTagSelection(initialTagIds)
    )
    const initialTagIdsKey = initialTagIds.join('\u0000')
    useEffect(() => {
        setTagIds(
            normalizePerformanceTagSelection(
                initialTagIdsKey === '' ? [] : initialTagIdsKey.split('\u0000')
            )
        )
    }, [initialTagIdsKey])
    const selectedTagIds = useMemo(() => normalizePerformanceTagSelection(tagIds), [tagIds])
    const [exportState, setExportState] = useState<'idle' | 'pending' | 'failed'>('idle')
    const exportAbort = useRef<AbortController | null>(null)
    const exportTagKey = performanceTagSelectionKey(selectedTagIds)
    useEffect(() => {
        setExportState('idle')
        return () => {
            exportAbort.current?.abort()
        }
    }, [project.id, exportTagKey])
    const tagCatalogQuery = useProjectTagCatalog(project.id)
    const catalogTags = tagCatalogQuery.data?.tags ?? []
    const publicationsQuery = useInfiniteQuery({
        queryKey: [
            ...projectQueryKeys.publicationQueues(project.id),
            'performance',
            performanceTagSelectionKey(selectedTagIds),
        ],
        queryFn: ({ pageParam }) =>
            api.listPublications(project.id, {
                cursor: pageParam,
                limit: 100,
                sort: 'updated_desc',
                tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: page => page.nextCursor ?? undefined,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    })
    const channelsById = new Map(channels.map(channel => [channel.id, channel]))
    const matchedPublications =
        publicationsQuery.data?.pages.flatMap(page => page.publications) ?? []
    const publications = matchedPublications.filter(
        publication =>
            publication.state === 'published' &&
            analyticsProvider(channelsById.get(publication.channelId)) !== null
    )
    const hasNoTagMatch = selectedTagIds.length > 0 && matchedPublications.length === 0
    const groups = groupPerformancePublications(publications)
    const batches = createPerformanceProviderBatches(
        publications.map(publication => ({
            publicationId: publication.id,
            provider: analyticsProvider(channelsById.get(publication.channelId))!,
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
                listLatestProviderAnalytics(batch.provider, project.id, batch.publicationIds),
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
        unknown,
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

    async function exportCsv() {
        exportAbort.current?.abort()
        const controller = new AbortController()
        exportAbort.current = controller
        setExportState('pending')
        const exportedAt = Date.now()
        try {
            const csv = await readPerformanceCsv(
                {
                    projectId: project.id,
                    tagIds: selectedTagIds,
                    channels,
                    signal: controller.signal,
                    exportedAt,
                },
                api
            )
            if (controller.signal.aborted) return
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
            try {
                const link = document.createElement('a')
                link.href = url
                link.download = `postbot-performance-${project.id}-${new Date(exportedAt).toISOString().slice(0, 10)}.csv`
                document.body.append(link)
                link.click()
                link.remove()
            } finally {
                window.setTimeout(() => URL.revokeObjectURL(url), 1000)
            }
            setExportState('idle')
        } catch {
            if (!controller.signal.aborted) setExportState('failed')
        } finally {
            if (exportAbort.current === controller) exportAbort.current = null
        }
    }

    function formatDate(timestamp: number): string {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp)
    }

    function handleTagChange(nextTagIds: string[]) {
        const normalized = normalizePerformanceTagSelection(nextTagIds)
        setTagIds(normalized)
        void navigate({
            search: current => ({
                ...current,
                tagIds: normalized.length > 0 ? normalized : undefined,
            }),
        })
    }

    function renderPublication(publication: PublicationSummary) {
        const channel = channelsById.get(publication.channelId)
        const provider = analyticsProvider(channel)
        const metricObservations =
            provider === null
                ? new Map<string, ProviderAnalyticsItem>()
                : (latestObservations.get(publication.id) ?? new Map())
        const metrics: readonly { key: MetricKey; label: () => string }[] =
            provider === null ? [] : (providerRegistry.get(provider)?.analytics?.metrics ?? [])
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
                action={
                    <div className="flex items-center gap-2">
                        {exportState === 'pending' ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    exportAbort.current?.abort()
                                    setExportState('idle')
                                }}>
                                {m.performance_export_cancel()}
                            </Button>
                        ) : null}
                        <Button
                            variant="outline"
                            size="sm"
                            aria-busy={exportState === 'pending'}
                            disabled={
                                exportState === 'pending' ||
                                publicationsQuery.isPending ||
                                publicationsQuery.isError
                            }
                            onClick={() => void exportCsv()}>
                            {exportState === 'pending'
                                ? m.performance_export_pending()
                                : m.performance_export_csv()}
                        </Button>
                    </div>
                }
                title={m.performance_title()}
            />
            {exportState === 'failed' ? (
                <p role="alert" className="mt-2 text-sm text-state-failed">
                    {m.performance_export_failed()}
                </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                {tagCatalogQuery.isError ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <p role="alert" className="text-xs text-state-failed">
                            {m.performance_tag_filter_catalog_failed()}
                        </p>
                        <Button
                            onClick={() => void tagCatalogQuery.refetch()}
                            size="sm"
                            variant="ghost">
                            {m.common_retry()}
                        </Button>
                    </div>
                ) : null}
                {catalogTags.length > 0 || selectedTagIds.length > 0 ? (
                    <PerformanceTagFilter
                        disabled={tagCatalogQuery.isPending}
                        onChange={handleTagChange}
                        selectedTagIds={selectedTagIds}
                        tags={catalogTags}
                    />
                ) : tagCatalogQuery.isSuccess ? (
                    <p className="text-xs text-muted-foreground">
                        {m.performance_tag_filter_no_tags()}
                    </p>
                ) : null}
            </div>
            {selectedTagIds.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                    {m.performance_tag_filter_scope()}
                </p>
            ) : null}
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
                    description={
                        hasNoTagMatch
                            ? m.performance_tag_filter_no_matches_description()
                            : m.performance_empty_description()
                    }
                    icon={<ChartSquareIcon aria-hidden="true" className="size-5" />}
                    layout="compact"
                    title={
                        hasNoTagMatch
                            ? m.performance_tag_filter_no_matches_title()
                            : m.performance_empty_title()
                    }
                    action={
                        hasNoTagMatch ? (
                            <Button onClick={() => handleTagChange([])} size="sm" variant="ghost">
                                {m.taxonomy_clear_tags()}
                            </Button>
                        ) : publicationsQuery.hasNextPage ? (
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
                    <section aria-label={m.performance_title()} className="mt-4 space-y-1">
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
