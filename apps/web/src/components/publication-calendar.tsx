import { Button } from '@herald/ui/components/button'
import { Kbd } from '@herald/ui/components/kbd'
import { AltArrowLeftIcon } from '@solar-icons/react/bold/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
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
    useEventCalendarNavigation,
    useEventCalendarOccurrences,
    useEventCalendarSettings,
    useEventCalendarView,
    type EventCalendarRenderEventProps,
} from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarMonthView } from '@/components/reui/event-calendar/event-calendar-month-view'
import { EventCalendarTimeGrid } from '@/components/reui/event-calendar/event-calendar-time-grid'
import type {
    CalendarView,
    EventCalendarOccurrence,
    EventCalendarSlotInfo,
} from '@/components/reui/event-calendar/event-calendar-types'
import type { PublicationSummary } from '@/lib/api'
import { getZonedDateTimeParts } from '@/lib/date-time'
import { formatTime } from '@/lib/format'
import { toDateKey } from '@/lib/publication-calendar'
import {
    type PublicationCalendarEventData,
    isPublicationCalendarView,
    type PublicationCalendarView,
    toPublicationCalendarEvents,
} from '@/lib/publication-calendar-events'

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
    duePublicationIds,
    loading,
    locale,
    calendarDate,
    initialView,
    projectId,
    publications,
    timeZone,
}: {
    readonly duePublicationIds: ReadonlySet<string>
    readonly loading: boolean
    readonly locale: string
    readonly calendarDate: Date
    readonly initialView?: PublicationCalendarView
    readonly projectId: string
    readonly publications: readonly PublicationSummary[]
    readonly timeZone: string
}) {
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/overview' })
    const events = useMemo(
        () => toPublicationCalendarEvents(publications, duePublicationIds),
        [duePublicationIds, publications]
    )
    const dateFnsLocale = locale === 'fr' ? fr : enUS
    const i18n = useMemo(() => createCalendarI18n(locale, timeZone), [locale, timeZone])
    const isNarrow = useMediaQuery(MOBILE_CALENDAR_QUERY)
    const [expandedDay, setExpandedDay] = useState<Date | null>(null)
    const [previewPublicationId, setPreviewPublicationId] = useState<string | null>(null)
    const calendarShellRef = useRef<HTMLDivElement>(null)
    const expandedDayKey = expandedDay === null ? null : toDateKey(expandedDay, timeZone)
    const viewPreference = initialView ?? 'auto'
    const view = viewPreference === 'auto' ? (isNarrow ? 'agenda' : 'month') : viewPreference

    const openPublication = useCallback(
        (publicationId: string) => {
            void navigate({
                params: { projectId, publicationId },
                to: '/dashboard/projects/$projectId/publications/$publicationId',
            })
        },
        [navigate, projectId]
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
            void navigate({
                params: { projectId },
                replace: true,
                search: previous => ({ ...previous, date: toDateKey(date, timeZone) }),
                to: '/dashboard/projects/$projectId/overview',
            })
        },
        [navigate, projectId, timeZone]
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
            if (slot.view === 'week' || slot.view === 'day') {
                createOnDate(slot.date, slot.date)
                return
            }
            if (target instanceof HTMLElement && target.dataset.slot === 'event-calendar-day-add') {
                createOnDate(slot.date)
                return
            }
            setExpandedDay(current =>
                current !== null && toDateKey(current, timeZone) === toDateKey(slot.date, timeZone)
                    ? null
                    : slot.date
            )
        },
        [createOnDate, timeZone]
    )
    const handleEventClick = useCallback(
        (occurrence: EventCalendarOccurrence<PublicationCalendarEventData>) => {
            const publication = occurrence.event.data?.publication
            if (publication !== undefined) openPublicationPreview(publication.id)
        },
        [openPublicationPreview]
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
                onDateChange={handleDateChange}
                onEventClick={handleEventClick}
                onMoreClick={handleMoreClick}
                onSlotClick={handleSlotClick}
                onViewChange={handleViewChange}
                scrollMode={view === 'week' || view === 'day' ? 'contained' : 'page'}
                showDayAddButton
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
                    event: '!inset-ring-0 !shadow-none !bg-surface-field dark:!bg-surface-field hover:!bg-muted dark:hover:!bg-muted rounded-sm',
                    monthBar: 'px-0.5',
                    monthBarOverlay: 'pt-8',
                    monthBody: 'gap-0.5',
                    monthCell: '!border-0 rounded-sm bg-background shadow-field',
                    monthCellContent: 'gap-0.5 px-1 pt-1 pb-1',
                    monthCellFooter: 'px-1 pt-1',
                    monthDayHeader: '!border-0 rounded-sm bg-muted/70 px-2 py-1.5',
                    monthDayNumber: '!size-auto !rounded-none px-0.5 font-medium',
                    monthHeader: '!border-0 gap-0.5',
                    monthRow: '!border-0 gap-0.5',
                    monthView: '!border-0',
                    moreIndicator: 'px-1.5 text-primary',
                }}>
                <EventCalendarToolbar
                    hotkeyTarget={calendarShellRef}
                    shortcutsEnabled={previewPublicationId === null}
                />
                <CalendarBody
                    expandedDay={expandedDay}
                    locale={locale}
                    onEventClick={openPublicationPreview}
                    projectId={projectId}
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
                timeZone={timeZone}
            />
        </div>
    )
}

