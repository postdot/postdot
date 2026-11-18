import { Button } from '@postdot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postdot/ui/components/tooltip'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { ChecklistMinimalisticIcon } from '@solar-icons/react/linear/checklist-minimalistic'
import { ClockCircleIcon } from '@solar-icons/react/linear/clock-circle'
import { MenuDotsVerticalIcon } from '@solar-icons/react/linear/menu-dots-vertical'
import { Pen2Icon } from '@solar-icons/react/linear/pen-2'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { ShareIcon } from '@solar-icons/react/linear/share'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { UnlinkIcon } from '@solar-icons/react/linear/unlink'
import { Fragment, type ReactNode } from 'react'

import { ChannelAvatar } from '@/components/identity-visuals'
import { StatusText, type StatusTone } from '@/components/status-text'
import type { Channel, WorkspaceChannelConnectionState } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import type { ChannelLifecycleAction } from './channel-lifecycle-dialog'

export function channelStatus({
    archived,
    connectionState,
    manual,
    needsSetup = false,
}: {
    readonly archived: boolean
    readonly connectionState: WorkspaceChannelConnectionState
    readonly manual: boolean
    readonly needsSetup?: boolean
}): { readonly label: string; readonly tone: StatusTone } | null {
    if (archived) return { label: m.channel_archived(), tone: 'neutral' }
    if (manual) return null
    if (connectionState === 'active') return { label: m.channel_connected(), tone: 'positive' }
    if (connectionState === 'revoked')
        return { label: m.publisher_access_revoked(), tone: 'critical' }
    if (connectionState === 'reconnect_required')
        return {
            label: m.publisher_reconnect_required_status(),
            tone: 'attention',
        }
    if (needsSetup) return { label: m.publisher_setup_required(), tone: 'attention' }
    return { label: m.channel_needs_connection(), tone: 'attention' }
}

/** Shared anatomy for project and workspace channel lists. */
export function ChannelRow({
    channel,
    id,
    secondary,
    status,
    note,
    action,
    menu,
}: {
    readonly channel: { id: string; name: string; profileId: string; state: string }
    readonly id?: string
    readonly secondary: readonly ReactNode[]
    readonly status?: { label: string; tone: StatusTone } | null
    readonly note?: string | null
    readonly action?: ReactNode
    readonly menu?: ReactNode
}) {
    return (
        <article
            id={id}
            data-channel-row={channel.id}
            className="grid min-w-0 scroll-mt-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-5">
            <ChannelAvatar
                channel={channel}
                className={channel.state === 'archived' ? 'opacity-40' : undefined}
                size="md"
            />
            <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <p className="min-w-0 break-words text-sm font-medium">{channel.name}</p>
                    {status ? <StatusText tone={status.tone}>{status.label}</StatusText> : null}
                </div>
                <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                    {secondary.map((part, index) => (
                        <Fragment key={index}>
                            {index > 0 ? <span aria-hidden="true">·</span> : null}
                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                {part}
                            </span>
                        </Fragment>
                    ))}
                </p>
                {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
            </div>
            {action ? (
                <div className="col-span-2 col-start-2 row-start-2 flex justify-start sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
                    {action}
                </div>
            ) : null}
            {menu ? <div className="col-start-3 row-start-1 sm:col-start-4">{menu}</div> : null}
        </article>
    )
}

export function ChannelActionsMenu({
    channel,
    canManage = true,
    disabled,
    onEditProfile,
    onLifecycleAction,
    onDisconnect,
    onCadence,
    onShare,
    sharingLabel,
}: {
    readonly canManage?: boolean
    readonly channel: Pick<Channel, 'id' | 'name' | 'state'>
    readonly disabled: boolean
    readonly onEditProfile?: () => void
    readonly onDisconnect?: () => void
    readonly onCadence?: () => void
    readonly sharingLabel?: string
    readonly onShare?: () => void
    readonly onLifecycleAction?: (action: ChannelLifecycleAction) => void
}) {
    useLanguage()
    const archived = channel.state === 'archived'

    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    aria-label={m.channel_manage({ channel: channel.name })}
                                    variant="ghost"
                                    size="icon-sm"
                                    className="shrink-0"
                                    disabled={disabled}>
                                    <MenuDotsVerticalIcon aria-hidden="true" />
                                </Button>
                            }
                        />
                    }
                />
                <TooltipContent>{m.channel_manage({ channel: channel.name })}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
                {canManage && onEditProfile && onLifecycleAction ? (
                    <>
                        <DropdownMenuItem onClick={onEditProfile}>
                            <ChecklistMinimalisticIcon aria-hidden="true" />
                            {m.channel_edit_profile()}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onLifecycleAction('rename')}>
                            <Pen2Icon aria-hidden="true" />
                            {m.channel_rename()}
                        </DropdownMenuItem>
                    </>
                ) : null}
                {canManage && onCadence && !archived ? (
                    <DropdownMenuItem onClick={onCadence}>
                        <ClockCircleIcon aria-hidden="true" />
                        {m.cadence_action()}
                    </DropdownMenuItem>
                ) : null}
                {onShare ? (
                    <DropdownMenuItem onClick={onShare}>
                        <ShareIcon aria-hidden="true" />
                        {sharingLabel ?? m.channel_share_action()}
                    </DropdownMenuItem>
                ) : null}
                {canManage && onDisconnect ? (
                    <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
                        <UnlinkIcon aria-hidden="true" />
                        {m.publisher_disconnect()}
                    </DropdownMenuItem>
                ) : null}
                {canManage && onLifecycleAction ? (
                    <>
                        <DropdownMenuSeparator />
                        {archived ? (
                            <DropdownMenuItem onClick={() => onLifecycleAction('restore')}>
                                <RestartIcon aria-hidden="true" />
                                {m.channel_restore()}
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem onClick={() => onLifecycleAction('archive')}>
                                <ArchiveIcon aria-hidden="true" />
                                {m.channel_archive()}
                            </DropdownMenuItem>
                        )}
                        {archived ? (
                            <DropdownMenuItem
                                variant="destructive"
                                onClick={() => onLifecycleAction('delete')}>
                                <TrashBinMinimalisticIcon aria-hidden="true" />
                                {m.channel_delete_permanently()}
                            </DropdownMenuItem>
                        ) : null}
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
