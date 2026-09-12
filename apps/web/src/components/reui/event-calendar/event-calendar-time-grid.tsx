// Title: Event Calendar Time Grid
// Description: Readable week and day views built on the headless calendar state.

'use client'

import { cn } from '@herald/ui/lib/utils'
import { addDays, format } from 'date-fns'
import { useMemo, type CSSProperties } from 'react'

import {
    EventCalendarViewContext,
    useEventCalendarDay,
    useEventCalendarNavigation,
    useEventCalendarOccurrences,
    useEventCalendarSettings,
    useEventCalendarView,
    useEventCalendarViewConfig,
    useEventCalendarViewSettings,
} from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarEvent } from '@/components/reui/event-calendar/event-calendar-event'
import {
    resolveOffDay,
    spansMultipleDays,
    toZoned,
    zonedStartOfDay,
} from '@/components/reui/event-calendar/event-calendar-lib'
import type {
    CalendarView,
    EventCalendarSegment,
} from '@/components/reui/event-calendar/event-calendar-types'

const HOUR_HEIGHT = '3rem'
const TIME_GUTTER_WIDTH = '4.5rem'

interface EventCalendarTimeGridProps {
    readonly className?: string
}

/**
 * The time grid intentionally stays read-only for now. Dragging and slot
 * creation are disabled for Herald's first week/day pass; an event remains a
 * direct preview target and the page-level action remains the single creation
 * entry point. Keeping the layout separate from the state engine leaves those
 * interactions available for a later, deliberate product decision.
 */
