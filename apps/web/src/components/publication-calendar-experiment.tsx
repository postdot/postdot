import { Button } from '@herald/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/bold/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CalendarMinimalisticIcon } from '@solar-icons/react/bold/calendar-minimalistic'
import { useNavigate } from '@tanstack/react-router'
import { enUS, fr } from 'date-fns/locale'
import { useCallback, useMemo, useState, type CSSProperties } from 'react'

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
import type {
    CalendarView,
    EventCalendarOccurrence,
    EventCalendarSegment,
} from '@/components/reui/event-calendar/event-calendar-types'
import type { PublicationSummary } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { toDateKey, startOfCalendarMonth } from '@/lib/publication-calendar'
import {
    type PublicationCalendarEventData,
    toPublicationCalendarEvents,
} from '@/lib/publication-calendar-experiment'

const EXPERIMENTAL_VIEWS: CalendarView[] = ['month', 'agenda']
const EXPERIMENTAL_INTERACTIONS = {
    drag: false,
    resize: false,
    selectSlot: false,
} as const

export function PublicationCalendarExperiment({
    duePublicationIds,
    loading,
    locale,
    monthCursor,
    onMonthChange,
    projectId,
    publications,
    timeZone,
}: {
    readonly duePublicationIds: ReadonlySet<string>
    readonly loading: boolean
    readonly locale: string
    readonly monthCursor: Date
    readonly onMonthChange: (cursor: Date) => void
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
    const [previewPublicationId, setPreviewPublicationId] = useState<string | null>(null)

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
        (date: Date) => {
            void navigate({
                params: { projectId },
                search: { date: toDateKey(date, timeZone) },
                to: '/dashboard/projects/$projectId/compose',
            })
        },
        [navigate, projectId, timeZone]
    )
    const handleDateChange = useCallback(
        (date: Date) => onMonthChange(startOfCalendarMonth(date, timeZone)),
        [onMonthChange, timeZone]
    )
    const handleSlotClick = useCallback(
        (slot: { readonly date: Date }) => createOnDate(slot.date),
        [createOnDate]
    )
    const handleEventClick = useCallback(
        (occurrence: EventCalendarOccurrence<PublicationCalendarEventData>) => {
            const publication = occurrence.event.data?.publication
            if (publication !== undefined) openPublicationPreview(publication.id)
        },
        [openPublicationPreview]
    )
    const renderMoreContent = useCallback(
        ({
            close,
            day,
            segments,
        }: {
            readonly close: () => void
            readonly day: Date
            readonly segments: EventCalendarSegment<PublicationCalendarEventData>[]
        }) => (
            <PublicationCalendarMoreContent
                close={close}
                day={day}
                locale={locale}
                onEventClick={openPublicationPreview}
                segments={segments}
                timeZone={timeZone}
            />
        ),
        [locale, openPublicationPreview, timeZone]
    )
    const renderEvent = useCallback(
        ({ occurrence }: EventCalendarRenderEventProps<PublicationCalendarEventData>) => (
            <PublicationEventContent occurrence={occurrence} locale={locale} timeZone={timeZone} />
        ),
        [locale, timeZone]
    )

    return (
        <div className="min-w-0" data-calendar-experiment="reui">
            <EventCalendar<PublicationCalendarEventData>
                className="rounded-lg bg-surface-inset p-1 shadow-surface"
                date={monthCursor}
                defaultView="month"
                defaultViewSettings={{
                    nowIndicator: false,
                    weekends: true,
                    weekNumbers: false,
                }}
                events={events}
                fixedWeeks
                i18n={i18n}
                interactions={EXPERIMENTAL_INTERACTIONS}
                loading={loading}
                locale={dateFnsLocale}
                onDateChange={handleDateChange}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
                renderMoreContent={renderMoreContent}
                scrollMode="page"
                showDayAddButton
                showOutsideDays
                timeZone={timeZone}
                views={EXPERIMENTAL_VIEWS}
                weekStartsOn={1}
                renderEvent={renderEvent}
                classNames={{
                    dayAddButton: 'rounded-sm shadow-control',
                    event: '!shadow-none rounded-md',
                    monthBar: 'px-0.5',
                    monthBarOverlay: 'pt-8',
                    monthBody: 'gap-1',
                    monthCell: '!border-0 rounded-md bg-background shadow-field',
                    monthCellContent: 'gap-1 px-1.5 pt-1.5 pb-1.5',
                    monthCellFooter: 'px-1.5 pt-1.5',
                    monthDayHeader: '!border-0 rounded-md bg-muted/70 px-3 py-2',
                    monthDayNumber: '!size-auto !rounded-none px-0.5 font-medium',
                    monthHeader: '!border-0 gap-1',
                    monthRow: '!border-0 gap-1',
                    monthView: '!border-0',
                    moreIndicator: 'px-1.5 text-primary',
                }}>
                <EventCalendarToolbar />
                <ExperimentalCalendarBody
                    locale={locale}
                    onEventClick={openPublicationPreview}
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

function EventCalendarToolbar() {
    const { title, prev, next, today, isToday } = useEventCalendarNavigation()
    const { view, availableViews, setView, dayCount } = useEventCalendarView()
    const settings = useEventCalendarSettings()

    return (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5">
                <Button
                    aria-label={settings.i18n.labels.previous}
                    onClick={prev}
                    size="icon-sm"
                    variant="ghost">
                    <AltArrowLeftIcon aria-hidden="true" />
                </Button>
                <Button aria-pressed={isToday} onClick={today} size="sm" variant="ghost">
                    {settings.i18n.labels.today}
                </Button>
                <Button
                    aria-label={settings.i18n.labels.next}
                    onClick={next}
                    size="icon-sm"
                    variant="ghost">
                    <AltArrowRightIcon aria-hidden="true" />
                </Button>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:justify-end">
                <h2
                    className="min-w-0 truncate font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.04em]"
                    id="calendar-experimental-title">
                    {title}
                </h2>
                <div
                    aria-label={settings.i18n.labels.selectView}
                    className="flex items-center rounded-md bg-muted p-0.5"
                    role="group">
                    {availableViews.map(availableView => (
                        <Button
                            aria-pressed={availableView === view}
                            key={availableView}
                            onClick={() => setView(availableView)}
                            size="sm"
                            variant={availableView === view ? 'secondary' : 'ghost'}>
                            {viewName(settings, availableView, dayCount)}
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    )
}

function ExperimentalCalendarBody({
    locale,
    onEventClick,
    timeZone,
}: {
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly timeZone: string
}) {
    const { view } = useEventCalendarView()

    if (view === 'agenda') {
        return (
            <PublicationCalendarAgenda
                locale={locale}
                onEventClick={onEventClick}
                timeZone={timeZone}
            />
        )
    }

    return <EventCalendarMonthView maxEventsPerCell={3} />
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
                                    <span className="shrink-0 text-xs text-muted-foreground">
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

function PublicationCalendarMoreContent({
    close,
    day,
    locale,
    onEventClick,
    segments,
    timeZone,
}: {
    readonly close: () => void
    readonly day: Date
    readonly locale: string
    readonly onEventClick: (publicationId: string) => void
    readonly segments: EventCalendarSegment<PublicationCalendarEventData>[]
    readonly timeZone: string
}) {
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone,
        weekday: 'long',
    })

    return (
        <>
            <div className="px-1 py-1 text-xs font-medium capitalize text-muted-foreground">
                {dateFormatter.format(day)}
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto py-1 ps-1 pe-2">
                {segments.map(segment => {
                    const publication = segment.occurrence.event.data?.publication
                    if (publication === undefined) return null
                    const time = formatTime(publication.scheduledAt as number, timeZone, locale)
                    return (
                        <button
                            aria-label={`${segment.occurrence.event.title} — ${publication.channelName} — ${time}`}
                            className="group flex min-w-0 items-center gap-2 rounded-md bg-surface-field px-2.5 py-2 text-left shadow-field transition-[background-color] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                            key={segment.occurrence.key}
                            onClick={() => {
                                close()
                                onEventClick(publication.id)
                            }}
                            type="button">
                            <span
                                aria-hidden="true"
                                className="size-1.5 shrink-0 rounded-full bg-(--publication-color)"
                                style={
                                    {
                                        '--publication-color': segment.occurrence.event.color,
                                    } as CSSProperties
                                }
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                {segment.occurrence.event.title}
                            </span>
                            <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                                {time}
                            </span>
                        </button>
                    )
                })}
            </div>
        </>
    )
}

function PublicationEventContent({
    occurrence,
    locale,
    timeZone,
}: {
    readonly occurrence: EventCalendarOccurrence<PublicationCalendarEventData>
    readonly locale: string
    readonly timeZone: string
}) {
    const publication = occurrence.event.data?.publication
    if (publication === undefined) return null
    const time = formatTime(publication.scheduledAt as number, timeZone, locale)

    return (
        <>
            <span className="min-w-0 truncate font-medium">{occurrence.event.title}</span>
            <span className="hidden shrink-0 text-muted-foreground @[12rem]:inline">{time}</span>
            <span className="hidden min-w-0 truncate text-muted-foreground @[16rem]:inline">
                {publication.channelName}
            </span>
        </>
    )
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
            next: french ? 'Mois suivant' : 'Next',
            noEvents: french ? 'Aucune publication' : 'No publications',
            previous: french ? 'Mois précédent' : 'Previous',
            resources: french ? 'Ressources' : 'Resources',
            selectView: french ? 'Choisir la vue' : 'Select view',
            timeFrom: (time: string) => (french ? `À partir de ${time}` : `From ${time}`),
            timeRange: (from: string, to: string) => `${from} - ${to}`,
            timeUntil: (time: string) => (french ? `Jusqu'à ${time}` : `Until ${time}`),
            today: french ? 'Aujourd’hui' : 'Today',
            toggleDayEvents: (count: number) => `${count}`,
            viewShortcuts: {
                agenda: 'A',
                day: 'D',
                days: '5',
                month: 'M',
                resource: 'G',
                week: 'W',
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
        functions: {
            formatEventTime: (start: Date) => formatTime(start.getTime(), timeZone, locale),
        },
    }
}