function EventCalendarToolbar({
    hotkeyTarget,
    shortcutsEnabled,
}: {
    readonly hotkeyTarget: RefObject<HTMLDivElement | null>
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
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5">
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
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:justify-end">
                <h2
                    className="min-w-0 flex-1 truncate font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em] sm:text-2xl"
                    id="calendar-title">
                    {title}
                </h2>
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
    projectId,
    timeZone,
}: {
    readonly expandedDay: Date | null
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly projectId: string
    readonly timeZone: string
}) {
    const { view } = useEventCalendarView()

    if (view === 'agenda') {
        return (
            <div data-calendar-view="agenda">
                <PublicationCalendarAgenda
                    locale={locale}
                    onEventClick={onEventClick}
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
    timeZone,
}: {
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
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
                            if (publication === undefined) return null
                            const time = formatTime(
                                publication.scheduledAt as number,
                                timeZone,
                                locale
                            )
                            return (
                                <button
                                    aria-label={`${occurrence.event.title} — ${publication.channelName} — ${time}`}
                                    className="group flex min-w-0 items-center gap-3 rounded-md bg-surface-field px-3 py-2.5 text-left shadow-field transition-[background-color,transform] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                                    key={occurrence.key}
                                    onClick={() => onEventClick(publication.id)}
                                    type="button">
                                    <span
                                        aria-hidden="true"
                                        className="size-2 shrink-0 rounded-full bg-(--publication-color)"
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
    if (publication === undefined) return null
    const time = formatTime(publication.scheduledAt as number, timeZone, locale)
    const statusMarker = (
        <span
            aria-hidden="true"
            className="mt-1 size-1.5 shrink-0 rounded-full bg-(--publication-color)"
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
                <span className="min-w-0 max-w-full break-words whitespace-normal ps-3 text-[0.625rem] text-muted-foreground">
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

function viewName(
    settings: ReturnType<typeof useEventCalendarSettings>,
    view: CalendarView,
    dayCount: number
) {
    if (view === 'days') return settings.i18n.viewNames.days(dayCount)
    return settings.i18n.viewNames[view]
}

function createCalendarI18n(locale: string, timeZone: string) {
    const french = locale === 'fr'
    return {
        labels: {
            addEvent: french ? 'Créer une publication' : 'Create publication',
            allDay: french ? 'Toute la journée' : 'All day',
            continues: french ? 'continue' : 'continues',
            dropNotAllowed: french ? 'Publication impossible ici' : "Can't place here",
            event: french ? 'publication' : 'publication',
            eventDetails: (title: string) => title,
            events: (count: number) =>
                french
                    ? `${count} publication${count === 1 ? '' : 's'}`
                    : `${count} publication${count === 1 ? '' : 's'}`,
            goToDate: french ? 'Aller à la date' : 'Go to date',
            loading: french ? 'Chargement' : 'Loading',
            more: (count: number) => (french ? `+${count} autres` : `+${count} more`),
            moreCompact: (count: number) => `+${count}`,
            next: french ? 'Période suivante' : 'Next period',
            noEvents: french ? 'Aucune publication' : 'No publications',
            previous: french ? 'Période précédente' : 'Previous period',
            resizeColumn: (day: string) =>
                french ? `Redimensionner la colonne ${day}` : `Resize ${day} column`,
            resources: french ? 'Ressources' : 'Resources',
            selectView: french ? 'Choisir la vue' : 'Select view',
            timeFrom: (time: string) => (french ? `À partir de ${time}` : `From ${time}`),
            timeRange: (from: string, to: string) => `${from} - ${to}`,
            timeUntil: (time: string) => (french ? `Jusqu'à ${time}` : `Until ${time}`),
            today: french ? 'Aujourd’hui' : 'Today',
            toggleDayEvents: (count: number) => `${count}`,
            viewShortcuts: {
                ...CALENDAR_VIEW_SHORTCUTS,
            },
            week: (weekNumber: number) => `S${weekNumber}`,
        },
        viewNames: {
            agenda: french ? 'Agenda' : 'Agenda',
            day: french ? 'Jour' : 'Day',
            days: (count: number) => (french ? `${count} jours` : `${count} days`),
            month: french ? 'Mois' : 'Month',
            resource: french ? 'Grille' : 'Time grid',
            week: french ? 'Semaine' : 'Week',
        },
        formats: french
            ? {
                  eventTime: 'HH:mm',
                  timeGutter: 'HH:mm',
                  timeGutterMinute: 'HH:mm',
              }
            : undefined,
        functions: {
            formatEventTime: (start: Date) => formatTime(start.getTime(), timeZone, locale),
        },
    }
}
