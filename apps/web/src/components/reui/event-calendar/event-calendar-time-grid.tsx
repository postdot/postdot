// Title: Event Calendar Time Grid
// Description: Readable week and day views built on the headless calendar state.

'use client'

import { AddIcon } from '@solar-icons/react/bold/add'
import { addDays, addMinutes, format } from 'date-fns'
import { Fragment, useMemo, type CSSProperties, type MouseEvent } from 'react'

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

const MIN_SLOT_HEIGHT = '2rem'
const TIME_GUTTER_WIDTH = '3.5rem'

interface EventCalendarTimeSlot {
    readonly endMinute: number
    readonly startMinute: number
}

interface EventCalendarTimeGridProps {
    readonly className?: string
}

/**
 * The time grid is a publication schedule rather than an appointment editor.
 * Empty time slots are clickable and delegate to Herald's existing composer;
 * event positioning and resizing stay read-only until they receive a separate
 * product decision.
 *
 * Rows deliberately flow with their content. Every event that starts in an
 * hour gets its own stacked row inside that hour, so simultaneous publications
 * expand the hour instead of being squeezed into a set of fixed-width columns.
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
    const interval = Math.max(15, Math.min(60, settings.slotDuration))
    const startMinute = startHour * 60
    const endMinute = endHour * 60
    const timeSlots = useMemo<EventCalendarTimeSlot[]>(
        () =>
            Array.from({ length: Math.ceil((endMinute - startMinute) / interval) }, (_, index) => {
                const slotStart = startMinute + index * interval
                return {
                    startMinute: slotStart,
                    endMinute: Math.min(endMinute, slotStart + interval),
                }
            }),
        [endMinute, interval, startMinute]
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
    const hasAllDayEvents = occurrences.some(
        occurrence => occurrence.allDay || spansMultipleDays(occurrence, settings.timeZone)
    )

    if (view !== 'week' && view !== 'day') return null

    return (
        <EventCalendarViewContext.Provider value={{ view }}>
            <div
                className={className}
                data-slot="event-calendar-time-grid"
                data-view={view}
                style={
                    {
                        '--ec-gutter-width': TIME_GUTTER_WIDTH,
                        '--ec-slot-min-height': MIN_SLOT_HEIGHT,
                    } as CSSProperties
                }>
                <div className={view === 'day' ? 'overflow-x-visible' : 'overflow-x-auto pb-1'}>
                    <div className={view === 'week' ? 'min-w-[48rem]' : undefined}>
                        <div
                            className="grid gap-0.5"
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
                                className="mt-1 grid gap-0.5"
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
                            className="mt-1 grid auto-rows-min gap-0.5"
                            data-slot="event-calendar-time-grid-body"
                            style={{ gridTemplateColumns }}>
                            {timeSlots.map(slot => (
                                <Fragment key={slot.startMinute}>
                                    <EventCalendarTimeGutterSlot<TData>
                                        day={days[0] ?? visibleRange.start}
                                        slot={slot}
                                    />
                                    {days.map(day => (
                                        <EventCalendarTimeGridSlot<TData>
                                            day={day}
                                            key={`${day.getTime()}-${slot.startMinute}`}
                                            slot={slot}
                                            view={view}
                                        />
                                    ))}
                                </Fragment>
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
            className={[
                'min-w-0 truncate rounded-md bg-muted/70 px-3 py-2 text-center font-medium text-muted-foreground',
                isToday ? 'bg-primary/10 text-foreground' : '',
                isOutside ? 'opacity-60' : '',
                viewConfig.todayClassName ?? '',
            ].join(' ')}
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
            className={[
                'min-h-9 min-w-0 rounded-md bg-background p-1 shadow-field',
                isOff ? offClassName : '',
                isToday ? 'bg-primary/5' : '',
                isOutside ? 'opacity-60' : '',
                viewConfig.dayClassName?.(day) ?? '',
            ].join(' ')}
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

function EventCalendarTimeGutterSlot<TData>({
    day,
    slot,
}: {
    readonly day: Date
    readonly slot: EventCalendarTimeSlot
}) {
    const settings = useEventCalendarSettings<TData>()
    const viewConfig = useEventCalendarViewConfig<TData>()
    const slotStart = getSlotDate(day, slot.startMinute, settings.timeZone)
    const labelFormat =
        slot.startMinute % 60 === 0
            ? settings.i18n.formats.timeGutter
            : settings.i18n.formats.timeGutterMinute

    return (
        <div
            aria-hidden="true"
            className="flex min-h-[var(--ec-slot-min-height)] items-start justify-end pe-1.5 pt-1.5 text-[0.6875rem] tabular-nums text-muted-foreground"
            data-slot="event-calendar-time-gutter-slot">
            {viewConfig.renderTimeGutterSlot?.({
                hour: Math.floor(slot.startMinute / 60),
                minute: slot.startMinute % 60,
                time: slotStart,
            }) ??
                format(toZoned(slotStart, settings.timeZone), labelFormat, {
                    locale: settings.locale,
                })}
        </div>
    )
}

function EventCalendarTimeGridSlot<TData>({
    day,
    slot,
    view,
}: {
    readonly day: Date
    readonly slot: EventCalendarTimeSlot
    readonly view: 'week' | 'day'
}) {
    const settings = useEventCalendarSettings<TData>()
    const viewConfig = useEventCalendarViewConfig<TData>()
    const { segments, isToday, isOutside } = useEventCalendarDay<TData>(day)
    const { effective } = useEventCalendarViewSettings()
    const dayStart = zonedStartOfDay(day, settings.timeZone)
    const slotStart = getSlotDate(day, slot.startMinute, settings.timeZone)
    const slotEnd = getSlotDate(day, slot.endMinute, settings.timeZone)
    const timeLabel = settings.i18n.functions.formatEventTime(slotStart, slotEnd, false, {
        locale: settings.locale,
    })
    const timedSegments = segments.timed.filter(segment => {
        const segmentStart = segment.startMin ?? slot.startMinute
        return segmentStart >= slot.startMinute && segmentStart < slot.endMinute
    })
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
    const dayLabel = format(toZoned(dayStart, settings.timeZone), settings.i18n.formats.dayAria, {
        locale: settings.locale,
    })
    const addLabel = `${settings.i18n.labels.addEvent} · ${dayLabel} · ${timeLabel}`
    const handleSlotClick = (event: MouseEvent<HTMLDivElement>) => {
        if (
            event.target instanceof Element &&
            event.target.closest('[data-slot="event-calendar-event"]')
        )
            return
        settings.onSlotClick?.(
            {
                date: slotStart,
                end: slotEnd,
                allDay: false,
                view,
            },
            event
        )
    }
    const handleAddClick = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        settings.onSlotClick?.(
            {
                date: slotStart,
                end: slotEnd,
                allDay: false,
                view,
            },
            event
        )
    }

    return (
        <div
            className={[
                'group/time-slot relative min-h-[var(--ec-slot-min-height)] min-w-0 cursor-pointer rounded-sm p-1 shadow-field transition-colors hover:bg-muted/70',
                (slot.startMinute / 60) % 2 === 1 ? 'bg-surface-field/35' : 'bg-background',
                isOff ? offClassName : '',
                isToday ? 'bg-primary/5' : '',
                isOutside ? 'opacity-60' : '',
                viewConfig.dayClassName?.(day) ?? '',
            ].join(' ')}
            data-day={format(toZoned(day, settings.timeZone), 'yyyy-MM-dd')}
            data-empty={timedSegments.length === 0 ? true : undefined}
            data-slot="event-calendar-time-slot"
            data-time={format(toZoned(slotStart, settings.timeZone), 'HH:mm')}
            onClick={handleSlotClick}>
            <button
                aria-label={addLabel}
                className="absolute end-1 top-1 z-10 flex size-6 -translate-y-0.5 items-center justify-center rounded-sm bg-primary text-primary-foreground opacity-0 shadow-control transition-opacity group-hover/time-slot:opacity-100 focus-visible:opacity-100"
                data-slot="event-calendar-time-slot-add"
                onClick={handleAddClick}
                tabIndex={-1}
                type="button">
                <AddIcon aria-hidden="true" className="size-3.5" />
            </button>
            <div className="pointer-events-none relative z-20 grid content-start gap-1">
                {timedSegments.map(segment => (
                    <EventCalendarTimeGridEvent<TData>
                        key={segment.occurrence.key}
                        segment={segment}
                    />
                ))}
            </div>
        </div>
    )
}

function EventCalendarTimeGridEvent<TData>({
    segment,
}: {
    readonly segment: EventCalendarSegment<TData>
}) {
    return (
        <EventCalendarEvent
            className="pointer-events-auto !min-h-10 !overflow-visible items-start rounded-md px-2 py-1.5"
            segment={segment}
        />
    )
}

function getSlotDate(day: Date, minute: number, timeZone: string) {
    return addMinutes(toZoned(zonedStartOfDay(day, timeZone), timeZone), minute)
}

export { EventCalendarTimeGrid }
