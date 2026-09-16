import { Button } from '@herald/ui/components/button'
import { cn } from '@herald/ui/lib/utils'
import { CheckSquareIcon } from '@solar-icons/react/bold/check-square'
import { EyeIcon } from '@solar-icons/react/bold/eye'
import { ListIcon } from '@solar-icons/react/bold/list'
import { PenIcon } from '@solar-icons/react/bold/pen'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import type { PublicationSummary } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { canEditPublication } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

export type PublicationState = PublicationSummary['state']

export function PublicationList({
    emptyDescription,
    emptyAction,
    emptyTitle,
    publications,
    duePublicationIds,
    onPublish,
    pending = false,
    onToggleSelection,
    selectedPublicationIds,
    timeZone,
}: {
    readonly emptyDescription?: string
    readonly emptyAction?: ReactNode
    readonly emptyTitle?: string
    readonly publications: readonly PublicationSummary[]
    readonly duePublicationIds?: ReadonlySet<string>
    readonly onPublish?: (publicationId: string) => Promise<boolean>
    readonly pending?: boolean
    readonly onToggleSelection?: (publication: PublicationSummary) => void
    readonly selectedPublicationIds?: ReadonlySet<string>
    readonly timeZone: string
}) {
    useLanguage()
    if (publications.length === 0) {
        return (
            <div
                aria-live="polite"
                className="mt-4 flex min-w-0 flex-wrap items-center gap-3 rounded-md bg-surface-field/60 px-4 py-4 text-left shadow-field"
                role="status">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-control text-foreground shadow-control">
                    <ListIcon aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-heading text-sm font-medium tracking-tight">
                        {emptyTitle ?? m.publication_empty_title()}
                    </p>
                    <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                        {emptyDescription ?? m.publication_empty_description()}
                    </p>
                </div>
                {emptyAction ? <div className="ml-auto shrink-0">{emptyAction}</div> : null}
            </div>
        )
    }

    const selectionEnabled = onToggleSelection !== undefined && selectedPublicationIds !== undefined

    return (
        <div className="mt-4 space-y-1" data-publication-list="true">
            {publications.map(publication => {
                const selected = selectedPublicationIds?.has(publication.id) ?? false
                return (
                    <PublicationListItem
                        key={publication.id}
                        due={duePublicationIds?.has(publication.id) ?? false}
                        onPublish={onPublish}
                        onToggleSelection={
                            selectionEnabled ? () => onToggleSelection(publication) : undefined
                        }
                        pending={pending}
                        publication={publication}
                        selected={selected}
                        timeZone={timeZone}
                    />
                )
            })}
        </div>
    )
}

