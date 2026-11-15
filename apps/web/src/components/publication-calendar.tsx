import { Button } from '@postdot/ui/components/button'
import { Kbd } from '@postdot/ui/components/kbd'
import { cn } from '@postdot/ui/lib/utils'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { CheckIcon } from '@solar-icons/react/linear/check'
import type { RegisterableHotkey } from '@tanstack/hotkeys'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { de, enUS, es, fr } from 'date-fns/locale'
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

import { EmptyState } from '@/components/empty-state'
import { ChannelAvatar } from '@/components/identity-visuals'
import { PublicationCalendarPreview } from '@/components/publication-calendar-preview'
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
import type { Channel, ChannelOccupancy, PublicationSummary } from '@/lib/api'
import { getZonedDateTimeParts } from '@/lib/date-time'
import { formatTime } from '@/lib/format'
import { formatCalendarTitle } from '@/lib/publication-calendar'
import { toDateKey } from '@/lib/publication-calendar'
import {
    groupPublicationCalendarEvents,
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

type ChannelIdentity = Pick<Channel, 'id' | 'name' | 'profileId'>

export function PublicationCalendar({
    filterControl,
    filterSummary,
    channels = [],
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
    readonly filterControl?: React.ReactNode
    /** Conditions in force, shown on their own line under the toolbar. */
    readonly filterSummary?: React.ReactNode
    /** This project's channels, to show each publication's channel mark and name. */
    readonly channels?: readonly ChannelIdentity[]
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
    const channelsById = useMemo(
        () => new Map(channels.map(channel => [channel.id, channel])),
        [channels]
    )
    const publicationEvents = useMemo(
        () =>
            groupPublicationCalendarEvents(
                toPublicationCalendarEvents(publications, duePublicationIds)
            ),
        [duePublicationIds, publications]
    )
    const occupancyEvents = useMemo(
        () =>
            toOccupancyCalendarEvents(occupancy, item => {
                const channel = channelsById.get(item.channelId)?.name ?? ''
                return item.project === null
                    ? m.calendar_occupied({ channel })
                    : `${item.project.title ?? m.calendar_occupied({ channel })} · ${item.project.name}`
            }),
        [channelsById, occupancy]
    )
    const events = useMemo<CalendarEvent<PublicationCalendarEventData>[]>(
        () => [...publicationEvents, ...occupancyEvents],
        [occupancyEvents, publicationEvents]
    )
    const dateFnsLocale = dateFnsLocales[calendarLocale(locale)]
    const i18n = useMemo(() => createCalendarI18n(locale, timeZone), [locale, timeZone])
    const isNarrow = useMediaQuery(MOBILE_CALENDAR_QUERY)
    const [previewPublicationId, setPreviewPublicationId] = useState<string | null>(null)
    const [selectionMode, setSelectionMode] = useState(false)
    const calendarShellRef = useRef<HTMLDivElement>(null)
    const calendarApiRef = useRef<EventCalendarApi<PublicationCalendarEventData> | null>(null)
    const todayKey = toDateKey(new Date(), timeZone)
    const viewPreference = initialView ?? 'auto'
    const view = viewPreference === 'auto' ? (isNarrow ? 'agenda' : 'month') : viewPreference
    const eventIdsByKey = useMemo(
        () =>
            new Map(
                publicationEvents.map(event => [
                    calendarEventKey(event),
                    (event.data?.publications ?? []).map(publication => publication.id),
                ])
            ),
        [publicationEvents]
    )
    const selectedEventKeys = useMemo(
        () =>
            publicationEvents
                .filter(event =>
                    (event.data?.publications ?? []).some(publication =>
                        selectedPublicationIds.has(publication.id)
                    )
                )
                .map(calendarEventKey),
        [publicationEvents, selectedPublicationIds]
    )

    const previewGroup = useMemo(() => {
        if (previewPublicationId === null) return []
        const entry = publicationEvents.find(event =>
            (event.data?.publications ?? []).some(item => item.id === previewPublicationId)
        )
        return (
            entry?.data?.publications ??
            publications.filter(publication => publication.id === previewPublicationId)
        )
    }, [previewPublicationId, publicationEvents, publications])
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
                    // A day without a slot gets a sensible future time, never one already past.
                    time: calendarTimeFor(scheduledAt ?? defaultTimeOn(date, timeZone), timeZone),
                },
                to: '/dashboard/projects/$projectId/publications/new',
            })
        },
        [navigate, projectId, timeZone]
    )
    const handleDateChange = useCallback(
        (date: Date) => {
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
            }
        },
        [createOnDate, readOnly]
    )
    const togglePublicationSelection = useCallback(
        (publicationIds: readonly string[]) => {
            const next = new Set(selectedPublicationIds)
            const allSelected = publicationIds.every(id => next.has(id))
            for (const id of publicationIds) {
                if (allSelected) next.delete(id)
                else next.add(id)
            }
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
                    togglePublicationSelection(
                        (occurrence.event.data?.publications ?? [publication]).map(item => item.id)
                    )
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
    const renderEvent = useCallback(
        ({ occurrence, view }: EventCalendarRenderEventProps<PublicationCalendarEventData>) => (
            <PublicationEventContent
                channelsById={channelsById}
                occurrence={occurrence}
                locale={locale}
                timeZone={timeZone}
                view={view}
            />
        ),
        [channelsById, locale, timeZone]
    )

    return (
        <div className="min-w-0" data-calendar="reui" ref={calendarShellRef} tabIndex={-1}>
            <EventCalendar<PublicationCalendarEventData>
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
                    const nextIds = selection.eventKeys.flatMap(
                        eventKey => eventIdsByKey.get(eventKey) ?? []
                    )
                    onSelectedPublicationIdsChange([...new Set(nextIds)])
                }}
                onSlotClick={handleSlotClick}
                onViewChange={handleViewChange}
                scrollMode={view === 'week' || view === 'day' ? 'contained' : 'page'}
                showDayAddButton={!readOnly}
                showOutsideDays
                slotDuration={60}
                timeZone={timeZone}
                view={view}
                // C6: the past recedes; today and the future carry the weight.
                dayClassName={day =>
                    toDateKey(day, timeZone) < todayKey
                        ? '!bg-background text-muted-foreground'
                        : undefined
                }
                views={CALENDAR_VIEWS}
                weekStartsOn={1}
                renderEvent={renderEvent}
                classNames={{
                    dayAddButton: 'rounded-sm shadow-control',
                    event: 'inset-ring-0 !shadow-none !bg-transparent dark:!bg-transparent hover:!bg-surface-hover dark:hover:!bg-surface-hover data-selected:!bg-primary/15 dark:data-selected:!bg-primary/20 data-selected:!inset-ring-primary/55 rounded-sm',
                    monthBar: 'px-0.5',
                    monthBarOverlay: 'pt-8',
                    // C3/C5: one hairline grid with equal rows instead of 35 separate tiles.
                    monthBody: 'gap-px',
                    monthCell: '!border-0 rounded-none bg-surface-raised min-h-[7.25rem]',
                    monthCellContent: 'gap-0.5 px-1 pt-1 pb-1',
                    monthCellFooter: 'px-1 pt-0.5',
                    monthDayHeader:
                        '!border-0 rounded-none bg-surface-raised px-2 py-1.5 text-muted-foreground',
                    monthDayNumber: '!size-auto !rounded-none px-0.5 font-medium',
                    monthHeader: '!border-0 gap-px',
                    monthRow: '!border-0 gap-px',
                    timeGrid: 'overflow-hidden rounded-lg border border-border bg-surface-raised',
                    monthView: '!border !border-border overflow-hidden rounded-lg bg-border',
                    moreIndicator: 'px-1.5 text-foreground',
                }}>
                <EventCalendarToolbar
                    hotkeyTarget={calendarShellRef}
                    onSelectionModeChange={enabled => {
                        setSelectionMode(enabled)
                        if (!enabled) onSelectedPublicationIdsChange([])
                    }}
                    filterControl={filterControl}
                    selectionAvailable={!readOnly}
                    selectionMode={selectionMode}
                    selectLabel={m.calendar_select()}
                    shortcutsEnabled={previewPublicationId === null}
                />
                <div className="mb-3 empty:hidden">{filterSummary}</div>
                <CalendarBody
                    channelsById={channelsById}
                    locale={locale}
                    onEventClick={openPublicationPreview}
                    onToggleSelection={togglePublicationSelection}
                    projectId={projectId}
                    selectedPublicationIds={selectedPublicationIds}
                    selectionMode={selectionMode}
                    timeZone={timeZone}
                />
            </EventCalendar>
            <PublicationCalendarPreview
                channelsById={channelsById}
                duePublicationIds={duePublicationIds}
                group={previewGroup}
                locale={locale}
                onOpenChange={setPreviewPublicationId}
                onOpenPublication={openPublication}
                projectId={projectId}
                readOnly={readOnly}
                timeZone={timeZone}
            />
        </div>
    )
}

