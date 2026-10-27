import { Button } from '@postdot/ui/components/button'
import { Kbd } from '@postdot/ui/components/kbd'
import { cn } from '@postdot/ui/lib/utils'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { CheckIcon } from '@solar-icons/react/linear/check'
import type { RegisterableHotkey } from '@tanstack/hotkeys'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { enUS, fr } from 'date-fns/locale'
import {
    useCallback,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type MouseEvent,
    type RefObject,
} from 'react'

import { PublicationCalendarPreviewSheet } from '@/components/publication-calendar-preview-sheet'
import {
    EventCalendar,
    type EventCalendarApi,
    useEventCalendarNavigation,
    useEventCalendarOccurrences,
    useEventCalendarSettings,
    useEventCalendarView,
    type EventCalendarRenderEventProps,
} from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarMonthView } from '@/components/reui/event-calendar/event-calendar-month-view'
import { EventCalendarTimeGrid } from '@/components/reui/event-calendar/event-calendar-time-grid'
import type {
    CalendarEvent,
    CalendarView,
    EventCalendarOccurrence,
    EventCalendarSlotInfo,
} from '@/components/reui/event-calendar/event-calendar-types'
import type { ChannelOccupancy, PublicationSummary } from '@/lib/api'
import { getZonedDateTimeParts } from '@/lib/date-time'
import { formatTime } from '@/lib/format'
import { formatCalendarTitle } from '@/lib/publication-calendar'
import { toDateKey } from '@/lib/publication-calendar'
import {
    type PublicationCalendarEventData,
    toOccupancyCalendarEvents,
    isPublicationCalendarView,
    type PublicationCalendarView,
    toPublicationCalendarEvents,
} from '@/lib/publication-calendar-events'
import * as m from '@/paraglide/messages.js'

const CALENDAR_VIEWS: CalendarView[] = ['month', 'week', 'day', 'agenda']
const MOBILE_CALENDAR_QUERY = '(max-width: 47.999rem)'
const CALENDAR_INTERACTIONS = {
    drag: false,
    resize: false,
    selectSlot: false,
} as const
const CALENDAR_VIEW_SHORTCUTS = {
    agenda: 'A',
    day: 'D',
    days: '5',
    month: 'M',
    resource: 'G',
    week: 'W',
} satisfies Record<CalendarView, RegisterableHotkey>

