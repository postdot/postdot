import { Button } from '@postdot/ui/components/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'

import { QueryErrorState } from '@/components/query-error-state'
import { api } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import {
    deliveryCounters,
    deliveryCoverageIncomplete,
    deliveryDays,
    deliveryDestinations,
    previousDeliveryRange,
} from '@/lib/delivery-analytics'
import { formatNumber, formatDateTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
import {
    deliveryAnalyticsPeriods,
    type DeliveryAnalyticsPeriod,
} from '@/lib/publication-performance-search'
import * as m from '@/paraglide/messages.js'

export function DeliveryAnalyticsDashboard({
    days,
    channelId,
}: {
    readonly days: DeliveryAnalyticsPeriod
    readonly channelId?: string
}) {
    const { project, channels } = useProjectDashboard()
    const { locale } = useLanguage()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/performance' })
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const bars = useRef(new Map<string, HTMLButtonElement>())
    const query = useQuery({
        queryKey: [...projectQueryKeys.deliveryAnalytics(project.id), days, channelId ?? 'all'],
        queryFn: () => api.getProjectAnalytics(project.id, { days, channelId }),
        staleTime: 30_000,
        retry: 1,
    })
    const report = query.data
    const comparisonQuery = useQuery({
        queryKey: [
            ...projectQueryKeys.deliveryAnalytics(project.id),
            'comparison',
            days,
            channelId ?? 'all',
            report?.range.from,
            report?.range.to,
        ],
        queryFn: () =>
            api.getProjectAnalytics(project.id, {
                ...previousDeliveryRange(report!.range),
                channelId,
            }),
        enabled: report !== undefined,
        staleTime: 30_000,
        retry: 1,
    })
    const previous = comparisonQuery.data
    const daily = report ? deliveryDays(report) : []
    const counters = report ? deliveryCounters(report) : null
    const previousCounters = previous ? deliveryCounters(previous) : null
    const incomplete = !!report && deliveryCoverageIncomplete(report.coverage)
    const comparisonAvailable =
        !!previous && !incomplete && !deliveryCoverageIncomplete(previous.coverage)
    const destinations = report ? deliveryDestinations(report) : []
    const selectedDay = daily.find(day => day.date === selectedDate) ?? daily.at(-1)
    const maximum = Math.max(1, ...daily.map(day => day.published))
    const dayFormatter = useMemo(
        () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        [locale]
    )
    const dayLabel = (date: string) => dayFormatter.format(new Date(`${date}T12:00:00Z`))
    const labels = {
        published: m.delivery_published(),
        failed: m.delivery_failed(),
        ambiguous: m.delivery_ambiguous(),
        retries: m.delivery_retries(),
    }
    return (
        <section
            aria-labelledby="delivery-analytics-heading"
            data-delivery-dashboard
            className="mt-6 min-w-0 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="delivery-analytics-heading" className="text-lg font-semibold">
                    {m.delivery_title()}
                </h2>
                <div className="flex max-w-full flex-wrap items-center gap-2 sm:flex-nowrap">
                    <Select
                        value={String(days)}
                        onValueChange={value => {
                            setSelectedDate(null)
                            void navigate({
                                search: current => ({
                                    ...current,
                                    days: Number(value) as DeliveryAnalyticsPeriod,
                                }),
                            })
                        }}>
                        <SelectTrigger aria-label={m.delivery_period()} className="w-auto">
                            <SelectValue>{m.delivery_period_days({ days })}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {deliveryAnalyticsPeriods.map(period => (
                                <SelectItem key={period} value={String(period)}>
                                    {m.delivery_period_days({ days: period })}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={channelId ?? 'all'}
                        onValueChange={value => {
                            setSelectedDate(null)
                            void navigate({
                                search: current => ({
                                    ...current,
                                    deliveryChannel:
                                        value === 'all' ? undefined : (value ?? undefined),
                                }),
                            })
                        }}>
                        <SelectTrigger
                            aria-label={m.delivery_destination()}
                            className="w-48 min-w-0 max-w-full">
                            <SelectValue>
                                {channelId
                                    ? (channels.find(channel => channel.id === channelId)?.name ??
                                      m.delivery_retired_destination())
                                    : m.delivery_all_destinations()}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{m.delivery_all_destinations()}</SelectItem>
                            {channelId && !channels.some(channel => channel.id === channelId) ? (
                                <SelectItem value={channelId}>
                                    {m.delivery_retired_destination()}
                                </SelectItem>
                            ) : null}
                            {channels.map(channel => (
                                <SelectItem key={channel.id} value={channel.id}>
                                    {channel.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={query.isFetching}
                        onClick={() => void query.refetch()}>
                        {query.isFetching && report ? m.realtime_refreshing() : m.delivery_reload()}
                    </Button>
                </div>
            </div>
            {query.isError ? <QueryErrorState onRetry={() => void query.refetch()} /> : null}
            {!report && query.isPending ? (
                <p role="status" className="py-6 text-sm text-muted-foreground">
                    {m.common_loading()}
                </p>
            ) : null}
            {report && counters ? (
                <>
                    <p className="text-xs leading-5 text-muted-foreground">
                        {m.delivery_range({
                            from: formatDateTime(report.range.from, report.projectTimeZone, locale),
                            to: formatDateTime(report.range.to, report.projectTimeZone, locale),
                        })}
                    </p>
                    {incomplete ? (
                        <p role="status" className="text-sm text-state-attention">
                            {m.delivery_incomplete()}
                        </p>
                    ) : null}
                    <dl
                        className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-4 lg:grid-cols-4"
                        data-delivery-counters>
                        {(Object.keys(labels) as (keyof typeof labels)[]).map(key => (
                            <div key={key}>
                                <dt className="text-xs text-muted-foreground">{labels[key]}</dt>
                                <dd
                                    className="mt-1 text-2xl font-semibold tabular-nums"
                                    data-delivery-counter={key}>
                                    {formatNumber(counters[key], locale)}
                                </dd>
                                <dd className="mt-1 text-xs text-muted-foreground">
                                    {comparisonAvailable && previousCounters
                                        ? m.delivery_comparison({
                                              difference: formatNumber(
                                                  counters[key] - previousCounters[key],
                                                  locale,
                                                  { signDisplay: 'exceptZero' }
                                              ),
                                          })
                                        : comparisonQuery.isPending && !incomplete
                                          ? m.common_loading()
                                          : m.delivery_comparison_unavailable()}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="text-xs leading-5 text-muted-foreground">{m.delivery_scope()}</p>
                    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <h3 className="text-sm font-medium">{m.delivery_daily()}</h3>
                                <span className="text-xs text-muted-foreground">
                                    {report.projectTimeZone}
                                </span>
                            </div>
                            {daily.some(day => day.published || day.failed || day.ambiguous) ? (
                                <>
                                    <div className="mt-4 overflow-x-auto pb-2">
                                        <div
                                            className="flex h-40 items-end gap-1 border-b border-border"
                                            style={{ minWidth: daily.length * 12 }}
                                            role="group"
                                            aria-label={m.delivery_daily()}>
                                            {daily.map((day, index) => (
                                                <button
                                                    key={day.date}
                                                    type="button"
                                                    data-delivery-day={day.date}
                                                    title={m.delivery_day_label({
                                                        date: dayLabel(day.date),
                                                        published: day.published,
                                                        failed: day.failed,
                                                        ambiguous: day.ambiguous,
                                                    })}
                                                    aria-pressed={selectedDay?.date === day.date}
                                                    tabIndex={
                                                        selectedDay?.date === day.date ? 0 : -1
                                                    }
                                                    aria-label={m.delivery_day_label({
                                                        date: dayLabel(day.date),
                                                        published: day.published,
                                                        failed: day.failed,
                                                        ambiguous: day.ambiguous,
                                                    })}
                                                    ref={node => {
                                                        if (node) bars.current.set(day.date, node)
                                                        else bars.current.delete(day.date)
                                                    }}
                                                    onClick={() => setSelectedDate(day.date)}
                                                    onKeyDown={event => {
                                                        const next =
                                                            event.key === 'ArrowRight'
                                                                ? Math.min(
                                                                      daily.length - 1,
                                                                      index + 1
                                                                  )
                                                                : event.key === 'ArrowLeft'
                                                                  ? Math.max(0, index - 1)
                                                                  : event.key === 'Home'
                                                                    ? 0
                                                                    : event.key === 'End'
                                                                      ? daily.length - 1
                                                                      : null
                                                        if (next !== null) {
                                                            event.preventDefault()
                                                            const date = daily[next]!.date
                                                            setSelectedDate(date)
                                                            bars.current.get(date)?.focus()
                                                        }
                                                    }}
                                                    className="group flex h-full min-w-2 flex-1 items-end rounded-t-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                                                    <span
                                                        aria-hidden="true"
                                                        className={`block w-full rounded-t-sm ${selectedDay?.date === day.date ? 'bg-primary' : 'bg-foreground/50 group-hover:bg-foreground/70'}`}
                                                        style={{
                                                            height: day.published
                                                                ? `${Math.max(2, (day.published / maximum) * 100)}%`
                                                                : 2,
                                                        }}
                                                    />
                                                </button>
                                            ))}
                                        </div>
                                        <div
                                            aria-hidden="true"
                                            className="mt-2 flex justify-between text-xs text-muted-foreground">
                                            <span>{daily[0] ? dayLabel(daily[0].date) : ''}</span>
                                            <span>
                                                {daily.at(-1) ? dayLabel(daily.at(-1)!.date) : ''}
                                            </span>
                                        </div>
                                    </div>
                                    <p
                                        className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground"
                                        aria-live="polite">
                                        {selectedDay
                                            ? m.delivery_day_label({
                                                  date: dayLabel(selectedDay.date),
                                                  published: selectedDay.published,
                                                  failed: selectedDay.failed,
                                                  ambiguous: selectedDay.ambiguous,
                                              })
                                            : ''}
                                    </p>
                                </>
                            ) : (
                                <p className="py-8 text-sm text-muted-foreground">
                                    {m.delivery_empty()}
                                </p>
                            )}
                        </div>
                        {destinations.length ? (
                            <div className="min-w-0">
                                <h3 className="mb-3 text-sm font-medium">
                                    {m.delivery_by_destination()}
                                </h3>
                                <table
                                    className="w-full table-fixed text-left text-sm"
                                    data-delivery-destinations>
                                    <thead className="[&_th]:break-words">
                                        <tr className="text-xs text-muted-foreground">
                                            <th scope="col" className="w-2/5 pb-2 font-normal">
                                                {m.delivery_destination()}
                                            </th>
                                            <th
                                                scope="col"
                                                className="pb-2 pl-3 text-right font-normal">
                                                {m.delivery_published()}
                                            </th>
                                            <th
                                                scope="col"
                                                className="pb-2 pl-3 text-right font-normal">
                                                {m.delivery_failed()}
                                            </th>
                                            <th
                                                scope="col"
                                                className="pb-2 pl-3 text-right font-normal">
                                                {m.delivery_ambiguous()}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {destinations.map((row, index) => (
                                            <tr
                                                key={row.channelId ?? `unknown-${index}`}
                                                className="border-t border-border">
                                                <th
                                                    scope="row"
                                                    className="max-w-48 break-words py-3 font-normal">
                                                    {row.name ?? m.delivery_retired_destination()}
                                                </th>
                                                <td className="py-3 pl-3 text-right tabular-nums">
                                                    {formatNumber(row.published, locale)}
                                                </td>
                                                <td className="py-3 pl-3 text-right tabular-nums">
                                                    {formatNumber(row.failed, locale)}
                                                </td>
                                                <td className="py-3 pl-3 text-right tabular-nums">
                                                    {formatNumber(row.ambiguous, locale)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}
                    </div>
                </>
            ) : null}
        </section>
    )
}