function PublicationListItem({
    due,
    onPublish,
    onToggleSelection,
    pending,
    publication,
    selected,
    timeZone,
}: {
    readonly due: boolean
    readonly onPublish?: (publicationId: string) => Promise<boolean>
    readonly onToggleSelection?: () => void
    readonly pending: boolean
    readonly publication: PublicationSummary
    readonly selected: boolean
    readonly timeZone: string
}) {
    const selectionEnabled = onToggleSelection !== undefined
    const showManualAction = due && onPublish !== undefined
    const rowGridClassName = selectionEnabled
        ? showManualAction
            ? 'grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto]'
            : 'grid-cols-[auto_minmax(0,1fr)]'
        : showManualAction
          ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]'
          : 'grid-cols-1'

    return (
        <div
            data-publication-selection-card="true"
            data-publication-selection-active={selected || undefined}
            className={cn(
                'min-w-0 rounded-md transition-[background-color,box-shadow] hover:bg-surface-field/55',
                selected && 'bg-primary/[0.07] shadow-[inset_3px_0_0_var(--primary)]'
            )}>
            <div className={cn('grid min-w-0 items-start gap-x-1', rowGridClassName)}>
                {selectionEnabled ? (
                    <button
                        type="button"
                        aria-label={
                            selected
                                ? m.queue_deselect_publication({
                                      title: publication.postTitle ?? m.publication_untitled_post(),
                                  })
                                : m.queue_select_publication({
                                      title: publication.postTitle ?? m.publication_untitled_post(),
                                  })
                        }
                        aria-pressed={selected}
                        data-publication-selection-toggle="true"
                        onClick={onToggleSelection}
                        className="mt-4 ml-2 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[color,background-color,box-shadow] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                        <span
                            aria-hidden="true"
                            className={cn(
                                'flex size-5 items-center justify-center rounded-[5px] border border-muted-foreground/45 transition-[background-color,border-color,box-shadow]',
                                selected &&
                                    'border-primary bg-primary text-primary-foreground shadow-control'
                            )}>
                            {selected ? <CheckSquareIcon className="size-3.5" /> : null}
                        </span>
                    </button>
                ) : null}
                <PublicationRow due={due} publication={publication} timeZone={timeZone} />
                {showManualAction ? (
                    <div
                        className={cn(
                            'col-span-full flex justify-end px-3 pb-3',
                            selectionEnabled && 'pl-9',
                            'lg:col-auto lg:items-center lg:px-3 lg:py-3 lg:pl-0',
                            selectionEnabled ? 'lg:[grid-column:3]' : 'lg:[grid-column:2]'
                        )}>
                        <Button
                            data-publication-action="record-published"
                            disabled={pending}
                            onClick={() => void onPublish(publication.id)}
                            size="sm"
                            type="button"
                            variant="secondary">
                            <CheckSquareIcon aria-hidden="true" />
                            {m.publication_record_published()}
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export function PublicationRow({
    due = false,
    publication,
    timeZone,
}: {
    readonly due?: boolean
    readonly publication: PublicationSummary
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const editable = canEditPublication(publication.state)
    return (
        <Link
            to="/dashboard/projects/$projectId/publications/$publicationId"
            params={{ projectId: publication.projectId, publicationId: publication.id }}
            data-publication-edit-link="true"
            className="group grid min-w-0 gap-4 px-1 py-4 transition-[background-color] sm:px-3 lg:grid-cols-[minmax(11rem,0.8fr)_minmax(0,1.3fr)_auto] lg:items-center lg:gap-7">
            <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{m.publication_source_post()}</p>
                <h3 className="mt-1 truncate text-sm font-medium">
                    {publication.postTitle ?? m.publication_untitled_post()}
                </h3>
            </div>
            <div className="min-w-0 pl-0 lg:pl-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                        className={cn(
                            'size-2 shrink-0 rounded-full bg-current',
                            channelMarkerClass(
                                publication.deliveryMode === 'automatic'
                                    ? 'automatic'
                                    : 'manual-message'
                            )
                        )}
                        aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium">{publication.channelName}</span>
                    {!due ? (
                        <span className="text-xs text-muted-foreground">
                            {publication.deliveryMode === 'automatic'
                                ? m.publication_automatic()
                                : m.publication_manual()}
                        </span>
                    ) : null}
                    <PublicationStatus due={due} state={publication.state} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    {formatSchedule(publication.scheduledAt, timeZone, locale)}
                    {publication.draftDiffersFromTarget
                        ? ` · ${m.publication_draft_changes_pending()}`
                        : ''}
                </p>
            </div>
            <span className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary lg:flex">
                {editable ? (
                    <PenIcon aria-hidden="true" className="size-4" />
                ) : (
                    <EyeIcon aria-hidden="true" className="size-4" />
                )}
                <span>{editable ? m.common_edit() : m.common_view()}</span>
            </span>
        </Link>
    )
}

export function PublicationStatus({
    due = false,
    state,
}: {
    readonly due?: boolean
    readonly state: PublicationState
}) {
    useLanguage()
    const label = due ? m.publication_due_manual() : publicationStateLabel(state)
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium',
                due ? 'text-state-attention' : statusClass(state)
            )}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {label}
        </span>
    )
}

export function channelMarkerClass(profileId: string) {
    if (profileId === 'linkedin') return 'text-primary'
    if (profileId === 'manual-message') return 'text-state-queued'
    return 'text-primary'
}

export function channelProfileLabel(profileId: string) {
    if (profileId === 'linkedin') return m.channel_linkedin_profile()
    if (profileId === 'bluesky') return m.channel_bluesky_profile()
    if (profileId === 'mastodon') return m.channel_mastodon_profile()
    if (profileId === 'discord') return m.channel_discord_profile()
    if (profileId === 'devto') return m.channel_devto_profile()
    if (profileId === 'manual-message') return m.channel_manual_profile()
    if (profileId === 'custom') return m.channel_custom_profile()
    return m.channel_profile()
}

export function formatSchedule(timestamp: number | null, timeZone = 'UTC', locale = 'en') {
    return formatProjectDateTime(timestamp, timeZone, locale, m.publication_unscheduled())
}

export function publicationStateLabel(state: PublicationState) {
    if (state === 'scheduled') return m.publication_state_queued()
    if (state === 'ready') return m.publication_state_ready()
    if (state === 'publishing') return m.publication_state_publishing()
    if (state === 'published') return m.publication_state_published()
    if (state === 'failed') return m.publication_state_failed()
    if (state === 'ambiguous') return m.publication_state_needs_review()
    if (state === 'cancelled') return m.publication_state_cancelled()
    return m.publication_state_draft()
}

function statusClass(state: PublicationState) {
    if (state === 'failed' || state === 'ambiguous') return 'text-state-failed'
    if (state === 'published') return 'text-state-published'
    if (state === 'scheduled' || state === 'ready' || state === 'publishing') {
        return 'text-state-queued'
    }
    return 'text-state-draft'
}
