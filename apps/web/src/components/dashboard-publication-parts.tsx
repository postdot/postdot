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
import { useEffect, useRef, type ReactNode } from 'react'

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
    allSelected = false,
    publications,
    duePublicationIds,
    onPublish,
    onToggleAll,
    pending = false,
    onToggleSelection,
    selectedPublicationIds,
    timeZone,
}: {
    readonly emptyDescription?: string
    readonly emptyAction?: ReactNode
    readonly emptyTitle?: string
    readonly allSelected?: boolean
    readonly publications: readonly PublicationSummary[]
    readonly duePublicationIds?: ReadonlySet<string>
    readonly onPublish?: (publicationId: string) => Promise<boolean>
    readonly onToggleAll?: () => void
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
    const selectedVisibleCount = selectionEnabled
        ? publications.reduce(
              (count, publication) => count + (selectedPublicationIds.has(publication.id) ? 1 : 0),
              0
          )
        : 0
    const resolvedAllSelected =
        allSelected || (publications.length > 0 && selectedVisibleCount === publications.length)

    return (
        <TooltipProvider delay={450}>
            <div
                className="mt-4 overflow-hidden rounded-lg bg-surface-inset/55 p-1 shadow-surface"
                data-publication-list="true">
                {selectionEnabled ? (
                    <PublicationTableHeader
                        allSelected={resolvedAllSelected}
                        disabled={pending || onToggleAll === undefined}
                        indeterminate={selectedVisibleCount > 0 && !resolvedAllSelected}
                        onToggleAll={onToggleAll}
                    />
                ) : null}
                <div className="space-y-1">
                    {publications.map(publication => {
                        const selected = selectedPublicationIds?.has(publication.id) ?? false
                        return (
                            <PublicationListItem
                                key={publication.id}
                                due={duePublicationIds?.has(publication.id) ?? false}
                                onPublish={onPublish}
                                onToggleSelection={
                                    selectionEnabled
                                        ? () => onToggleSelection(publication)
                                        : undefined
                                }
                                pending={pending}
                                publication={publication}
                                selected={selected}
                                timeZone={timeZone}
                            />
                        )
                    })}
                </div>
            </div>
        </TooltipProvider>
    )
}

function PublicationTableHeader({
    allSelected,
    disabled,
    indeterminate,
    onToggleAll,
}: {
    readonly allSelected: boolean
    readonly disabled: boolean
    readonly indeterminate: boolean
    readonly onToggleAll?: () => void
}) {
    return (
        <div
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md bg-surface-field/35 px-2 py-2 sm:px-3"
            data-publication-table-header="true">
            <SelectionCheckbox
                checked={allSelected}
                dataQueueSelectAll
                disabled={disabled}
                indeterminate={indeterminate}
                label={allSelected ? m.queue_clear_selection() : m.queue_select_all_visible()}
                onChange={() => onToggleAll?.()}
            />
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 lg:grid-cols-[minmax(11rem,0.85fr)_minmax(0,1fr)_auto] lg:gap-7">
                <div className="min-w-0">
                    <span className="block truncate text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {m.queue_column_publication()}
                    </span>
                    <span className="mt-1 block truncate text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:hidden">
                        {m.queue_column_destination()}
                    </span>
                </div>
                <span className="hidden truncate text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:block">
                    {m.queue_column_destination()}
                </span>
                <span className="text-right text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {m.queue_column_action()}
                </span>
            </div>
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
    const editable = canEditPublication(publication.state)

    return (
        <div
            data-publication-selection-card="true"
            data-publication-selection-active={selected || undefined}
            className={cn(
                'min-w-0 rounded-md transition-[background-color,box-shadow] hover:bg-surface-field/55',
                selected && 'bg-primary/[0.07]'
            )}>
            <div
                className={cn(
                    'grid min-w-0 items-start gap-x-2',
                    selectionEnabled ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1'
                )}>
                {selectionEnabled ? (
                    <SelectionCheckbox
                        checked={selected}
                        dataPublicationSelectionToggle
                        label={
                            selected
                                ? m.queue_deselect_publication({
                                      title: publication.postTitle ?? m.publication_untitled_post(),
                                  })
                                : m.queue_select_publication({
                                      title: publication.postTitle ?? m.publication_untitled_post(),
                                  })
                        }
                        className="mt-4 ml-2"
                        onChange={() => onToggleSelection?.()}
                    />
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

function SelectionCheckbox({
    checked,
    className,
    dataPublicationSelectionToggle = false,
    dataQueueSelectAll = false,
    disabled = false,
    indeterminate = false,
    label,
    onChange,
}: {
    readonly checked: boolean
    readonly className?: string
    readonly dataPublicationSelectionToggle?: boolean
    readonly dataQueueSelectAll?: boolean
    readonly disabled?: boolean
    readonly indeterminate?: boolean
    readonly label: string
    readonly onChange: (checked: boolean) => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (inputRef.current !== null) inputRef.current.indeterminate = indeterminate
    }, [indeterminate])

    return (
        <label
            className={cn(
                'flex size-6 shrink-0 cursor-pointer items-center justify-center',
                className
            )}
            data-publication-selection-toggle={dataPublicationSelectionToggle ? 'true' : undefined}
            data-queue-select-all={dataQueueSelectAll ? 'true' : undefined}>
            <input
                ref={inputRef}
                aria-label={label}
                checked={checked}
                className="peer sr-only"
                disabled={disabled}
                onChange={event => onChange(event.currentTarget.checked)}
                type="checkbox"
            />
            <span
                aria-hidden="true"
                className={cn(
                    'flex size-5 items-center justify-center rounded-[5px] border border-muted-foreground/45 bg-transparent text-transparent transition-[background-color,border-color,box-shadow]',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                    'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                    (checked || indeterminate) &&
                        'border-primary bg-primary text-primary-foreground shadow-control'
                )}>
                {checked ? (
                    <CheckSquareIcon className="size-3.5" />
                ) : indeterminate ? (
                    <span className="h-0.5 w-2.5 rounded-full bg-current" />
                ) : null}
            </span>
        </label>
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
                    'col-start-1 group min-w-0',
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
                <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end lg:col-start-3">
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