export function PublicationCalendar({
    channelNames = new Map<string, string>(),
    duePublicationIds,
    loading,
    locale,
    calendarDate,
    initialView,
    onSelectedPublicationIdsChange,
    occupancy = [],
    projectId,
    publications,
    readOnly = false,
    selectedPublicationIds,
    timeZone,
}: {
    /** Names of this project's channels, to label time taken elsewhere on the same channel. */
    readonly channelNames?: ReadonlyMap<string, string>
    readonly duePublicationIds: ReadonlySet<string>
    readonly loading: boolean
    readonly locale: string
    readonly calendarDate: Date
    readonly initialView?: PublicationCalendarView
    readonly onSelectedPublicationIdsChange: (publicationIds: readonly string[]) => void
    /** Time other projects already use on this project's shared channels. */
    readonly occupancy?: readonly ChannelOccupancy[]
    readonly projectId: string
    readonly publications: readonly PublicationSummary[]
    /**
     * Viewer mode: consultation stays identical, but the create entry points
     * and the selection entry point that drives bulk mutations are withheld
     * because the server refuses them for this role.
     */
    readonly readOnly?: boolean
    readonly selectedPublicationIds: ReadonlySet<string>
    readonly timeZone: string
}) {
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/overview' })
    const publicationEvents = useMemo(
        () => toPublicationCalendarEvents(publications, duePublicationIds),
        [duePublicationIds, publications]
    )
    const occupancyEvents = useMemo(
        () =>
            toOccupancyCalendarEvents(occupancy, item => {
                const channel = channelNames.get(item.channelId) ?? ''
                return item.project === null
                    ? m.calendar_occupied({ channel })
                    : `${item.project.title ?? m.calendar_occupied({ channel })} · ${item.project.name}`
            }),
        [channelNames, occupancy]
    )
    const events = useMemo<CalendarEvent<PublicationCalendarEventData>[]>(
        () => [...publicationEvents, ...occupancyEvents],
        [occupancyEvents, publicationEvents]
    )
    const dateFnsLocale = locale === 'fr' ? fr : enUS
    const i18n = useMemo(() => createCalendarI18n(locale, timeZone), [locale, timeZone])
    const isNarrow = useMediaQuery(MOBILE_CALENDAR_QUERY)
    const [expandedDay, setExpandedDay] = useState<Date | null>(null)
    const [previewPublicationId, setPreviewPublicationId] = useState<string | null>(null)
    const [selectionMode, setSelectionMode] = useState(false)
    const calendarShellRef = useRef<HTMLDivElement>(null)
    const calendarApiRef = useRef<EventCalendarApi<PublicationCalendarEventData> | null>(null)
    const expandedDayKey = expandedDay === null ? null : toDateKey(expandedDay, timeZone)
    const viewPreference = initialView ?? 'auto'
    const view = viewPreference === 'auto' ? (isNarrow ? 'agenda' : 'month') : viewPreference
    const eventIdsByKey = useMemo(
        () => new Map(publicationEvents.map(event => [calendarEventKey(event), event.id])),
        [publicationEvents]
    )
    const selectedEventKeys = useMemo(
        () =>
            publicationEvents
                .filter(event => selectedPublicationIds.has(event.id))
                .map(calendarEventKey),
        [publicationEvents, selectedPublicationIds]
    )

    const openPublication = useCallback(
        (publicationId: string) => {
            void navigate({
                params: { projectId, publicationId },
                search: {
                    date: toDateKey(calendarDate, timeZone),
                    from: 'calendar',
                    view: isPublicationCalendarView(view) ? view : undefined,
                },
                to: '/dashboard/projects/$projectId/publications/$publicationId',
            })
        },
        [calendarDate, navigate, projectId, timeZone, view]
    )
    const openPublicationPreview = useCallback((publicationId: string) => {
        setPreviewPublicationId(publicationId)
    }, [])
    const createOnDate = useCallback(
        (date: Date, scheduledAt?: Date) => {
            void navigate({
                params: { projectId },
                search: {
                    date: toDateKey(date, timeZone),
                    time:
                        scheduledAt === undefined
                            ? undefined
                            : calendarTimeFor(scheduledAt, timeZone),
                },
                to: '/dashboard/projects/$projectId/publications/new',
            })
        },
        [navigate, projectId, timeZone]
    )
    const handleDateChange = useCallback(
        (date: Date) => {
            setExpandedDay(null)
            onSelectedPublicationIdsChange([])
            void navigate({
                params: { projectId },
                replace: true,
                search: previous => ({ ...previous, date: toDateKey(date, timeZone) }),
                to: '/dashboard/projects/$projectId/overview',
            })
        },
        [navigate, onSelectedPublicationIdsChange, projectId, timeZone]
    )
    const handleViewChange = useCallback(
        (nextView: CalendarView) => {
            if (!isPublicationCalendarView(nextView)) return
            void navigate({
                params: { projectId },
                replace: true,
                search: previous => ({
                    ...previous,
                    date: previous.date ?? toDateKey(calendarDate, timeZone),
                    view: nextView,
                }),
                to: '/dashboard/projects/$projectId/overview',
            })
        },
        [calendarDate, navigate, projectId, timeZone]
    )
    const handleSlotClick = useCallback(
        (slot: EventCalendarSlotInfo, event: MouseEvent) => {
            const target = event.currentTarget
            if (!readOnly && (slot.view === 'week' || slot.view === 'day')) {
                createOnDate(slot.date, slot.date)
                return
            }
            if (
                !readOnly &&
                target instanceof HTMLElement &&
                target.dataset.slot === 'event-calendar-day-add'
            ) {
                createOnDate(slot.date)
                return
            }
            setExpandedDay(current =>
                current !== null && toDateKey(current, timeZone) === toDateKey(slot.date, timeZone)
                    ? null
                    : slot.date
            )
        },
        [createOnDate, readOnly, timeZone]
    )
    const togglePublicationSelection = useCallback(
        (publicationId: string) => {
            const next = new Set(selectedPublicationIds)
            if (next.has(publicationId)) next.delete(publicationId)
            else next.add(publicationId)
            onSelectedPublicationIdsChange([...next])
        },
        [onSelectedPublicationIdsChange, selectedPublicationIds]
    )
    const handleEventClick = useCallback(
        (occurrence: EventCalendarOccurrence<PublicationCalendarEventData>, event: MouseEvent) => {
            const publication = occurrence.event.data?.publication
            if (publication === undefined) return
            if (selectionMode) {
                event.preventDefault()
                if (calendarApiRef.current === null) {
                    togglePublicationSelection(publication.id)
                } else {
                    calendarApiRef.current.selectEvent(occurrence.key, { additive: true })
                }
                return
            }
            event.preventDefault()
            openPublicationPreview(publication.id)
        },
        [openPublicationPreview, selectionMode, togglePublicationSelection]
    )
    const handleMoreClick = useCallback((day: Date) => {
        setExpandedDay(day)
        return false
    }, [])
    const renderEvent = useCallback(
        ({ occurrence, view }: EventCalendarRenderEventProps<PublicationCalendarEventData>) => (
            <PublicationEventContent
                occurrence={occurrence}
                locale={locale}
                timeZone={timeZone}
                view={view}
            />
        ),
        [locale, timeZone]
    )

    return (
        <div className="min-w-0" data-calendar="reui" ref={calendarShellRef} tabIndex={-1}>
            <EventCalendar<PublicationCalendarEventData>
                className="rounded-lg bg-surface-inset p-1 shadow-surface"
                date={calendarDate}
                defaultView="month"
                defaultViewSettings={{
                    nowIndicator: false,
                    weekends: true,
                    weekNumbers: false,
                }}
                events={events}
                fixedWeeks
                i18n={i18n}
                interactions={CALENDAR_INTERACTIONS}
                loading={loading}
                locale={dateFnsLocale}
                apiRef={calendarApiRef}
                selection={{ eventKeys: selectedEventKeys, slot: null }}
                onDateChange={handleDateChange}
                onEventClick={handleEventClick}
                onSelectionChange={selection => {
                    const nextIds = selection.eventKeys
                        .map(eventKey => eventIdsByKey.get(eventKey))
                        .filter((id): id is string => id !== undefined)
                    onSelectedPublicationIdsChange([...new Set(nextIds)])
                }}
                onMoreClick={handleMoreClick}
                onSlotClick={handleSlotClick}
                onViewChange={handleViewChange}
                scrollMode={view === 'week' || view === 'day' ? 'contained' : 'page'}
                showDayAddButton={!readOnly}
                showOutsideDays
                slotDuration={60}
                timeZone={timeZone}
                view={view}
                dayClassName={day =>
                    expandedDayKey !== null && toDateKey(day, timeZone) === expandedDayKey
                        ? 'bg-primary/8'
                        : undefined
                }
                views={CALENDAR_VIEWS}
                weekStartsOn={1}
                renderEvent={renderEvent}
                classNames={{
                    dayAddButton: 'rounded-sm shadow-control',
                    event: 'inset-ring-0 !shadow-none !bg-surface-field dark:!bg-surface-field hover:!bg-muted dark:hover:!bg-muted data-selected:!bg-primary/15 dark:data-selected:!bg-primary/20 data-selected:!inset-ring-primary/55 rounded-sm',
                    monthBar: 'px-0.5',
                    monthBarOverlay: 'pt-8',
                    monthBody: 'gap-0.5',
                    monthCell: '!border-0 rounded-sm bg-background shadow-grid-cell',
                    monthCellContent: 'gap-0.5 px-1 pt-1 pb-1',
                    monthCellFooter: 'px-1 pt-1',
                    monthDayHeader: '!border-0 rounded-sm bg-muted/70 px-2 py-1.5',
                    monthDayNumber: '!size-auto !rounded-none px-0.5 font-medium',
                    monthHeader: '!border-0 gap-0.5',
                    monthRow: '!border-0 gap-0.5',
                    monthView: '!border-0',
                    moreIndicator: 'px-1.5 text-foreground',
                }}>
                <EventCalendarToolbar
                    hotkeyTarget={calendarShellRef}
                    onSelectionModeChange={enabled => {
                        setSelectionMode(enabled)
                        if (!enabled) onSelectedPublicationIdsChange([])
                    }}
                    selectionAvailable={!readOnly}
                    selectionMode={selectionMode}
                    selectLabel={m.calendar_select()}
                    doneLabel={m.calendar_done()}
                    shortcutsEnabled={previewPublicationId === null}
                />
                <CalendarBody
                    expandedDay={expandedDay}
                    locale={locale}
                    onEventClick={openPublicationPreview}
                    onToggleSelection={togglePublicationSelection}
                    projectId={projectId}
                    selectedPublicationIds={selectedPublicationIds}
                    selectionMode={selectionMode}
                    timeZone={timeZone}
                />
            </EventCalendar>
            <PublicationCalendarPreviewSheet
                locale={locale}
                onOpenChange={setPreviewPublicationId}
                onOpenPublication={openPublication}
                projectId={projectId}
                publicationId={previewPublicationId}
                publications={publications}
                readOnly={readOnly}
                timeZone={timeZone}
            />
        </div>
    )
}

