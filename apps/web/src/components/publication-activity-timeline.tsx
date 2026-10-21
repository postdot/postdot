import { cn } from '@postdot/ui/lib/utils'
import { useEffect, useState } from 'react'

import type { AuditEvent } from '@/lib/api'
import { api } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface PublicationActivityTimelineProps {
    readonly projectId: string
    readonly publicationId: string
    readonly refreshKey?: number | string
    readonly timeZone: string
    readonly className?: string
}

interface LoadedActivity {
    readonly key: string
    readonly events: readonly AuditEvent[]
}

export function PublicationActivityTimeline({
    projectId,
    publicationId,
    refreshKey,
    timeZone,
    className,
}: PublicationActivityTimelineProps) {
    const { locale } = useLanguage()
    const publicationKey = `${projectId}:${publicationId}`
    const [activity, setActivity] = useState<LoadedActivity | null>(null)

    useEffect(() => {
        let active = true
        void api
            .listAuditEvents(projectId)
            .then(response => {
                if (!active) return
                setActivity({
                    key: publicationKey,
                    events: response.events.filter(
                        event =>
                            event.entityType === 'publication' && event.entityId === publicationId
                    ),
                })
            })
            .catch(() => {
                if (active) setActivity({ key: publicationKey, events: [] })
            })

        return () => {
            active = false
        }
    }, [projectId, publicationId, publicationKey, refreshKey])

    if (activity?.key !== publicationKey || activity.events.length === 0) return null

    const events = [...activity.events].sort((left, right) => right.createdAt - left.createdAt)

    return (
        <section
            className={cn(
                'mt-5 rounded-xl bg-surface-inset/45 px-4 py-4 shadow-surface sm:px-5',
                className
            )}
            data-publication-activity="true">
            <h2 className="text-sm font-semibold">{m.publication_activity_title()}</h2>
            <ol className="mt-4 space-y-3">
                {events.map(event => (
                    <li className="flex min-w-0 gap-3" key={event.id}>
                        <span
                            aria-hidden="true"
                            className={cn(
                                'mt-1.5 size-2 shrink-0 rounded-full',
                                activityDotClass(event.action)
                            )}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <p className="text-sm font-medium">
                                    {publicationActivityTitle(event.action)}
                                </p>
                                <time
                                    className="shrink-0 text-xs text-muted-foreground"
                                    dateTime={new Date(event.createdAt).toISOString()}>
                                    {formatProjectDateTime(event.createdAt, timeZone, locale)}
                                </time>
                            </div>
                            <PublicationActivityDetails
                                event={event}
                                locale={locale}
                                timeZone={timeZone}
                            />
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    )
}

function PublicationActivityDetails({
    event,
    locale,
    timeZone,
}: {
    readonly event: AuditEvent
    readonly locale: string
    readonly timeZone: string
}) {
    const metadata = parseMetadata(event.metadataJson)
    const summary: string[] = []
    const attempt = readFiniteNumber(metadata.attempt)
    const provider = readText(metadata.provider)
    const retryAt = readFiniteNumber(metadata.retryAt)
    const toState = readText(metadata.toState)
    const errorMessage = readText(metadata.errorMessage)
    const externalUrl = safeExternalUrl(readText(metadata.externalUrl))

    if (attempt !== null) summary.push(m.publication_activity_attempt({ attempt }))
    if (provider !== null) summary.push(m.publication_activity_provider({ provider }))
    if (event.action === 'publication.reconciled' && toState !== null) {
        const stateLabel = publicationActivityStateLabel(toState)
        if (stateLabel !== null) {
            summary.push(m.publication_activity_result({ result: stateLabel }))
        }
    }
    if (retryAt !== null) {
        summary.push(
            m.publication_activity_retry_at({
                date: formatProjectDateTime(retryAt, timeZone, locale),
            })
        )
    }

    return (
        <>
            {summary.length > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{summary.join(' · ')}</p>
            ) : null}
            {errorMessage !== null ? (
                <p className="mt-1 break-words text-xs text-state-failed">
                    {m.publication_activity_error({ message: errorMessage })}
                </p>
            ) : null}
            {externalUrl !== null ? (
                <a
                    className="mt-1 block truncate text-xs text-primary underline-offset-2 hover:underline"
                    href={externalUrl}
                    rel="noreferrer"
                    target="_blank">
                    {externalUrl}
                </a>
            ) : null}
        </>
    )
}

function publicationActivityTitle(action: string) {
    switch (action) {
        case 'publication.created':
            return m.publication_activity_created()
        case 'publication.target_promoted':
            return m.publication_activity_target_promoted()
        case 'publication.ready':
            return m.publication_activity_ready()
        case 'publication.published':
            return m.publication_activity_published()
        case 'publication.reconciled':
            return m.publication_activity_reconciled()
        case 'publication.retry_requested':
            return m.publication_activity_retry_requested()
        case 'publication.cancelled':
            return m.publication_activity_cancelled()
        case 'publication.execution.claimed':
            return m.publication_activity_claimed()
        case 'publication.execution.effect_started':
            return m.publication_activity_effect_started()
        case 'publication.execution.succeeded':
            return m.publication_activity_succeeded()
        case 'publication.execution.retry_scheduled':
            return m.publication_activity_retry_scheduled()
        case 'publication.execution.failed':
            return m.publication_activity_failed()
        case 'publication.execution.ambiguous':
            return m.publication_activity_ambiguous()
        case 'publication.execution.claim_recovered':
            return m.publication_activity_claim_recovered()
        case 'publication.execution.ambiguity_recovered':
            return m.publication_activity_ambiguity_recovered()
        case 'publication.execution.cancelled':
            return m.publication_activity_execution_cancelled()
        default:
            return m.publication_activity_updated()
    }
}

function publicationActivityStateLabel(state: string) {
    if (state === 'published') return m.publication_state_published()
    if (state === 'failed') return m.publication_state_failed()
    if (state === 'ready') return m.publication_state_ready()
    if (state === 'ambiguous') return m.publication_state_needs_review()
    if (state === 'cancelled') return m.publication_state_cancelled()
    return null
}

function activityDotClass(action: string) {
    if (action.includes('.failed') || action.includes('.ambiguous')) return 'bg-state-failed'
    if (action.includes('.succeeded') || action === 'publication.published') {
        return 'bg-state-published'
    }
    if (action.includes('.retry') || action === 'publication.reconciled') {
        return 'bg-state-attention'
    }
    return 'bg-primary/70'
}

function parseMetadata(metadataJson: string | null): Readonly<Record<string, unknown>> {
    if (metadataJson === null) return {}
    try {
        const parsed: unknown = JSON.parse(metadataJson)
        return isRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeExternalUrl(value: string | null): string | null {
    if (value === null) return null
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
    } catch {
        return null
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
