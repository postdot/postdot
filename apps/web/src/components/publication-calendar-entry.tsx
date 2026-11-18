import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuTrigger,
} from '@postdot/ui/components/context-menu'
import { DropdownMenuItem, DropdownMenuSeparator } from '@postdot/ui/components/dropdown-menu'
import { cn } from '@postdot/ui/lib/utils'
import { CheckCircleIcon } from '@solar-icons/react/linear/check-circle'
import { ChecklistMinimalisticIcon } from '@solar-icons/react/linear/checklist-minimalistic'
import { ClipboardCheckIcon } from '@solar-icons/react/linear/clipboard-check'
import { DangerTriangleIcon } from '@solar-icons/react/linear/danger-triangle'
import { EyeIcon } from '@solar-icons/react/linear/eye'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { SquareArrowRightUpIcon } from '@solar-icons/react/linear/square-arrow-right-up'
import type { ReactNode } from 'react'

import { PublicationStatus, publicationStateLabel } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, PublicationSummary } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { publicationIdentityLabel } from '@/lib/publication-identity'
import * as m from '@/paraglide/messages.js'

type ChannelIdentity = Pick<Channel, 'id' | 'name' | 'profileId'>

type EntryStatus = 'failed' | 'due' | 'published'

/**
 * The one state of an entry worth marking, most urgent first. Scheduled is the norm and
 * gets no mark; a mixed entry shows what needs the person first.
 */
export function calendarEntryStatus(
    publications: readonly PublicationSummary[],
    duePublicationIds: ReadonlySet<string>
): EntryStatus | null {
    if (publications.some(item => item.state === 'failed' || item.state === 'ambiguous'))
        return 'failed'
    if (publications.some(item => duePublicationIds.has(item.id))) return 'due'
    if (publications.length > 0 && publications.every(item => item.state === 'published'))
        return 'published'
    return null
}

function entryStatusLabel(status: EntryStatus, publications: readonly PublicationSummary[]) {
    if (status === 'due') return m.publication_due_manual()
    if (status === 'published') return publicationStateLabel('published')
    return publications.some(item => item.state === 'failed')
        ? publicationStateLabel('failed')
        : publicationStateLabel('ambiguous')
}

/**
 * A state mark that says what it means: an icon in the state colour with its word for
 * assistive technology. The hover card spells the state out per channel.
 */
export function CalendarStatusGlyph({
    className,
    publications,
    status,
}: {
    readonly className?: string
    readonly publications: readonly PublicationSummary[]
    readonly status: EntryStatus | null
}) {
    if (status === null) return null
    const Icon =
        status === 'failed'
            ? DangerTriangleIcon
            : status === 'due'
              ? ClipboardCheckIcon
              : CheckCircleIcon
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center',
                status === 'failed' && 'text-state-failed',
                status === 'due' && 'text-state-attention',
                status === 'published' && 'text-state-published',
                className
            )}
            data-calendar-entry-status={status}>
            <Icon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{entryStatusLabel(status, publications)}</span>
        </span>
    )
}

/** Hover card of a calendar entry: the post, then each channel with its time and state. */
export function PublicationHoverCard({
    channelsById,
    duePublicationIds,
    locale,
    publications,
    timeZone,
}: {
    readonly channelsById: ReadonlyMap<string, ChannelIdentity>
    readonly duePublicationIds: ReadonlySet<string>
    readonly locale: string
    readonly publications: readonly PublicationSummary[]
    readonly timeZone: string
}) {
    const lead = publications[0]
    if (lead === undefined) return null
    return (
        <div className="grid gap-2.5" data-calendar-hover-card="true">
            <p className="line-clamp-2 text-sm font-medium break-words">
                {publicationIdentityLabel(lead)}
            </p>
            <ul className="grid gap-1.5">
                {publications.map(item => (
                    <li className="flex min-w-0 items-center gap-2 text-xs" key={item.id}>
                        <ChannelAvatar
                            channel={
                                channelsById.get(item.channelId) ?? {
                                    id: item.channelId,
                                    name: item.channelName,
                                    profileId: '',
                                }
                            }
                            size="xs"
                        />
                        <span className="min-w-0 flex-1 truncate">{item.channelName}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                            {item.scheduledAt === null
                                ? null
                                : formatTime(item.scheduledAt, timeZone, locale)}
                        </span>
                        <PublicationStatus
                            due={duePublicationIds.has(item.id)}
                            state={item.state}
                        />
                    </li>
                ))}
            </ul>
            <p className="text-[0.6875rem] text-muted-foreground">{m.calendar_entry_hint()}</p>
        </div>
    )
}

/**
 * Right-click menu of a calendar entry. Viewers get consultation only; state changes
 * stay one per channel so the person knows exactly what each item acts on.
 */
export function PublicationEntryMenu({
    children,
    duePublicationIds,
    onMarkPublished,
    onOpen,
    onPreview,
    onRetry,
    onSelect,
    pending,
    publications,
    readOnly,
}: {
    readonly children: ReactNode
    readonly duePublicationIds: ReadonlySet<string>
    readonly onMarkPublished: (publicationId: string) => void
    readonly onOpen: (publicationId: string) => void
    readonly onPreview: (publicationId: string) => void
    readonly onRetry: (publicationId: string) => void
    readonly onSelect: (publicationIds: readonly string[]) => void
    readonly pending: boolean
    readonly publications: readonly PublicationSummary[]
    readonly readOnly: boolean
}) {
    const lead = publications[0]
    if (lead === undefined) return children
    const due = readOnly ? [] : publications.filter(item => duePublicationIds.has(item.id))
    const failed = readOnly ? [] : publications.filter(item => item.state === 'failed')
    const several = publications.length > 1
    return (
        <ContextMenu>
            {/* A span: the trigger sits inside the entry's button. */}
            <ContextMenuTrigger
                className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch"
                render={<span />}
                data-calendar-entry-menu="true">
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent>
                <DropdownMenuItem onClick={() => onPreview(lead.id)}>
                    <EyeIcon aria-hidden="true" />
                    {m.calendar_menu_preview()}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpen(lead.id)}>
                    <SquareArrowRightUpIcon aria-hidden="true" />
                    {m.post_view()}
                </DropdownMenuItem>
                {due.length > 0 || failed.length > 0 ? <DropdownMenuSeparator /> : null}
                {due.map(item => (
                    <DropdownMenuItem
                        disabled={pending}
                        key={`publish:${item.id}`}
                        onClick={() => onMarkPublished(item.id)}>
                        <ClipboardCheckIcon aria-hidden="true" />
                        {several
                            ? m.calendar_menu_mark_published_on({ channel: item.channelName })
                            : m.publication_outcome_mark_published()}
                    </DropdownMenuItem>
                ))}
                {failed.map(item => (
                    <DropdownMenuItem
                        disabled={pending}
                        key={`retry:${item.id}`}
                        onClick={() => onRetry(item.id)}>
                        <RestartIcon aria-hidden="true" />
                        {several
                            ? m.calendar_menu_retry_on({ channel: item.channelName })
                            : m.common_retry()}
                    </DropdownMenuItem>
                ))}
                {readOnly ? null : (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => onSelect(publications.map(item => item.id))}>
                            <ChecklistMinimalisticIcon aria-hidden="true" />
                            {m.calendar_select()}
                        </DropdownMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    )
}
