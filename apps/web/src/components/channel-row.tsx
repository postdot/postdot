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

import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import type { ChannelLifecycleAction } from './channel-lifecycle-dialog'

export function ChannelActionsMenu({
    channel,
    canManage = true,
    disabled,
    onEditProfile,
    onLifecycleAction,
    onDisconnect,
    onCadence,
    onShare,
}: {
    readonly canManage?: boolean
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
                {canManage ? (
                    <>
                        <DropdownMenuItem onClick={onEditProfile}>
                            <Pen2Icon aria-hidden="true" />
                            {m.channel_edit_profile()}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onLifecycleAction('rename')}>
                            <Pen2Icon aria-hidden="true" />
                            {m.channel_rename()}
                        </DropdownMenuItem>
                    </>
                ) : null}
                {canManage && onCadence && !archived ? (
                    <DropdownMenuItem onClick={onCadence}>{m.cadence_action()}</DropdownMenuItem>
                ) : null}
                {onShare && !archived ? (
                    <DropdownMenuItem onClick={onShare}>
                        <ShareIcon aria-hidden="true" />
                        {m.channel_share_action()}
                    </DropdownMenuItem>
                ) : null}
                {canManage && onDisconnect ? (
                    <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
                        {m.publisher_disconnect()}
                    </DropdownMenuItem>
                ) : null}
                {canManage ? (
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