function EventCalendarToolbar({
    filterControl,
    hotkeyTarget,
    onSelectionModeChange,
    selectLabel,
    selectionAvailable,
    selectionMode,
    shortcutsEnabled,
}: {
    readonly filterControl?: React.ReactNode
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
            {/* One date control: the arrows belong to Today, not beside it (pattern 8). */}
            <div
                className="flex shrink-0 items-center divide-x divide-border overflow-hidden rounded-md border border-border bg-surface-raised [&>button]:rounded-none"
                role="group">
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
            <div className="flex w-full max-w-full flex-wrap items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end sm:gap-3">
                {filterControl}
                {selectionAvailable ? (
                    <Button
                        aria-pressed={selectionMode}
                        onClick={() => onSelectionModeChange(!selectionMode)}
                        className="aria-pressed:bg-surface-hover aria-pressed:text-foreground"
                        size="sm"
                        variant="ghost">
                        <CheckIcon aria-hidden="true" />
                        {selectLabel}
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
                            <Kbd aria-hidden="true" className="hidden sm:inline-flex">
                                {CALENDAR_VIEW_SHORTCUTS[availableView]}
                            </Kbd>
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    )
}

function CalendarBody({
    channelsById,
    locale,
    onEventClick,
    onToggleSelection,
    projectId,
    selectedPublicationIds,
    selectionMode,
    timeZone,
}: {
    readonly channelsById: ReadonlyMap<string, ChannelIdentity>
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly onToggleSelection: (publicationIds: readonly string[]) => void
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
                    channelsById={channelsById}
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

    const month = <EventCalendarMonthView maxEventsPerCell={3} />
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
    channelsById,
    locale,
    onEventClick,
    onToggleSelection,
    selectedPublicationIds,
    selectionMode,
    timeZone,
}: {
    readonly channelsById: ReadonlyMap<string, ChannelIdentity>
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly onToggleSelection: (publicationIds: readonly string[]) => void
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
            <EmptyState
                className="py-16"
                data-calendar-agenda-empty="true"
                illustration="event"
                title={settings.i18n.labels.noEvents}
            />
        )
    }

    const dateFormatter = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone,
        weekday: 'long',
    })

    return (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-raised">
            {groups.map(group => (
                <section className="p-2" key={toDateKey(group.date, timeZone)}>
                    <h3 className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground capitalize">
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
                                        className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-muted-foreground italic"
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
                            const members = occurrence.event.data?.publications ?? [publication]
                            const memberIds = members.map(item => item.id)
                            const channelLabel = members.map(item => item.channelName).join(', ')
                            const selected = memberIds.every(id => selectedPublicationIds.has(id))
                            return (
                                <button
                                    aria-label={`${occurrence.event.title} — ${channelLabel} — ${time}`}
                                    aria-pressed={selectionMode ? selected : undefined}
                                    className={cn(
                                        'group flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                                        selected &&
                                            'bg-primary/15 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/25'
                                    )}
                                    data-selected={selected || undefined}
                                    key={occurrence.key}
                                    onClick={() =>
                                        selectionMode
                                            ? onToggleSelection(memberIds)
                                            : onEventClick(publication.id)
                                    }
                                    type="button">
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'h-5 w-0.5 shrink-0 rounded-full bg-(--publication-color)',
                                            occurrence.event.color === 'var(--color-primary)' &&
                                                'invisible'
                                        )}
                                        style={
                                            {
                                                '--publication-color': occurrence.event.color,
                                            } as CSSProperties
                                        }
                                    />
                                    <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {time}
                                    </span>
                                    <ChannelMarks
                                        channelsById={channelsById}
                                        publications={members}
                                        size="sm"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {occurrence.event.title}
                                    </span>
                                    <span
                                        className="hidden min-w-0 max-w-[35%] truncate text-xs text-muted-foreground sm:inline"
                                        data-agenda-channel="true"
                                        title={channelLabel}>
                                        {channelLabel}
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
    channelsById,
    occurrence,
    locale,
    timeZone,
    view,
}: {
    readonly channelsById: ReadonlyMap<string, ChannelIdentity>
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
    const members = occurrence.event.data?.publications ?? [publication]
    // Only a state that asks for attention, failed or done earns a mark; scheduled is the norm.
    const statusMarker =
        occurrence.event.color === 'var(--color-primary)' ? null : (
            <span
                aria-hidden="true"
                className="h-3 w-0.5 shrink-0 self-center rounded-full bg-(--publication-color)"
                style={
                    {
                        '--publication-color': occurrence.event.color ?? 'var(--color-primary)',
                    } as CSSProperties
                }
            />
        )

    // C1/C7: every entry carries its state, its channels and its time on one line.
    return (
        <span
            className="flex min-w-0 flex-1 items-center gap-1.5"
            data-calendar-entry-channels={members.length}
            title={`${time} · ${occurrence.event.title} · ${members.map(item => item.channelName).join(', ')}`}>
            {statusMarker}
            <ChannelMarks channelsById={channelsById} publications={members} size="xs" />
            {/* In the week grid the position already says the time; the title gets the room. */}
            {view === 'week' ? null : (
                <span className="shrink-0 tabular-nums text-muted-foreground">{time}</span>
            )}
            <span className="min-w-0 truncate font-medium">{occurrence.event.title}</span>
            <span className="sr-only">{members.map(item => item.channelName).join(', ')}</span>
            {view === 'day' ? (
                <span className="hidden min-w-0 truncate text-muted-foreground @[24rem]:inline">
                    {members.map(item => item.channelName).join(', ')}
                </span>
            ) : null}
        </span>
    )
}

const MAX_CHANNEL_MARKS = 3

/** The channels of one calendar entry: brand marks overlapping, then a count. */
function ChannelMarks({
    channelsById,
    publications,
    size,
}: {
    readonly channelsById: ReadonlyMap<string, ChannelIdentity>
    readonly publications: readonly PublicationSummary[]
    readonly size: 'xs' | 'sm'
}) {
    const shown = publications.slice(0, MAX_CHANNEL_MARKS)
    const hidden = publications.length - shown.length
    return (
        <span className="flex shrink-0 items-center" data-channel-marks="true">
            {shown.map((publication, index) => (
                <ChannelAvatar
                    channel={
                        channelsById.get(publication.channelId) ?? {
                            id: publication.channelId,
                            name: publication.channelName,
                            profileId: '',
                        }
                    }
                    className={cn('ring-1 ring-background', index > 0 && '-ms-1')}
                    key={publication.id}
                    size={size}
                />
            ))}
            {hidden > 0 ? (
                <span className="ms-0.5 text-[0.625rem] tabular-nums text-muted-foreground">
                    +{hidden}
                </span>
            ) : null}
        </span>
    )
}

function defaultTimeOn(day: Date, timeZone: string) {
    const now = Date.now()
    const parts = getZonedDateTimeParts(day.getTime(), timeZone)
    const morning = new Date(day.getTime() + (9 - parts.hour) * 3_600_000 - parts.minute * 60_000)
    // Today after nine: the next full hour. Any other day: nine in the morning.
    if (toDateKey(day, timeZone) !== toDateKey(new Date(now), timeZone) || morning.getTime() > now)
        return morning
    const next = new Date(now + 3_600_000)
    next.setUTCMinutes(0, 0, 0)
    return next
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

const dateFnsLocales = { de, en: enUS, es, fr } as const

function calendarLocale(locale: string): keyof typeof dateFnsLocales {
    return locale === 'fr' || locale === 'es' || locale === 'de' ? locale : 'en'
}

function createCalendarI18n(locale: string, timeZone: string) {
    const messageLocale = calendarLocale(locale)
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
            messageLocale !== 'en'
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
