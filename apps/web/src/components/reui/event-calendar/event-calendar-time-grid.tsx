// Title: Event Calendar Time Grid
// Description: Readable week and day views built on the headless calendar state.

'use client'

import { AddIcon } from '@solar-icons/react/bold/add'
import { addDays, addMinutes, format } from 'date-fns'
import {
    Fragment,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react'

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
import {
    getFirstVisibleTimedOccurrence,
    getInitialTimeGridAnchor,
} from '@/lib/event-calendar-time-anchor'

const MIN_SLOT_HEIGHT = '2rem'
const TIME_GUTTER_WIDTH = '3.5rem'
const DAY_COLUMN_MIN_WIDTH = 152
const DAY_COLUMN_MAX_WIDTH = 360
const DAY_COLUMN_RESIZE_STEP = 16

interface EventCalendarTimeSlot {
    readonly endMinute: number
    readonly startMinute: number
}

interface EventCalendarTimeGridProps {
    readonly className?: string
    /** Stable consumer key used to remember the user's day-column widths. */
    readonly storageKey?: string
}

interface ColumnResizeState {
    readonly columnIndex: number
    readonly pointerId: number
    readonly startX: number
    readonly startWidths: number[]
    currentWidths: number[]
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
function EventCalendarTimeGrid<TData = unknown>({
    className,
    storageKey,
}: EventCalendarTimeGridProps) {
    const { view } = useEventCalendarView()
    const { visibleRange } = useEventCalendarNavigation()
    const occurrences = useEventCalendarOccurrences<TData>()
    const settings = useEventCalendarSettings<TData>()
    const viewConfig = useEventCalendarViewConfig<TData>()
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
    const timeGridRef = useRef<HTMLDivElement | null>(null)
    const firstVisibleTimedOccurrence = useMemo(
        () => getFirstVisibleTimedOccurrence(occurrences, visibleRange),
        [occurrences, visibleRange.end, visibleRange.start]
    )
    const initialTimeAnchor = useMemo(
        () =>
            getInitialTimeGridAnchor({
                endHour,
                interval,
                occurrences,
                startHour,
                timeZone: settings.timeZone,
                visibleRange,
            }),
        [
            endHour,
            interval,
            occurrences,
            settings.timeZone,
            startHour,
            visibleRange.end,
            visibleRange.start,
        ]
    )
    const appliedTimeAnchor = useRef<string | null>(null)
    const timeAnchorKey = [
        view,
        visibleRange.start.getTime(),
        visibleRange.end.getTime(),
        firstVisibleTimedOccurrence === undefined ? 'empty' : 'data',
    ].join(':')

    useLayoutEffect(() => {
        if (view !== 'week' && view !== 'day') return
        if (appliedTimeAnchor.current === timeAnchorKey) return

        if (firstVisibleTimedOccurrence === undefined) {
            appliedTimeAnchor.current = timeAnchorKey
            return
        }

        if (typeof window === 'undefined') return

        let frameId: number | null = null
        let attempts = 0
        const applyAnchor = () => {
            frameId = null
            attempts += 1

            const root = timeGridRef.current
            if (root === null) {
                if (attempts < 3) frameId = window.requestAnimationFrame(applyAnchor)
                return
            }

            const target = root.querySelector<HTMLElement>(
                `[data-slot="event-calendar-time-slot"][data-time="${formatTimeSlot(initialTimeAnchor)}"]`
            )
            const scroller = findVerticalScroller(root)
            if (target === null || scroller === null) {
                if (attempts < 3) frameId = window.requestAnimationFrame(applyAnchor)
                return
            }

            const targetRect = target.getBoundingClientRect()
            const scrollerRect = scroller.getBoundingClientRect()
            const header =
                scroller.dataset.scrollMode === 'contained'
                    ? root.querySelector<HTMLElement>(
                          '[data-slot="event-calendar-time-grid-header"]'
                      )
                    : null
            const stickyHeaderHeight = header?.getBoundingClientRect().height ?? 0
            const desiredScrollTop =
                scroller.scrollTop + targetRect.top - scrollerRect.top - stickyHeaderHeight
            const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
            scroller.scrollTop = Math.min(maxScrollTop, Math.max(0, desiredScrollTop))
            appliedTimeAnchor.current = timeAnchorKey
        }

        // The time-grid rows can grow after their first paint when event content
        // and persisted column widths settle. Measure after those layout passes,
        // while still applying the anchor only once for this view/range.
        frameId = window.requestAnimationFrame(() => {
            frameId = window.requestAnimationFrame(applyAnchor)
        })

        return () => {
            if (frameId !== null) window.cancelAnimationFrame(frameId)
        }
    }, [firstVisibleTimedOccurrence, initialTimeAnchor, timeAnchorKey, view])
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
    const columnStorageKey =
        storageKey === undefined
            ? undefined
            : `herald:event-calendar:day-widths:v1:${storageKey}:${view}`
    const [columnWidths, setColumnWidths] = useState<number[] | null>(null)
    const resizeState = useRef<ColumnResizeState | null>(null)
    const resizeCleanup = useRef<(() => void) | null>(null)

    useEffect(() => {
        setColumnWidths(readColumnWidths(columnStorageKey, days.length))
        resizeCleanup.current?.()
        resizeState.current = null
    }, [columnStorageKey, days.length])

    useEffect(
        () => () => {
            resizeCleanup.current?.()
        },
        []
    )

    const renderedColumnWidths = useCallback((target: HTMLElement) => {
        const header = target.closest<HTMLElement>('[data-slot="event-calendar-time-grid-header"]')
        if (header === null) return []
        return Array.from(
            header.querySelectorAll<HTMLElement>(
                '[data-slot="event-calendar-time-grid-day-header"]'
            ),
            cell => Math.round(cell.getBoundingClientRect().width)
        )
    }, [])

    const widthsForInteraction = useCallback(
        (target: HTMLElement) => {
            const widths = columnWidths ?? renderedColumnWidths(target)
            return widths.length === days.length ? widths : null
        },
        [columnWidths, days.length, renderedColumnWidths]
    )

    const persistColumnWidths = useCallback(
        (widths: number[]) => {
            setColumnWidths(widths)
            if (columnStorageKey === undefined || typeof window === 'undefined') return
            try {
                window.localStorage.setItem(columnStorageKey, JSON.stringify(widths))
            } catch {
                // A blocked or full localStorage must not make resizing fail.
            }
        },
        [columnStorageKey]
    )

    const beginColumnResize = useCallback(
        (columnIndex: number, event: ReactPointerEvent<HTMLButtonElement>) => {
            event.preventDefault()
            event.stopPropagation()
            const widths = widthsForInteraction(event.currentTarget)
            if (widths === null || columnIndex >= widths.length - 1) return
            resizeCleanup.current?.()
            resizeState.current = {
                columnIndex,
                currentWidths: widths,
                pointerId: event.pointerId,
                startWidths: widths,
                startX: event.clientX,
            }
            setColumnWidths(current => current ?? widths)

            // The separator is only 8px wide; keep the gesture alive after the
            // pointer leaves it without relying on a fragile pointer capture.
            const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
                const state = resizeState.current
                if (state === null || state.pointerId !== moveEvent.pointerId) return
                const nextWidths = resizeColumn(
                    state.startWidths,
                    state.columnIndex,
                    moveEvent.clientX - state.startX
                )
                state.currentWidths = nextWidths
                setColumnWidths(nextWidths)
            }
            const onPointerEnd = (endEvent: globalThis.PointerEvent) => {
                const state = resizeState.current
                if (state === null || state.pointerId !== endEvent.pointerId) return
                persistColumnWidths(state.currentWidths)
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerEnd)
                window.removeEventListener('pointercancel', onPointerEnd)
                resizeCleanup.current = null
                resizeState.current = null
            }
            window.addEventListener('pointermove', onPointerMove)
            window.addEventListener('pointerup', onPointerEnd)
            window.addEventListener('pointercancel', onPointerEnd)
            resizeCleanup.current = () => {
                window.removeEventListener('pointermove', onPointerMove)
                window.removeEventListener('pointerup', onPointerEnd)
                window.removeEventListener('pointercancel', onPointerEnd)
            }
        },
        [persistColumnWidths, widthsForInteraction]
    )

    const keyColumnResize = useCallback(
        (columnIndex: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            const widths = widthsForInteraction(event.currentTarget)
            if (widths === null || columnIndex >= widths.length - 1) return
            const delta =
                event.key === 'Home'
                    ? DAY_COLUMN_MIN_WIDTH - (widths[columnIndex] ?? DAY_COLUMN_MIN_WIDTH)
                    : event.key === 'End'
                      ? DAY_COLUMN_MAX_WIDTH - (widths[columnIndex] ?? DAY_COLUMN_MIN_WIDTH)
                      : event.key === 'ArrowRight'
                        ? DAY_COLUMN_RESIZE_STEP
                        : -DAY_COLUMN_RESIZE_STEP
            persistColumnWidths(resizeColumn(widths, columnIndex, delta))
        },
        [persistColumnWidths, widthsForInteraction]
    )

    if (view !== 'week' && view !== 'day') return null

    const gridTemplateColumns =
        columnWidths?.length === days.length
            ? `var(--ec-gutter-width) ${columnWidths.map(width => `${width}px`).join(' ')}`
            : `var(--ec-gutter-width) repeat(${Math.max(1, days.length)}, minmax(var(--ec-day-column-min-width), 1fr))`

    return (
        <EventCalendarViewContext.Provider value={{ view }}>
            <div
                className={className}
                data-slot="event-calendar-time-grid"
                data-view={view}
                ref={timeGridRef}
                style={
                    {
                        '--ec-gutter-width': TIME_GUTTER_WIDTH,
                        '--ec-day-column-min-width': '9.5rem',
                        '--ec-slot-min-height': MIN_SLOT_HEIGHT,
                    } as CSSProperties
                }>
                <div
                    className={
                        viewConfig.scrollMode === 'contained'
                            ? 'max-h-[min(70vh,48rem)] overflow-auto overscroll-contain'
                            : 'overflow-x-auto'
                    }
                    data-scroll-mode={viewConfig.scrollMode}
                    data-slot="event-calendar-time-grid-scroll">
                    <div className="overflow-visible pb-1">
                        <div className={view === 'week' ? 'min-w-[64rem]' : undefined}>
                            <div
                                className={[
                                    'grid gap-0.5',
                                    viewConfig.scrollMode === 'contained'
                                        ? 'sticky top-0 z-30 bg-surface-inset'
                                        : '',
                                ].join(' ')}
                                data-slot="event-calendar-time-grid-header"
                                style={{ gridTemplateColumns }}>
                                <div
                                    aria-hidden="true"
                                    className="sticky start-0 z-40 rounded-md bg-surface-inset"
                                    data-slot="event-calendar-time-grid-gutter-header"
                                />
                                {days.map((day, columnIndex) => (
                                    <EventCalendarTimeGridDayHeader<TData>
                                        columnCount={days.length}
                                        columnIndex={columnIndex}
                                        dateFormatter={dateFormatter}
                                        day={day}
                                        key={day.getTime()}
                                        onColumnResizeKeyDown={keyColumnResize}
                                        onColumnResizeStart={beginColumnResize}
                                        columnWidth={columnWidths?.[columnIndex]}
                                        view={view}
                                    />
                                ))}
                            </div>

                            {hasAllDayEvents ? (
                                <div
                                    className="mt-1 grid gap-0.5"
                                    data-slot="event-calendar-time-grid-all-day"
                                    style={{ gridTemplateColumns }}>
                                    <div className="sticky start-0 z-30 flex min-h-9 items-center justify-end bg-surface-inset px-2 text-[0.6875rem] text-muted-foreground">
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
            </div>
        </EventCalendarViewContext.Provider>
    )
}

function EventCalendarTimeGridDayHeader<TData>({
    columnCount,
    columnIndex,
    dateFormatter,
    day,
    onColumnResizeKeyDown,
    onColumnResizeStart,
    columnWidth,
    view,
}: {
    readonly columnCount: number
    readonly columnIndex: number
    readonly dateFormatter: Intl.DateTimeFormat
    readonly day: Date
    readonly onColumnResizeKeyDown: (
        columnIndex: number,
        event: ReactKeyboardEvent<HTMLButtonElement>
    ) => void
    readonly onColumnResizeStart: (
        columnIndex: number,
        event: ReactPointerEvent<HTMLButtonElement>
    ) => void
    readonly columnWidth?: number
    readonly view: CalendarView
}) {
    const settings = useEventCalendarSettings<TData>()
    const viewConfig = useEventCalendarViewConfig<TData>()
    const { isToday, isOutside } = useEventCalendarDay<TData>(day)
    const resizeLabel = settings.i18n.labels.resizeColumn(dateFormatter.format(day))

    return (
        <div
            aria-label={dateFormatter.format(day)}
            className={[
                'relative min-w-0 rounded-md bg-muted/70 px-3 py-2 text-center font-medium text-muted-foreground',
                isToday ? 'bg-primary/10 text-foreground' : '',
                isOutside ? 'opacity-60' : '',
                viewConfig.todayClassName ?? '',
            ].join(' ')}
            data-slot="event-calendar-time-grid-day-header"
            role="columnheader">
            <span className="block min-w-0 truncate">
                {viewConfig.renderDayHeader?.({ day, view, isToday }) ?? dateFormatter.format(day)}
            </span>
            {columnIndex < columnCount - 1 && (
                <button
                    aria-label={resizeLabel}
                    aria-orientation="vertical"
                    aria-valuemax={DAY_COLUMN_MAX_WIDTH}
                    aria-valuemin={DAY_COLUMN_MIN_WIDTH}
                    aria-valuenow={columnWidth}
                    className="absolute inset-y-1 -end-1 z-20 flex w-2 cursor-col-resize touch-none items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 hover:opacity-100 focus-visible:bg-foreground/10 focus-visible:opacity-100 focus-visible:outline-none"
                    data-slot="event-calendar-time-grid-column-resize"
                    onKeyDown={event => onColumnResizeKeyDown(columnIndex, event)}
                    onPointerDown={event => onColumnResizeStart(columnIndex, event)}
                    role="separator"
                    type="button">
                    <span aria-hidden="true" className="h-5 w-px bg-foreground/20" />
                </button>
            )}
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
            className="sticky start-0 z-30 flex min-h-[var(--ec-slot-min-height)] items-start justify-end bg-surface-inset pe-1.5 pt-1.5 text-[0.6875rem] tabular-nums text-muted-foreground"
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
        if ((view === 'week' || view === 'day') && timedSegments.length > 0) return
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

    const addButton = (
        <EventCalendarTimeGridAddButton
            addLabel={addLabel}
            occupied={timedSegments.length > 0}
            onClick={handleAddClick}
        />
    )
    const publicationStack = (
        <div className="pointer-events-none relative z-20 grid content-start gap-1">
            {timedSegments.map(segment => (
                <EventCalendarTimeGridEvent<TData> key={segment.occurrence.key} segment={segment} />
            ))}
        </div>
    )
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
            {publicationStack}
            {addButton}
        </div>
    )
}

function EventCalendarTimeGridAddButton({
    addLabel,
    occupied,
    onClick,
}: {
    readonly addLabel: string
    readonly occupied: boolean
    readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void
}) {
    return (
        <button
            aria-label={addLabel}
            className="pointer-events-none absolute end-1 top-1 z-30 flex size-6 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground opacity-0 shadow-control transition-[background-color,box-shadow,opacity] group-hover/time-slot:pointer-events-auto group-hover/time-slot:opacity-100 group-focus-within/time-slot:pointer-events-auto group-focus-within/time-slot:opacity-100 hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            data-slot="event-calendar-time-slot-add"
            onClick={onClick}
            tabIndex={occupied ? 0 : -1}
            type="button">
            <AddIcon aria-hidden="true" className="size-3.5" />
        </button>
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

function readColumnWidths(storageKey: string | undefined, columnCount: number): number[] | null {
    if (storageKey === undefined || typeof window === 'undefined') return null
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
        if (!Array.isArray(parsed) || parsed.length !== columnCount) return null
        const widths = parsed.map(value => (typeof value === 'number' ? value : Number.NaN))
        if (
            widths.some(
                width =>
                    !Number.isFinite(width) ||
                    width < DAY_COLUMN_MIN_WIDTH ||
                    width > DAY_COLUMN_MAX_WIDTH
            )
        )
            return null
        return widths
    } catch {
        return null
    }
}

function resizeColumn(widths: readonly number[], columnIndex: number, delta: number) {
    const current = widths[columnIndex] ?? DAY_COLUMN_MIN_WIDTH
    const nextWidth = Math.min(
        DAY_COLUMN_MAX_WIDTH,
        Math.max(DAY_COLUMN_MIN_WIDTH, current + delta)
    )
    const next = [...widths]
    next[columnIndex] = Math.round(nextWidth)
    return next
}

function formatTimeSlot(minutes: number) {
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

function findVerticalScroller(element: HTMLElement): HTMLElement | null {
    const containedScroller = element.querySelector<HTMLElement>(
        '[data-slot="event-calendar-time-grid-scroll"][data-scroll-mode="contained"]'
    )
    if (containedScroller !== null) return containedScroller

    for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
    ) {
        const style = window.getComputedStyle(ancestor)
        if (!['auto', 'overlay', 'scroll'].includes(style.overflowY)) continue
        if (ancestor.scrollHeight > ancestor.clientHeight) return ancestor
    }

    const scrollingElement = document.scrollingElement
    return scrollingElement instanceof HTMLElement ? scrollingElement : null
}

export { EventCalendarTimeGrid }