function EventCalendarTimeGrid<TData = unknown>({ className }: EventCalendarTimeGridProps) {
    const { view } = useEventCalendarView()
    const { visibleRange } = useEventCalendarNavigation()
    const occurrences = useEventCalendarOccurrences<TData>()
    const settings = useEventCalendarSettings<TData>()
    const { effective } = useEventCalendarViewSettings()

    const days = useMemo(() => {
        const result: Date[] = []
        let cursor = zonedStartOfDay(visibleRange.start, settings.timeZone)

        while (cursor < visibleRange.end) {
            const isWeekend = settings.weekendDays.includes(
                toZoned(cursor, settings.timeZone).getDay()
            )
            if (view === 'day' || effective.weekends || !isWeekend) result.push(cursor)
            cursor = zonedStartOfDay(
                addDays(toZoned(cursor, settings.timeZone), 1),
                settings.timeZone
            )
        }

        return result
    }, [effective.weekends, settings.timeZone, settings.weekendDays, view, visibleRange])

    const startHour = Math.max(0, Math.min(23, settings.dayStartHour))
    const endHour = Math.max(startHour + 1, Math.min(24, settings.dayEndHour))
    const interval = Math.max(1, Math.min(60, settings.slotDuration))
    const totalMinutes = (endHour - startHour) * 60
    const slotCount = Math.ceil(totalMinutes / interval)
    const hasAllDayEvents = occurrences.some(
        occurrence => occurrence.allDay || spansMultipleDays(occurrence, settings.timeZone)
    )
    const gridTemplateColumns = `var(--ec-gutter-width) repeat(${Math.max(1, days.length)}, minmax(0, 1fr))`
    const dateFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(settings.locale?.code ?? 'en-US', {
                day: 'numeric',
                month: view === 'day' ? 'long' : 'short',
                timeZone: settings.timeZone,
                weekday: view === 'day' ? 'long' : 'short',
            }),
        [settings.locale?.code, settings.timeZone, view]
    )

    if (view !== 'week' && view !== 'day') return null

    return (
        <EventCalendarViewContext.Provider value={{ view }}>
            <div
                className={cn('min-w-0', className)}
                data-slot="event-calendar-time-grid"
                data-view={view}
                style={
                    {
                        '--ec-gutter-width': TIME_GUTTER_WIDTH,
                        '--ec-hour-height': HOUR_HEIGHT,
                    } as CSSProperties
                }>
                <div className={cn('overflow-x-auto pb-1', view === 'day' && 'overflow-x-visible')}>
                    <div className={cn(view === 'week' && 'min-w-[52rem]')}>
                        <div
                            className="grid gap-1"
                            data-slot="event-calendar-time-grid-header"
                            style={{ gridTemplateColumns }}>
                            <div aria-hidden="true" className="rounded-md bg-surface-inset" />
                            {days.map(day => (
                                <EventCalendarTimeGridDayHeader<TData>
                                    dateFormatter={dateFormatter}
                                    day={day}
                                    key={day.getTime()}
                                    view={view}
                                />
                            ))}
                        </div>

                        {hasAllDayEvents ? (
                            <div
                                className="mt-1 grid gap-1"
                                data-slot="event-calendar-time-grid-all-day"
                                style={{ gridTemplateColumns }}>
                                <div className="flex min-h-9 items-center justify-end px-2 text-[0.6875rem] text-muted-foreground">
                                    {settings.i18n.labels.allDay}
                                </div>
                                {days.map(day => (
                                    <EventCalendarTimeGridAllDayCell<TData>
                                        day={day}
                                        key={day.getTime()}
                                    />
                                ))}
                            </div>
                        ) : null}

                        <div
                            className="mt-1 grid gap-1"
                            data-slot="event-calendar-time-grid-body"
                            style={{ gridTemplateColumns }}>
                            <EventCalendarTimeGutter
                                day={days[0] ?? visibleRange.start}
                                endHour={endHour}
                                interval={interval}
                                slotCount={slotCount}
                                startHour={startHour}
                                totalMinutes={totalMinutes}
                            />
                            {days.map(day => (
                                <EventCalendarTimeGridDay<TData>
                                    day={day}
                                    endHour={endHour}
                                    interval={interval}
                                    key={day.getTime()}
                                    slotCount={slotCount}
                                    startHour={startHour}
                                    totalMinutes={totalMinutes}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </EventCalendarViewContext.Provider>
    )
}

function EventCalendarTimeGridDayHeader<TData>({
    dateFormatter,
    day,
    view,
}: {
    readonly dateFormatter: Intl.DateTimeFormat
    readonly day: Date
    readonly view: CalendarView
}) {
    const viewConfig = useEventCalendarViewConfig<TData>()
    const { isToday, isOutside } = useEventCalendarDay<TData>(day)

    return (
        <div
            aria-label={dateFormatter.format(day)}
            className={cn(
                'min-w-0 truncate rounded-md bg-muted/70 px-3 py-2 text-center font-medium text-muted-foreground',
                isToday && 'bg-primary/10 text-foreground',
                isOutside && 'opacity-60',
                viewConfig.todayClassName
            )}
            data-slot="event-calendar-time-grid-day-header"
            role="columnheader">
            {viewConfig.renderDayHeader?.({ day, view, isToday }) ?? dateFormatter.format(day)}
        </div>
    )
}

function EventCalendarTimeGridAllDayCell<TData>({ day }: { readonly day: Date }) {
    const settings = useEventCalendarSettings<TData>()
    const viewConfig = useEventCalendarViewConfig<TData>()
    const { segments, isToday, isOutside } = useEventCalendarDay<TData>(day)
    const { effective } = useEventCalendarViewSettings()
    const isOff = resolveOffDay(
        day,
        settings.timeZone,
        effective.offDays
            ? typeof viewConfig.offDays === 'object'
                ? viewConfig.offDays
                : true
            : false,
        settings.weekendDays
    )
    const offClassName =
        (typeof viewConfig.offDays === 'object' && viewConfig.offDays.className) || 'bg-muted/25'

    return (
        <div
            className={cn(
                'min-w-0 min-h-9 rounded-md bg-background p-1 shadow-field',
                isOff && offClassName,
                isToday && 'bg-primary/5',
                isOutside && 'opacity-60',
                viewConfig.dayClassName?.(day)
            )}
            data-slot="event-calendar-time-grid-all-day-cell">
            <div className="grid gap-1">
                {segments.allDay.map(segment => (
                    <EventCalendarEvent
                        className="min-h-7 items-center"
                        key={segment.occurrence.key}
                        segment={segment}
                    />
                ))}
            </div>
        </div>
    )
}

function EventCalendarTimeGutter({
    day,
    endHour,
    interval,
    slotCount,
    startHour,
    totalMinutes,
}: {
    readonly day: Date
    readonly endHour: number
    readonly interval: number
    readonly slotCount: number
    readonly startHour: number
    readonly totalMinutes: number
}) {
    const settings = useEventCalendarSettings()
    const viewConfig = useEventCalendarViewConfig()
    const dayStart = zonedStartOfDay(day, settings.timeZone)

    return (
        <div
            aria-hidden="true"
            className="relative min-w-0 text-muted-foreground"
            data-slot="event-calendar-time-gutter"
            style={{
                height: `calc(var(--ec-hour-height) * ${totalMinutes} / 60)`,
            }}>
            {Array.from({ length: slotCount }, (_, index) => {
                const minute = startHour * 60 + index * interval
                if (minute >= endHour * 60) return null
                const time = new Date(dayStart.getTime() + minute * 60_000)
                const labelFormat =
                    minute % 60 === 0
                        ? settings.i18n.formats.timeGutter
                        : settings.i18n.formats.timeGutterMinute
                return (
                    <div
                        className={cn(
                            'absolute inset-x-0 flex -translate-y-1/2 justify-end pe-2 text-[0.6875rem] tabular-nums',
                            index === 0 && 'translate-y-0'
                        )}
                        data-slot="event-calendar-time-gutter-slot"
                        key={minute}
                        style={{
                            top: `calc(var(--ec-hour-height) * ${minute - startHour * 60} / 60)`,
                        }}>
                        {viewConfig.renderTimeGutterSlot?.({
                            hour: Math.floor(minute / 60),
                            minute: minute % 60,
                            time,
                        }) ??
                            format(toZoned(time, settings.timeZone), labelFormat, {
                                locale: settings.locale,
                            })}
                    </div>
                )
            })}
        </div>
    )
}

function EventCalendarTimeGridDay<TData>({
    day,
    endHour,
    interval,
    slotCount,
    startHour,
    totalMinutes,
}: {
    readonly day: Date
    readonly endHour: number
    readonly interval: number
    readonly slotCount: number
    readonly startHour: number
    readonly totalMinutes: number
}) {
    const settings = useEventCalendarSettings<TData>()
    const viewConfig = useEventCalendarViewConfig<TData>()
    const { segments, isToday, isOutside } = useEventCalendarDay<TData>(day)
    const { effective } = useEventCalendarViewSettings()
    const startMinute = startHour * 60
    const endMinute = endHour * 60
    const isOff = resolveOffDay(
        day,
        settings.timeZone,
        effective.offDays
            ? typeof viewConfig.offDays === 'object'
                ? viewConfig.offDays
                : true
            : false,
        settings.weekendDays
    )
    const offClassName =
        (typeof viewConfig.offDays === 'object' && viewConfig.offDays.className) || 'bg-muted/25'

    return (
        <div
            aria-label={format(toZoned(day, settings.timeZone), settings.i18n.formats.dayAria, {
                locale: settings.locale,
            })}
            className={cn(
                'relative min-w-0 overflow-hidden rounded-md bg-background shadow-field',
                isOff && offClassName,
                isToday && 'bg-primary/5',
                isOutside && 'opacity-60',
                viewConfig.dayClassName?.(day)
            )}
            data-slot="event-calendar-time-grid-day"
            style={{ height: `calc(var(--ec-hour-height) * ${totalMinutes} / 60)` }}>
            {viewConfig.renderDayColumnBackground?.({
                boundsEndMin: endMinute,
                boundsStartMin: startMinute,
                day,
                totalMinutes,
            })}
            {Array.from({ length: slotCount }, (_, index) => {
                const minute = startMinute + index * interval
                if (minute >= endMinute) return null
                const duration = Math.min(interval, endMinute - minute)
                return (
                    <div
                        aria-hidden="true"
                        className={cn(
                            'pointer-events-none absolute inset-x-0',
                            index % 2 === 0 ? 'bg-background' : 'bg-surface-field/35'
                        )}
                        key={minute}
                        style={{
                            height: `calc(var(--ec-hour-height) * ${duration} / 60)`,
                            top: `calc(var(--ec-hour-height) * ${minute - startMinute} / 60)`,
                        }}
                    />
                )
            })}
            <div className="absolute inset-0" data-slot="event-calendar-time-grid-events">
                {segments.timed.map(segment => {
                    const eventStart = Math.max(startMinute, segment.startMin ?? startMinute)
                    const eventEnd = Math.min(
                        endMinute,
                        Math.max(eventStart + 30, segment.endMin ?? eventStart + interval)
                    )
                    if (eventEnd <= eventStart) return null

                    return (
                        <EventCalendarTimeGridEvent<TData>
                            endMinute={endMinute}
                            key={segment.occurrence.key}
                            segment={segment}
                            startMinute={startMinute}
                        />
                    )
                })}
            </div>
        </div>
    )
}

function EventCalendarTimeGridEvent<TData>({
    endMinute,
    segment,
    startMinute,
}: {
    readonly endMinute: number
    readonly segment: EventCalendarSegment<TData>
    readonly startMinute: number
}) {
    const viewConfig = useEventCalendarViewConfig<TData>()
    const start = Math.max(startMinute, segment.startMin ?? startMinute)
    const end = Math.min(endMinute, Math.max(start + 30, segment.endMin ?? start + 30))
    const duration = Math.max(15, end - start)
    const column = segment.column ?? 0
    const columnCount = Math.max(1, segment.columnCount ?? 1)
    const columnSpan = Math.max(1, Math.min(columnCount - column, segment.columnSpan ?? 1))

    return (
        <EventCalendarEvent
            className={cn('absolute items-start p-1', viewConfig.classNames?.event)}
            segment={segment}
            style={
                {
                    '--ec-event-color': segment.occurrence.event.color ?? 'var(--color-primary)',
                    height: `calc(var(--ec-hour-height) * ${duration} / 60 - 0.25rem)`,
                    left: `calc(${column * 100}% / ${columnCount} + 0.125rem)`,
                    top: `calc(var(--ec-hour-height) * ${start - startMinute} / 60 + 0.125rem)`,
                    width: `calc(${columnSpan * 100}% / ${columnCount} - 0.25rem)`,
                    zIndex: segment.occurrence.event.zIndex ?? 10 + column,
                } as CSSProperties
            }
        />
    )
}

export { EventCalendarTimeGrid }
