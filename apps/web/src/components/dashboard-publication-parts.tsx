import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@herald/ui/components/tooltip'
import { cn } from '@herald/ui/lib/utils'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { ClipboardCheckIcon } from '@solar-icons/react/linear/clipboard-check'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { EyeIcon } from '@solar-icons/react/linear/eye'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { MenuDotsVerticalIcon } from '@solar-icons/react/linear/menu-dots-vertical'
import { PenIcon } from '@solar-icons/react/linear/pen'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'

import { api, type PublicationSummary } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import { canEditPublication } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

import { EmptyState, type EmptyStateIllustration, type EmptyStateLayout } from './empty-state'

export type PublicationState = PublicationSummary['state']

export function PublicationList({
    emptyDescription,
    emptyAction,
    emptyIllustration,
    emptyLayout,
    emptyTitle,
    allSelected = false,
    publications,
    duePublicationIds,
    onDeleteDraft,
    onDuplicateDraft,
    onPublish,
    onRetry,
    onToggleAll,
    pending = false,
    onToggleSelection,
    readOnly = false,
    selectedPublicationIds,
    showCreationDate = false,
    showPostLink = false,
    timeZone,
}: {
    readonly emptyDescription?: string | null
    readonly emptyAction?: ReactNode
    readonly emptyIllustration?: EmptyStateIllustration
    readonly emptyLayout?: EmptyStateLayout
    readonly emptyTitle?: string
    readonly allSelected?: boolean
    readonly publications: readonly PublicationSummary[]
    readonly duePublicationIds?: ReadonlySet<string>
    readonly onPublish?: (publicationId: string) => Promise<boolean>
    readonly onRetry?: (publicationId: string) => Promise<boolean>
    readonly onDeleteDraft?: (publication: PublicationSummary) => void
    readonly onDuplicateDraft?: (publicationId: string) => void
    readonly onToggleAll?: () => void
    readonly pending?: boolean
    readonly onToggleSelection?: (publication: PublicationSummary) => void
    readonly readOnly?: boolean
    readonly selectedPublicationIds?: ReadonlySet<string>
    readonly showCreationDate?: boolean
    readonly showPostLink?: boolean
    readonly timeZone: string
}) {
    useLanguage()
    if (publications.length === 0) {
        return (
            <EmptyState
                action={emptyAction}
                description={
                    emptyDescription === undefined
                        ? m.publication_empty_description()
                        : emptyDescription
                }
                illustration={emptyIllustration}
                layout={emptyLayout}
                title={emptyTitle ?? m.publication_empty_title()}
                className="mt-4"
                data-publication-empty-state="true"
            />
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
                className={cn(
                    'mt-4 overflow-hidden rounded-lg bg-surface-inset/55 p-1 shadow-surface lg:grid lg:gap-x-2',
                    selectionEnabled
                        ? 'lg:grid-cols-[auto_minmax(11rem,0.85fr)_minmax(0,1fr)_max-content]'
                        : 'lg:grid-cols-[minmax(11rem,0.85fr)_minmax(0,1fr)_max-content]'
                )}
                data-publication-list="true">
                {selectionEnabled ? (
                    <PublicationTableHeader
                        allSelected={resolvedAllSelected}
                        disabled={pending || onToggleAll === undefined}
                        indeterminate={selectedVisibleCount > 0 && !resolvedAllSelected}
                        onToggleAll={onToggleAll}
                    />
                ) : null}
                <div className="space-y-1 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-y-1 lg:space-y-0">
                    {publications.map(publication => {
                        const selected = selectedPublicationIds?.has(publication.id) ?? false
                        return (
                            <PublicationListItem
                                key={publication.id}
                                due={duePublicationIds?.has(publication.id) ?? false}
                                onDeleteDraft={onDeleteDraft}
                                onDuplicateDraft={onDuplicateDraft}
                                onPublish={onPublish}
                                onRetry={onRetry}
                                onToggleSelection={
                                    selectionEnabled
                                        ? () => onToggleSelection(publication)
                                        : undefined
                                }
                                pending={pending}
                                publication={publication}
                                readOnly={readOnly}
                                selected={selected}
                                showCreationDate={showCreationDate}
                                showPostLink={showPostLink}
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
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md bg-surface-field/35 px-2 py-2 sm:px-3 lg:col-span-full lg:grid-cols-subgrid"
            data-publication-table-header="true">
            <SelectionCheckbox
                checked={allSelected}
                dataQueueSelectAll
                disabled={disabled}
                indeterminate={indeterminate}
                label={allSelected ? m.queue_clear_selection() : m.queue_select_all_visible()}
                onChange={() => onToggleAll?.()}
            />
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 lg:col-span-3 lg:grid-cols-subgrid lg:gap-7">
                <div className="min-w-0">
                    <span className="block truncate text-xs font-medium text-muted-foreground">
                        {m.queue_column_publication()}
                    </span>
                    <span className="mt-1 block truncate text-xs font-medium text-muted-foreground lg:hidden">
                        {m.queue_column_destination()}
                    </span>
                </div>
                <span className="hidden truncate text-xs font-medium text-muted-foreground lg:block">
                    {m.queue_column_destination()}
                </span>
                <span className="text-right text-xs font-medium text-muted-foreground">
                    {m.queue_column_action()}
                </span>
            </div>
        </div>
    )
}

function PublicationListItem({
    due,
    onDeleteDraft,
    onDuplicateDraft,
    onPublish,
    onRetry,
    onToggleSelection,
    pending,
    publication,
    readOnly,
    selected,
    showCreationDate = false,
    showPostLink,
    timeZone,
}: {
    readonly due: boolean
    readonly onDeleteDraft?: (publication: PublicationSummary) => void
    readonly onDuplicateDraft?: (publicationId: string) => void
    readonly onPublish?: (publicationId: string) => Promise<boolean>
    readonly onRetry?: (publicationId: string) => Promise<boolean>
    readonly onToggleSelection?: () => void
    readonly pending: boolean
    readonly publication: PublicationSummary
    readonly readOnly: boolean
    readonly selected: boolean
    readonly showCreationDate: boolean
    readonly showPostLink: boolean
    readonly timeZone: string
}) {
    const selectionEnabled = onToggleSelection !== undefined
    const showManualAction = due && onPublish !== undefined
    const showRetryAction =
        publication.state === 'failed' &&
        publication.deliveryMode === 'automatic' &&
        onRetry !== undefined
    const showReviewAction = publication.state === 'ambiguous'
    const editable = !readOnly && canEditPublication(publication.state)

    return (
        <div
            data-publication-selection-card="true"
            data-publication-selection-active={selected || undefined}
            className={cn(
                'min-w-0 rounded-md transition-[background-color,box-shadow] hover:bg-surface-field/55 lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-2 lg:px-2 lg:py-3 sm:lg:px-3',
                selected && 'bg-primary/[0.07]'
            )}>
            <div
                className={cn(
                    'grid min-w-0 items-start gap-x-2 lg:contents',
                    selectionEnabled ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1'
                )}>
                {selectionEnabled ? (
                    <SelectionCheckbox
                        checked={selected}
                        dataPublicationSelectionToggle
                        label={
                            selected
                                ? m.queue_deselect_publication({
                                      title: publicationIdentityLabel(publication),
                                  })
                                : m.queue_select_publication({
                                      title: publicationIdentityLabel(publication),
                                  })
                        }
                        className="mt-4 ml-2 lg:col-start-1 lg:row-start-1 lg:m-0"
                        onChange={() => onToggleSelection?.()}
                    />
                ) : null}
                <PublicationRow
                    sharedColumns
                    selectionEnabled={selectionEnabled}
                    action={
                        <div className="flex flex-wrap items-center justify-end gap-1">
                            {showPostLink ? (
                                <Link
                                    className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                                    to="/dashboard/projects/$projectId/posts/$postId"
                                    params={{
                                        projectId: publication.projectId,
                                        postId: publication.postId,
                                    }}>
                                    {m.post_view()}
                                </Link>
                            ) : null}
                            {showRetryAction ? (
                                <Button
                                    data-publication-action="retry"
                                    disabled={pending}
                                    onClick={() => void onRetry(publication.id)}
                                    size="sm"
                                    type="button">
                                    <RestartIcon aria-hidden="true" />
                                    {m.publication_retry_delivery()}
                                </Button>
                            ) : showManualAction ? (
                                <Button
                                    data-publication-action="record-published"
                                    disabled={pending}
                                    onClick={() => void onPublish(publication.id)}
                                    size="sm"
                                    type="button">
                                    <CheckIcon aria-hidden="true" />
                                    {m.publication_record_published()}
                                </Button>
                            ) : showReviewAction ? (
                                <Button
                                    aria-label={m.publication_review_outcome()}
                                    className="text-muted-foreground hover:text-foreground"
                                    data-publication-action="review-outcome"
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
                                    <ClipboardCheckIcon aria-hidden="true" className="size-4" />
                                    <span>{m.publication_review_outcome()}</span>
                                </Button>
                            ) : (
                                <div className="flex items-center gap-1">
                                    <Button
                                        aria-label={
                                            publication.state === 'draft'
                                                ? m.queue_resume_draft()
                                                : editable
                                                  ? m.common_edit()
                                                  : m.common_view()
                                        }
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
                                        <span>
                                            {publication.state === 'draft'
                                                ? m.queue_resume_draft()
                                                : editable
                                                  ? m.common_edit()
                                                  : m.common_view()}
                                        </span>
                                    </Button>
                                    {publication.state === 'draft' &&
                                    (onDeleteDraft !== undefined ||
                                        onDuplicateDraft !== undefined) ? (
                                        <DropdownMenu modal={false}>
                                            <DropdownMenuTrigger
                                                render={
                                                    <Button
                                                        aria-label={m.queue_draft_actions()}
                                                        data-publication-draft-actions="true"
                                                        disabled={pending}
                                                        size="icon-sm"
                                                        type="button"
                                                        variant="ghost">
                                                        <MenuDotsVerticalIcon aria-hidden="true" />
                                                    </Button>
                                                }
                                            />
                                            <DropdownMenuContent align="end" className="min-w-40">
                                                {onDuplicateDraft !== undefined ? (
                                                    <DropdownMenuItem
                                                        disabled={pending}
                                                        onClick={() =>
                                                            onDuplicateDraft(publication.id)
                                                        }>
                                                        <CopyIcon aria-hidden="true" />
                                                        {m.queue_duplicate_draft()}
                                                    </DropdownMenuItem>
                                                ) : null}
                                                {onDeleteDraft !== undefined ? (
                                                    <>
                                                        {onDuplicateDraft !== undefined ? (
                                                            <DropdownMenuSeparator />
                                                        ) : null}
                                                        <DropdownMenuItem
                                                            disabled={pending}
                                                            onClick={() =>
                                                                onDeleteDraft(publication)
                                                            }
                                                            variant="destructive">
                                                            <TrashBinMinimalisticIcon aria-hidden="true" />
                                                            {m.queue_delete_draft()}
                                                        </DropdownMenuItem>
                                                    </>
                                                ) : null}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    }
                    due={due}
                    publication={publication}
                    showCreationDate={showCreationDate}
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
                    <CheckIcon className="size-3.5" />
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
    sharedColumns = false,
    selectionEnabled = false,
    showCreationDate = false,
    timeZone,
}: {
    readonly sharedColumns?: boolean
    readonly selectionEnabled?: boolean
    readonly action?: ReactNode
    readonly due?: boolean
    readonly publication: PublicationSummary
    readonly showCreationDate?: boolean
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const identityLabel = publicationIdentityLabel(publication)
    const createdAt = normalizePublicationTimestamp(publication.createdAt)
    const lastEditedAt =
        normalizePublicationTimestamp(publication.lastEditedAt) ??
        normalizePublicationTimestamp(publication.updatedAt) ??
        createdAt
    return (
        <div
            className={cn(
                'grid min-w-0 grid-cols-1 items-start gap-y-2 px-2 py-3 sm:px-3',
                sharedColumns && 'lg:contents',
                action && !sharedColumns
                    ? 'lg:grid-cols-[minmax(11rem,0.85fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-7'
                    : ''
            )}>
            <Link
                to="/dashboard/projects/$projectId/publications/$publicationId"
                params={{ projectId: publication.projectId, publicationId: publication.id }}
                data-publication-edit-link="true"
                className={cn(
                    'col-span-full row-start-1 group min-w-0',
                    sharedColumns && (selectionEnabled ? 'lg:col-start-2' : 'lg:col-start-1'),
                    sharedColumns
                        ? 'lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-7'
                        : action
                          ? 'lg:col-span-2 lg:grid lg:grid-cols-[minmax(11rem,0.85fr)_minmax(0,1fr)] lg:items-center lg:gap-7'
                          : ''
                )}>
                <div className="flex min-w-0 items-start gap-2">
                    {publication.mediaCount > 0 ? (
                        <PublicationMediaThumbnail publication={publication} />
                    ) : null}
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-medium" title={identityLabel}>
                            {identityLabel}
                        </h2>
                    </div>
                </div>
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex min-w-0 max-w-full items-center gap-2">
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
                                className="min-w-0 truncate text-sm font-medium"
                                title={publication.channelName}>
                                {publication.channelName}
                            </span>
                        </span>
                        {due ? (
                            <PublicationDueIndicator />
                        ) : (
                            <PublicationStatus state={publication.state} />
                        )}
                        {publication.draftReviewState === 'review_required' ? (
                            <span
                                data-publication-review-required="true"
                                className="text-xs font-medium text-state-attention">
                                {m.editor_target_review_required()}
                            </span>
                        ) : null}
                    </div>
                    {showCreationDate || publication.scheduledAt !== null ? (
                        <p
                            className={cn(
                                'mt-1 text-xs leading-5 text-muted-foreground',
                                !showCreationDate && 'truncate'
                            )}>
                            {showCreationDate
                                ? m.publication_draft_dates({
                                      created: formatPublicationDateTime(
                                          createdAt,
                                          timeZone,
                                          locale
                                      ),
                                      edited: formatPublicationDateTime(
                                          lastEditedAt,
                                          timeZone,
                                          locale
                                      ),
                                  })
                                : formatSchedule(publication.scheduledAt, timeZone, locale)}
                        </p>
                    ) : null}
                </div>
            </Link>
            {action ? (
                <div
                    className={cn(
                        'col-start-1 row-start-2 flex w-full min-w-0 items-center justify-end lg:col-start-3 lg:row-start-1 lg:w-auto',
                        sharedColumns && selectionEnabled && 'lg:col-start-4'
                    )}>
                    {action}
                </div>
            ) : null}
        </div>
    )
}

function normalizePublicationTimestamp(value: unknown): number | null {
    const timestamp = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(timestamp) ? timestamp : null
}

function formatPublicationDateTime(timestamp: number | null, timeZone: string, locale: string) {
    return timestamp === null ? '—' : formatProjectDateTime(timestamp, timeZone, locale)
}

function PublicationMediaThumbnail({ publication }: { readonly publication: PublicationSummary }) {
    const assetId = publication.mediaAssetIds?.[0]
    return (
        <span
            aria-hidden="true"
            className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-control text-muted-foreground">
            <GalleryIcon className="size-4" />
            {assetId ? (
                <img
                    alt=""
                    className="absolute size-9 rounded-md object-cover"
                    loading="lazy"
                    onError={event => {
                        event.currentTarget.style.display = 'none'
                    }}
                    src={api.mediaContentUrl(publication.projectId, assetId)}
                />
            ) : null}
        </span>
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
