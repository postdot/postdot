import { Badge } from '@postdot/ui/components/badge'
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
import { MenuDotsVerticalIcon } from '@solar-icons/react/linear/menu-dots-vertical'
import { Pen2Icon } from '@solar-icons/react/linear/pen-2'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { ShareIcon } from '@solar-icons/react/linear/share'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'

import { channelProfileLabel } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel, ChannelListItem, PublisherConnection } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import type { ChannelLifecycleAction } from './channel-lifecycle-dialog'

export function ChannelRow({
    channel,
    connection,
    disabled,
    onEditProfile,
    onLifecycleAction,
    onCadence,
    onShare,
    readOnly = false,
}: {
    readonly channel: ChannelListItem
    readonly connection?: PublisherConnection
    readonly disabled: boolean
    readonly onEditProfile: () => void
    readonly onLifecycleAction: (action: ChannelLifecycleAction) => void
    readonly onCadence?: () => void
    readonly onShare?: () => void
    readonly readOnly?: boolean
}) {
    useLanguage()
    const archived = channel.state === 'archived'

    return (
        <div
            id={`publisher-connection-${channel.id}`}
            className="flex min-w-0 scroll-mt-20 items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <ChannelAvatar
                    channel={channel}
                    className={archived ? 'opacity-35' : undefined}
                    size="md"
                />
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{channel.name}</p>
                        <Badge variant={archived ? 'outline' : 'secondary'}>
                            {channelConnectionLabel(channel, connection)}
                        </Badge>
                        {channel.shared && !archived ? (
                            <Badge variant="outline">{m.channel_shared_badge()}</Badge>
                        ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                        {channelProfileLabel(channel.profileId)}
                    </p>
                </div>
            </div>

            {readOnly ? null : (
                <ChannelActionsMenu
                    channel={channel}
                    disabled={disabled}
                    onEditProfile={onEditProfile}
                    onLifecycleAction={onLifecycleAction}
                    onCadence={onCadence}
                    onShare={onShare}
                />
            )}
        </div>
    )
}

export function ChannelActionsMenu({
    channel,
    disabled,
    onEditProfile,
    onLifecycleAction,
    onDisconnect,
    onCadence,
    onShare,
}: {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onEditProfile: () => void
    readonly onDisconnect?: () => void
    readonly onCadence?: () => void
    readonly onShare?: () => void
    readonly onLifecycleAction: (action: ChannelLifecycleAction) => void
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
                <DropdownMenuItem onClick={onEditProfile}>
                    <Pen2Icon aria-hidden="true" />
                    {m.channel_edit_profile()}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onLifecycleAction('rename')}>
                    <Pen2Icon aria-hidden="true" />
                    {m.channel_rename()}
                </DropdownMenuItem>
                {onCadence && !archived ? (
                    <DropdownMenuItem onClick={onCadence}>{m.cadence_action()}</DropdownMenuItem>
                ) : null}
                {onShare && !archived ? (
                    <DropdownMenuItem onClick={onShare}>
                        <ShareIcon aria-hidden="true" />
                        {m.channel_share_action()}
                    </DropdownMenuItem>
                ) : null}
                {onDisconnect ? (
                    <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
                        {m.publisher_disconnect()}
                    </DropdownMenuItem>
                ) : null}
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
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function channelConnectionLabel(channel: ChannelListItem, connection?: PublisherConnection) {
    if (channel.state === 'archived') return m.channel_archived()
    if (channel.execution.kind === 'manual') return m.channel_manual()
    if (connection?.state === 'active') return m.channel_connected()
    if (connection?.state === 'revoked') return m.publisher_access_revoked()
    if (connection?.state === 'reconnect_required') {
        return m.publisher_reconnect_required_status()
    }
    return m.channel_needs_connection()
}
