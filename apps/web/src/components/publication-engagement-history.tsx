import { Button } from '@postdot/ui/components/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { QueryErrorState } from '@/components/query-error-state'
import { api, type ProviderAnalyticsItem } from '@/lib/api'
import { engagementHistoryModel, measuredSnapshot } from '@/lib/engagement-history'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

function availability(item: ProviderAnalyticsItem): string {
    if (item.availability === 'measured') return m.engagement_measured()
    if (item.availability === 'rate_limited') return m.performance_status_rate_limited()
    if (item.availability === 'not_authorized' || item.availability === 'blocked')
        return m.performance_status_not_authorized()
    if (item.availability === 'not_found') return m.performance_status_not_found()
    if (item.availability === 'not_configured') return m.performance_status_not_configured()
    if (item.availability === 'temporarily_unavailable' || item.availability === 'disabled')
        return m.performance_status_temporarily_unavailable()
    if (item.availability === 'partial_response' || item.availability === 'invalid_response')
        return m.performance_status_invalid_response()
    return m.performance_status_default()
}

export function PublicationEngagementHistory({
    projectId,
    publicationId,
    provider,
    timeZone,
}: {
    readonly projectId: string
    readonly publicationId: string
    readonly provider: string
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const id = useId()
    const capability = providerRegistry.get(provider)?.analytics
    const metrics = capability?.metrics ?? []
    const [selectedMetric, setSelectedMetric] = useState(metrics[0]?.key ?? '')
    const metric = metrics.find(item => item.key === selectedMetric) ?? metrics[0]
    const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
    const cursor = cursors.at(-1)
    const query = useQuery({
        queryKey: [
            ...projectQueryKeys.providerAnalytics(projectId, provider),
            'history',
            publicationId,
            metric?.key,
            cursor ?? 'latest',
        ],
        queryFn: () => capability!.listHistory(api, projectId, publicationId, metric!.key, cursor),
        enabled: !!capability && !!metric,
        staleTime: 30_000,
        retry: 1,
    })
    const observations = (query.data?.observations ?? []).filter(
        item =>
            item.postdotEntityType === 'publication' &&
            item.postdotEntityId === publicationId &&
            item.metricName === metric?.key &&
            item.provider === provider
    )
    const model = engagementHistoryModel(observations)
    const date = (at: number) => formatDateTime(at, timeZone, locale)
    const first = model.ascending[0]
    const last = model.ascending.at(-1)
    const maximum = Math.max(1, ...model.measured.map(item => item.value!))
    const x = (item: ProviderAnalyticsItem) =>
        first && last && last.fetchedAt !== first.fetchedAt
            ? 12 + ((item.fetchedAt - first.fetchedAt) / (last.fetchedAt - first.fetchedAt)) * 576
            : 300
    const y = (item: ProviderAnalyticsItem) => 148 - (item.value! / maximum) * 136
    if (!metric || !capability) return null
    return (
        <section
            aria-label={m.engagement_history()}
            data-engagement-history
            className="min-w-0 space-y-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Select
                    value={metric.key}
                    onValueChange={value => {
                        setSelectedMetric(value ?? metrics[0]!.key)
                        setCursors([undefined])
                    }}>
                    <SelectTrigger aria-label={m.engagement_metric()} className="w-48">
                        <SelectValue>{metric.label()}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        {metrics.map(item => (
                            <SelectItem key={item.key} value={item.key}>
                                {item.label()}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}>
                    {query.isFetching && query.data ? m.realtime_refreshing() : m.delivery_reload()}
                </Button>
                {model.difference !== null ? (
                    <p className="text-sm" data-history-difference>
                        {m.engagement_difference({
                            difference: formatNumber(model.difference, locale, {
                                signDisplay: 'exceptZero',
                            }),
                        })}
                    </p>
                ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
                {m.engagement_history_scope()}
            </p>
            {query.isError ? <QueryErrorState onRetry={() => void query.refetch()} /> : null}
            {query.isPending ? (
                <p role="status" className="py-4 text-sm text-muted-foreground">
                    {m.common_loading()}
                </p>
            ) : null}
            {query.data && !observations.length ? (
                <p className="py-4 text-sm text-muted-foreground">{m.engagement_history_empty()}</p>
            ) : null}
            {observations.length ? (
                <>
                    {!model.compatible ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            {m.engagement_history_changed()}
                        </p>
                    ) : model.measured.length ? (
                        <figure
                            aria-labelledby={`${id}-chart-label`}
                            data-history-chart
                            className="min-w-0">
                            <figcaption
                                id={`${id}-chart-label`}
                                className="mb-3 text-xs text-muted-foreground">
                                {m.engagement_chart_scope({
                                    metric: metric.label(),
                                    count: observations.length,
                                })}
                            </figcaption>
                            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
                                <div
                                    aria-hidden="true"
                                    className="flex flex-col justify-between py-2 text-right text-xs tabular-nums text-muted-foreground">
                                    <span>{formatNumber(maximum, locale)}</span>
                                    <span>0</span>
                                </div>
                                <svg
                                    viewBox="0 0 600 160"
                                    preserveAspectRatio="none"
                                    role="img"
                                    aria-labelledby={`${id}-chart-label`}
                                    className="h-44 w-full overflow-visible text-primary">
                                    <line
                                        x1="12"
                                        x2="588"
                                        y1="148"
                                        y2="148"
                                        className="stroke-border"
                                    />
                                    {model.segments.map((segment, index) => (
                                        <polyline
                                            key={index}
                                            data-history-segment
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            vectorEffect="non-scaling-stroke"
                                            points={segment
                                                .map(item => `${x(item)},${y(item)}`)
                                                .join(' ')}
                                        />
                                    ))}
                                    {model.measured.map(item => (
                                        <circle
                                            key={item.id}
                                            data-history-point
                                            cx={x(item)}
                                            cy={y(item)}
                                            r="3"
                                            fill="currentColor">
                                            <title>
                                                {date(item.fetchedAt)}:{' '}
                                                {formatNumber(item.value!, locale)}
                                            </title>
                                        </circle>
                                    ))}
                                </svg>
                            </div>
                            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                                <span>{first ? date(first.fetchedAt) : ''}</span>
                                <span>
                                    {last && last.id !== first?.id ? date(last.fetchedAt) : ''}
                                </span>
                            </div>
                        </figure>
                    ) : null}
                    {observations.length === 1 ? (
                        <p className="text-xs text-muted-foreground">
                            {m.engagement_single_snapshot()}
                        </p>
                    ) : null}
                    <div
                        className="max-h-80 overflow-auto"
                        tabIndex={0}
                        role="region"
                        aria-label={m.engagement_snapshot_table()}>
                        <table className="w-full text-left text-xs" data-history-table>
                            <thead className="sticky top-0 bg-surface-field">
                                <tr>
                                    <th scope="col" className="p-2 font-medium">
                                        {m.engagement_saved_at()}
                                    </th>
                                    <th scope="col" className="p-2 text-right font-medium">
                                        {m.engagement_value()}
                                    </th>
                                    <th scope="col" className="p-2 font-medium">
                                        {m.engagement_availability()}
                                    </th>
                                    <th scope="col" className="p-2 font-medium">
                                        {m.engagement_freshness()}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {model.descending.map(item => (
                                    <tr key={item.id} className="border-t border-border">
                                        <th scope="row" className="p-2 font-normal">
                                            <time dateTime={new Date(item.fetchedAt).toISOString()}>
                                                {date(item.fetchedAt)}
                                            </time>
                                            {item.observedAt !== null ? (
                                                <span className="mt-1 block text-muted-foreground">
                                                    {m.engagement_observed_at({
                                                        date: date(item.observedAt),
                                                    })}
                                                </span>
                                            ) : null}
                                        </th>
                                        <td className="p-2 text-right tabular-nums">
                                            <span data-history-value>
                                                {measuredSnapshot(item)
                                                    ? formatNumber(item.value!, locale)
                                                    : '—'}
                                            </span>
                                            {measuredSnapshot(item) ? (
                                                <span className="mt-1 block text-muted-foreground">
                                                    {item.unit === 'count'
                                                        ? m.engagement_count_unit()
                                                        : item.unit.replaceAll('_', ' ')}{' '}
                                                    ·{' '}
                                                    {item.aggregation === 'cumulative_snapshot'
                                                        ? m.engagement_cumulative_basis()
                                                        : item.aggregation.replaceAll('_', ' ')}
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="p-2">{availability(item)}</td>
                                        <td className="p-2 text-muted-foreground">
                                            {item.freshness === 'fresh'
                                                ? m.engagement_fresh()
                                                : item.freshness === 'stale'
                                                  ? m.engagement_stale()
                                                  : m.engagement_unknown_freshness()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : null}
            {query.data || cursors.length > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={cursors.length === 1 || query.isFetching}
                        onClick={() => setCursors(current => current.slice(0, -1))}>
                        {m.engagement_newer()}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!query.data?.nextCursor || query.isFetching}
                        onClick={() =>
                            setCursors(current => [...current, query.data!.nextCursor!])
                        }>
                        {m.engagement_older()}
                    </Button>
                    {query.data?.hasMore && !query.data.nextCursor ? (
                        <p role="status" className="text-xs text-state-attention">
                            {m.performance_read_incomplete()}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </section>
    )
}
