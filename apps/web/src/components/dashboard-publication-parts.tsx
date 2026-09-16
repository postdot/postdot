import { Button } from '@herald/ui/components/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@herald/ui/components/tooltip'
import { cn } from '@herald/ui/lib/utils'
import { CheckSquareIcon } from '@solar-icons/react/bold/check-square'
import { ClipboardCheckIcon } from '@solar-icons/react/bold/clipboard-check'
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
        <TooltipProvider delay={450}>
            <div
                className="mt-4 overflow-hidden rounded-lg bg-surface-inset/55 p-1 shadow-surface"
                data-publication-list="true">
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
        </TooltipProvider>
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
    const editable = canEditPublication(publication.state)

    return (
        <div
            data-publication-selection-card="true"
            data-publication-selection-active={selected || undefined}
            className={cn(
                'min-w-0 rounded-md transition-[background-color,box-shadow] hover:bg-surface-field/55',
                selected && 'bg-primary/[0.07] shadow-[inset_3px_0_0_var(--primary)]'
            )}>
            <div
                className={cn(
                    'grid min-w-0 items-start gap-x-2',
                    selectionEnabled ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1'
                )}>
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
                <PublicationRow
                    action={
                        showManualAction ? (
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            aria-label={m.publication_record_published()}
                                            data-publication-action="record-published"
                                            disabled={pending}
                                            onClick={() => void onPublish(publication.id)}
                                            size="icon-sm"
                                            type="button"
                                            variant="secondary">
                                            <CheckSquareIcon aria-hidden="true" />
                                        </Button>
                                    }
                                />
                                <TooltipContent>{m.publication_record_published()}</TooltipContent>
                            </Tooltip>
                        ) : (
                            <Button
                                aria-label={editable ? m.common_edit() : m.common_view()}
                                className="text-muted-foreground hover:text-foreground"
                                nativeButton={false}
                                render={
                                    <Link
                                        params={{
                                            projectId: publication.projectId,
                                            publicationId: publication.id,
                                        }}
                                        to="/dashboard/projects/$projectId/publications/$publicationId"
                                    />
                                }
                                size="sm"
                                variant="ghost">
                                {editable ? (
                                    <PenIcon aria-hidden="true" className="size-4" />
                                ) : (
                                    <EyeIcon aria-hidden="true" className="size-4" />
                                )}
                                <span>{editable ? m.common_edit() : m.common_view()}</span>
                            </Button>
                        )
                    }
                    due={due}
                    publication={publication}
                    timeZone={timeZone}
                />
            </div>
        </div>
    )
}

export function PublicationRow({
    action,
    due = false,
    publication,
    timeZone,
}: {
    readonly action?: ReactNode
    readonly due?: boolean
    readonly publication: PublicationSummary
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    return (
        <div
            className={cn(
                'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-2 py-3 sm:px-3',
                action
                    ? 'lg:grid-cols-[minmax(11rem,0.85fr)_minmax(0,1fr)_auto] lg:gap-7'
                    : 'lg:grid-cols-1'
            )}>
            <Link
                to="/dashboard/projects/$projectId/publications/$publicationId"
                params={{ projectId: publication.projectId, publicationId: publication.id }}
                data-publication-edit-link="true"
                className={cn(
                    'group min-w-0',
                    action
                        ? 'lg:col-span-2 lg:grid lg:grid-cols-[minmax(11rem,0.85fr)_minmax(0,1fr)] lg:items-center lg:gap-7'
                        : 'col-span-full'
                )}>
                <div className="min-w-0">
                    <h3
                        className="truncate text-sm font-medium"
                        title={publication.postTitle ?? m.publication_untitled_post()}>
                        {publication.postTitle ?? m.publication_untitled_post()}
                    </h3>
                </div>
                <div className="min-w-0">
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
                        <span
                            className="truncate text-sm font-medium"
                            title={publication.channelName}>
                            {publication.channelName}
                        </span>
                        {due ? (
                            <PublicationDueIndicator />
                        ) : (
                            <PublicationStatus state={publication.state} />
                        )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {formatSchedule(publication.scheduledAt, timeZone, locale)}
                        {publication.draftDiffersFromTarget ? (
                            <span className="text-state-attention">
                                {' · '}
                                {m.publication_draft_changes_pending()}
                            </span>
                        ) : null}
                    </p>
                </div>
            </Link>
            {action ? (
                <div className="row-start-1 flex min-w-0 items-center justify-end lg:col-start-3">
                    {action}
                </div>
            ) : null}
        </div>
    )
}

function PublicationDueIndicator() {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        aria-label={m.publication_due_manual()}
                        className="inline-flex size-5 shrink-0 cursor-help items-center justify-center text-state-attention outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        role="img"
                        tabIndex={0}>
                        <ClipboardCheckIcon aria-hidden="true" className="size-4" />
                    </span>
                }
            />
            <TooltipContent>{m.publication_due_manual()}</TooltipContent>
        </Tooltip>
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