function EventCalendarToolbar({
    doneLabel,
    hotkeyTarget,
    onSelectionModeChange,
    selectLabel,
    selectionAvailable,
    selectionMode,
    shortcutsEnabled,
}: {
    readonly doneLabel: string
    readonly hotkeyTarget: RefObject<HTMLDivElement | null>
    readonly onSelectionModeChange: (enabled: boolean) => void
    readonly selectLabel: string
    readonly selectionAvailable: boolean
    readonly selectionMode: boolean
    readonly shortcutsEnabled: boolean
}) {
    const { title, prev, next, today, isToday } = useEventCalendarNavigation()
    const { view, availableViews, setView, dayCount } = useEventCalendarView()
    const settings = useEventCalendarSettings()

    useHotkeys(
        [
            {
                callback: () => today(),
                hotkey: 'T',
                options: { meta: { name: settings.i18n.labels.today } },
            },
            {
                callback: prev,
                hotkey: '[',
                options: { meta: { name: settings.i18n.labels.previous } },
            },
            {
                callback: next,
                hotkey: ']',
                options: { meta: { name: settings.i18n.labels.next } },
            },
            ...availableViews.map(availableView => ({
                callback: () => setView(availableView),
                hotkey: CALENDAR_VIEW_SHORTCUTS[availableView],
                options: { meta: { name: viewName(settings, availableView, dayCount) } },
            })),
        ],
        {
            enabled: shortcutsEnabled,
            ignoreInputs: true,
            preventDefault: true,
            requireReset: true,
            stopPropagation: true,
            target: hotkeyTarget,
        }
    )

    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex shrink-0 items-center gap-1.5">
                <Button
                    aria-label={settings.i18n.labels.previous}
                    aria-keyshortcuts="["
                    onClick={prev}
                    size="sm"
                    variant="ghost">
                    <AltArrowLeftIcon aria-hidden="true" />
                </Button>
                <Button
                    aria-keyshortcuts="T"
                    aria-pressed={isToday}
                    onClick={today}
                    size="sm"
                    variant="ghost">
                    {settings.i18n.labels.today}
                </Button>
                <Button
                    aria-label={settings.i18n.labels.next}
                    aria-keyshortcuts="]"
                    onClick={next}
                    size="sm"
                    variant="ghost">
                    <AltArrowRightIcon aria-hidden="true" />
                </Button>
            </div>
            <h2
                className="order-first w-full min-w-0 font-heading text-xl font-[580] leading-tight [overflow-wrap:normal] sm:order-none sm:w-auto sm:min-w-max sm:flex-1 sm:text-2xl"
                id="calendar-title">
                {title}
            </h2>
            <div className="flex max-w-full flex-wrap items-center gap-3 sm:ml-auto">
                {selectionAvailable ? (
                    <Button
                        aria-pressed={selectionMode}
                        onClick={() => onSelectionModeChange(!selectionMode)}
                        size="sm"
                        variant={selectionMode ? 'secondary' : 'ghost'}>
                        <CheckIcon aria-hidden="true" />
                        {selectionMode ? doneLabel : selectLabel}
                    </Button>
                ) : null}
                <div
                    aria-label={settings.i18n.labels.selectView}
                    className="flex items-center rounded-md bg-muted p-0.5"
                    role="group">
                    {availableViews.map(availableView => (
                        <Button
                            aria-pressed={availableView === view}
                            aria-keyshortcuts={CALENDAR_VIEW_SHORTCUTS[availableView]}
                            className={
                                availableView === view
                                    ? 'bg-surface-raised font-[700] text-foreground shadow-none hover:bg-surface-raised'
                                    : 'text-muted-foreground'
                            }
                            key={availableView}
                            onClick={() => setView(availableView)}
                            size="sm"
                            variant="ghost">
                            {viewName(settings, availableView, dayCount)}
                            <Kbd aria-hidden="true">{CALENDAR_VIEW_SHORTCUTS[availableView]}</Kbd>
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    )
}

function CalendarBody({
    expandedDay,
    locale,
    onEventClick,
    onToggleSelection,
    projectId,
    selectedPublicationIds,
    selectionMode,
    timeZone,
}: {
    readonly expandedDay: Date | null
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly onToggleSelection: (publicationId: string) => void
    readonly projectId: string
    readonly selectedPublicationIds: ReadonlySet<string>
    readonly selectionMode: boolean
    readonly timeZone: string
}) {
    const { view } = useEventCalendarView()

    if (view === 'agenda') {
        return (
            <div data-calendar-view="agenda">
                <PublicationCalendarAgenda
                    locale={locale}
                    onEventClick={onEventClick}
                    onToggleSelection={onToggleSelection}
                    selectedPublicationIds={selectedPublicationIds}
                    selectionMode={selectionMode}
                    timeZone={timeZone}
                />
            </div>
        )
    }

    if (view === 'week' || view === 'day') {
        return (
            <div data-calendar-view={view}>
                <EventCalendarTimeGrid storageKey={projectId} />
            </div>
        )
    }

    const month = <EventCalendarMonthView expandedDay={expandedDay} maxEventsPerCell={5} />
    return (
        <div className="overflow-x-auto pb-1" data-calendar-view="month">
            <div className="min-w-[60rem]">{month}</div>
        </div>
    )
}

function useMediaQuery(query: string) {
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            if (typeof window === 'undefined') return () => undefined
            const mediaQuery = window.matchMedia(query)
            mediaQuery.addEventListener('change', onStoreChange)
            return () => mediaQuery.removeEventListener('change', onStoreChange)
        },
        [query]
    )
    const getSnapshot = useCallback(
        () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
        [query]
    )
    const getServerSnapshot = useCallback(() => false, [])

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function PublicationCalendarAgenda({
    locale,
    onEventClick,
    onToggleSelection,
    selectedPublicationIds,
    selectionMode,
    timeZone,
}: {
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly onToggleSelection: (publicationId: string) => void
    readonly selectedPublicationIds: ReadonlySet<string>
    readonly selectionMode: boolean
    readonly timeZone: string
}) {
    const occurrences = useEventCalendarOccurrences<PublicationCalendarEventData>()
    const settings = useEventCalendarSettings<PublicationCalendarEventData>()
    const groups = useMemo(() => {
        const byDate = new Map<
            string,
            {
                readonly date: Date
                readonly occurrences: EventCalendarOccurrence<PublicationCalendarEventData>[]
            }
        >()

        for (const occurrence of occurrences) {
            const key = toDateKey(occurrence.start, timeZone)
            const current = byDate.get(key)
            if (current === undefined) {
                byDate.set(key, { date: occurrence.start, occurrences: [occurrence] })
            } else {
                current.occurrences.push(occurrence)
            }
        }

        return [...byDate.values()]
    }, [occurrences, timeZone])

    if (groups.length === 0) {
        return (
            <div className="flex min-h-44 items-center justify-center rounded-md bg-surface-inset px-4 py-12 text-sm text-muted-foreground shadow-surface">
                <span className="flex items-center gap-2">
                    <CalendarMinimalisticIcon aria-hidden="true" className="size-4" />
                    {settings.i18n.labels.noEvents}
                </span>
            </div>
        )
    }

    const dateFormatter = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone,
        weekday: 'long',
    })

    return (
        <div className="overflow-hidden rounded-lg bg-surface-inset p-1 shadow-surface">
            {groups.map(group => (
                <section
                    className="rounded-md bg-background p-3 shadow-field"
                    key={toDateKey(group.date, timeZone)}>
                    <h3 className="px-1 pb-2 font-heading text-sm font-medium capitalize">
                        {dateFormatter.format(group.date)}
                    </h3>
                    <div className="grid gap-1">
                        {group.occurrences.map(occurrence => {
                            const publication = occurrence.event.data?.publication
                            if (publication === undefined) {
                                const taken = occurrence.event.data?.occupancy
                                if (taken === undefined) return null
                                return (
                                    <div
                                        className="flex min-w-0 items-center gap-3 rounded-md bg-surface-inset px-3 py-2.5 text-muted-foreground italic"
                                        data-occupancy="true"
                                        key={occurrence.key}>
                                        <span
                                            aria-hidden="true"
                                            className="h-5 w-px shrink-0 bg-current"
                                        />
                                        <span className="min-w-0 truncate text-sm">
                                            {occurrence.event.title}
                                        </span>
                                        <span className="ml-auto shrink-0 text-xs">
                                            {formatTime(taken.at, timeZone, locale)}
                                        </span>
                                    </div>
                                )
                            }
                            const time = formatTime(
                                publication.scheduledAt as number,
                                timeZone,
                                locale
                            )
                            const selected = selectedPublicationIds.has(publication.id)
                            return (
                                <button
                                    aria-label={`${occurrence.event.title} — ${publication.channelName} — ${time}`}
                                    aria-pressed={selectionMode ? selected : undefined}
                                    className={cn(
                                        'group flex min-w-0 items-center gap-3 rounded-md bg-surface-field px-3 py-2.5 text-left shadow-field transition-[background-color,box-shadow,transform] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                                        selected &&
                                            'bg-primary/15 shadow-control hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/25'
                                    )}
                                    data-selected={selected || undefined}
                                    key={occurrence.key}
                                    onClick={() =>
                                        selectionMode
                                            ? onToggleSelection(publication.id)
                                            : onEventClick(publication.id)
                                    }
                                    type="button">
                                    <span
                                        aria-hidden="true"
                                        className="h-5 w-px shrink-0 bg-(--publication-color)"
                                        style={
                                            {
                                                '--publication-color': occurrence.event.color,
                                            } as CSSProperties
                                        }
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {occurrence.event.title}
                                    </span>
                                    <span
                                        className="min-w-0 max-w-[35%] truncate text-xs text-muted-foreground"
                                        title={publication.channelName}>
                                        {publication.channelName}
                                    </span>
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {time}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </section>
            ))}
        </div>
    )
}

function PublicationEventContent({
    occurrence,
    locale,
    timeZone,
    view,
}: {
    readonly occurrence: EventCalendarOccurrence<PublicationCalendarEventData>
    readonly locale: string
    readonly timeZone: string
    readonly view?: CalendarView
}) {
    const publication = occurrence.event.data?.publication
    if (publication === undefined) {
        if (occurrence.event.data?.occupancy === undefined) return null
        // Time taken by another project: muted, never interactive, only what the caller may know.
        return (
            <span
                className="flex min-w-0 items-center gap-1.5 text-muted-foreground italic"
                data-occupancy="true">
                <span aria-hidden="true" className="h-3 w-px shrink-0 self-center bg-current" />
                <span className="min-w-0 truncate">{occurrence.event.title}</span>
                <span className="hidden shrink-0 @[12rem]:inline">
                    {formatTime(occurrence.event.data.occupancy.at, timeZone, locale)}
                </span>
            </span>
        )
    }
    const time = formatTime(publication.scheduledAt as number, timeZone, locale)
    const statusMarker = (
        <span
            aria-hidden="true"
            className="h-3 w-px shrink-0 self-center bg-(--publication-color)"
            style={
                {
                    '--publication-color': occurrence.event.color ?? 'var(--color-primary)',
                } as CSSProperties
            }
        />
    )

    if (view === 'week' || view === 'day') {
        return (
            <span className="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
                <span className="flex min-w-0 max-w-full items-start gap-1.5">
                    {statusMarker}
                    <span className="min-w-0 break-words whitespace-normal text-[0.6875rem] font-medium">
                        {occurrence.event.title}
                    </span>
                </span>
                <span className="min-w-0 max-w-full break-words whitespace-normal ps-2 text-[0.625rem] text-muted-foreground">
                    {time} · {publication.channelName}
                </span>
            </span>
        )
    }

    return (
        <>
            {statusMarker}
            <span className="min-w-0 truncate font-medium">{occurrence.event.title}</span>
            <span className="hidden shrink-0 text-muted-foreground @[12rem]:inline">{time}</span>
            <span className="hidden min-w-0 truncate text-muted-foreground @[16rem]:inline">
                {publication.channelName}
            </span>
        </>
    )
}

function calendarTimeFor(date: Date, timeZone: string) {
    const parts = getZonedDateTimeParts(date.getTime(), timeZone)
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function calendarEventKey(event: { readonly id: string; readonly start: Date }) {
    return `${event.id}::${event.start.toISOString()}`
}

function viewName(
    settings: ReturnType<typeof useEventCalendarSettings>,
    view: CalendarView,
    dayCount: number
) {
    if (view === 'days') return settings.i18n.viewNames.days(dayCount)
    return settings.i18n.viewNames[view]
}

function createCalendarI18n(locale: string, timeZone: string) {
    const messageLocale = locale === 'fr' ? 'fr' : 'en'
    const messageOptions = { locale: messageLocale } as const
    return {
        labels: {
            addEvent: m.calendar_add_event({}, messageOptions),
            allDay: m.calendar_all_day({}, messageOptions),
            continues: m.calendar_continues({}, messageOptions),
            dropNotAllowed: m.calendar_drop_not_allowed({}, messageOptions),
            event: m.calendar_event({}, messageOptions),
            eventDetails: (title: string) => title,
            events: (count: number) => m.calendar_events({ count }, messageOptions),
            goToDate: m.calendar_go_to_date({}, messageOptions),
            loading: m.calendar_loading({}, messageOptions),
            more: (count: number) => m.calendar_more({ count }, messageOptions),
            moreCompact: (count: number) => `+${count}`,
            next: m.calendar_next({}, messageOptions),
            noEvents: m.calendar_no_events({}, messageOptions),
            previous: m.calendar_previous({}, messageOptions),
            resizeColumn: (day: string) => m.calendar_resize_column({ day }, messageOptions),
            resources: m.calendar_resources({}, messageOptions),
            selectView: m.calendar_select_view({}, messageOptions),
            timeFrom: (time: string) => m.calendar_time_from({ time }, messageOptions),
            timeRange: (from: string, to: string) => `${from} - ${to}`,
            timeUntil: (time: string) => m.calendar_time_until({ time }, messageOptions),
            today: m.calendar_today({}, messageOptions),
            toggleDayEvents: (count: number) => `${count}`,
            viewShortcuts: {
                ...CALENDAR_VIEW_SHORTCUTS,
            },
            week: (weekNumber: number) => m.calendar_week_short({ weekNumber }, messageOptions),
        },
        viewNames: {
            agenda: m.calendar_view_agenda({}, messageOptions),
            day: m.calendar_view_day({}, messageOptions),
            days: (count: number) => m.calendar_view_days({ count }, messageOptions),
            month: m.calendar_view_month({}, messageOptions),
            resource: m.calendar_view_resource({}, messageOptions),
            week: m.calendar_view_week({}, messageOptions),
        },
        formats:
            messageLocale === 'fr'
                ? {
                      dayTitle: 'EEEE d MMMM yyyy',
                      agendaDayHeader: 'EEEE d MMMM',
                      moreDayHeader: 'EEEE d MMMM',
                      eventTime: 'HH:mm',
                      timeGutter: 'HH:mm',
                      timeGutterMinute: 'HH:mm',
                  }
                : undefined,
        functions: {
            formatTitle: (
                view: string,
                { date, activeRange }: { date: Date; activeRange: { start: Date; end: Date } }
            ) => formatCalendarTitle(view, date, activeRange, locale, timeZone),
            formatDayRange: (range: { start: Date; end: Date }) =>
                formatCalendarTitle('week', range.start, range, locale, timeZone),
            formatEventTime: (start: Date) => formatTime(start.getTime(), timeZone, locale),
        },
    }
}
