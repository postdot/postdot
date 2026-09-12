import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { useMemo, type CSSProperties } from 'react'

import { PublicationStatus } from '@/components/dashboard-publication-parts'
import type { PublicationSummary } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { toDateKey } from '@/lib/publication-calendar'

export function PublicationCalendarDayDetails({
    day,
    locale,
    onOpenPublication,
    publications,
    timeZone,
}: {
    readonly day: Date | null
    readonly locale: string
    readonly onOpenPublication: (publicationId: string) => void
    readonly publications: readonly PublicationSummary[]
    readonly timeZone: string
}) {
    const dayPublications = useMemo(() => {
        if (day === null) return []
        const dayKey = toDateKey(day, timeZone)
        return publications
            .filter(
                (publication): publication is PublicationSummary & { scheduledAt: number } =>
                    publication.scheduledAt !== null &&
                    toDateKey(new Date(publication.scheduledAt), timeZone) === dayKey
            )
            .sort((left, right) => {
                const scheduleDifference = left.scheduledAt - right.scheduledAt
                if (scheduleDifference !== 0) return scheduleDifference
                return `${left.postTitle ?? ''}\u0000${left.channelName}`.localeCompare(
                    `${right.postTitle ?? ''}\u0000${right.channelName}`
                )
            })
    }, [day, publications, timeZone])

    if (day === null) return null

    const dateLabel = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone,
        weekday: 'long',
        year: 'numeric',
    }).format(day)
    const publicationCount = dayPublications.length
    const countLabel =
        locale === 'fr'
            ? `${publicationCount} publication${publicationCount === 1 ? '' : 's'}`
            : `${publicationCount} publication${publicationCount === 1 ? '' : 's'}`

    return (
        <section
            aria-labelledby="publication-calendar-selected-day"
            className="mt-1 rounded-md bg-background p-3 shadow-field sm:p-4"
            data-slot="publication-calendar-day-details">
            <div className="flex min-w-0 items-baseline justify-between gap-3 px-1">
                <h3
                    className="truncate font-heading text-sm font-medium capitalize"
                    id="publication-calendar-selected-day">
                    {dateLabel}
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground">{countLabel}</span>
            </div>

            {publicationCount === 0 ? (
                <p className="px-1 pt-3 text-sm text-muted-foreground">
                    {locale === 'fr' ? 'Aucune publication' : 'No publications'}
                </p>
            ) : (
                <div className="mt-3 grid gap-1 sm:grid-cols-2">
                    {dayPublications.map(publication => (
                        <button
                            aria-label={getPublicationAriaLabel(publication, locale, timeZone)}
                            className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md bg-surface-field px-3 py-3 text-left shadow-field transition-[background-color] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                            data-slot="publication-calendar-day-publication"
                            key={publication.id}
                            onClick={() => onOpenPublication(publication.id)}
                            type="button">
                            <span className="flex min-w-0 items-center gap-2">
                                <span
                                    aria-hidden="true"
                                    className="size-2 shrink-0 rounded-full bg-(--publication-color)"
                                    style={
                                        {
                                            '--publication-color': publicationColor(publication),
                                        } as CSSProperties
                                    }
                                />
                                <span className="min-w-0 truncate text-sm font-medium">
                                    {publication.postTitle ??
                                        (locale === 'fr'
                                            ? 'Publication sans titre'
                                            : 'Untitled publication')}
                                </span>
                            </span>
                            <AltArrowRightIcon
                                aria-hidden="true"
                                className="size-4 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary"
                            />
                            <span className="min-w-0 truncate text-xs text-muted-foreground">
                                {publication.channelName}
                            </span>
                            <span className="justify-self-end text-xs tabular-nums text-muted-foreground">
                                {formatTime(publication.scheduledAt, timeZone, locale)}
                            </span>
                            <span className="col-span-2">
                                <PublicationStatus state={publication.state} />
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    )
}

function getPublicationAriaLabel(
    publication: PublicationSummary & { scheduledAt: number },
    locale: string,
    timeZone: string
) {
    const title =
        publication.postTitle ??
        (locale === 'fr' ? 'Publication sans titre' : 'Untitled publication')
    return `${title} — ${publication.channelName} — ${formatTime(
        publication.scheduledAt,
        timeZone,
        locale
    )}`
}

function publicationColor(publication: PublicationSummary) {
    if (publication.state === 'failed' || publication.state === 'ambiguous') {
        return 'var(--color-state-failed)'
    }
    if (publication.state === 'published') return 'var(--color-state-published)'
    return 'var(--color-primary)'
}
