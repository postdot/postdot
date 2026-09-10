import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { ArchiveIcon } from '@solar-icons/react/bold/archive'
import { MenuDotsIcon } from '@solar-icons/react/bold/menu-dots'
import { Pen2Icon } from '@solar-icons/react/bold/pen-2'
import { RestartIcon } from '@solar-icons/react/bold/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'

import { channelProfileLabel } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import type { ChannelLifecycleAction } from './channel-lifecycle-dialog'

export function ChannelRow({
    channel,
    disabled,
    onEditProfile,
    onLifecycleAction,
}: {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onEditProfile: () => void
    readonly onLifecycleAction: (action: ChannelLifecycleAction) => void
}) {
    useLanguage()
    const archived = channel.state === 'archived'

    return (
        <div className="flex min-w-0 flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
                <ChannelAvatar
                    channel={channel}
                    className={archived ? 'opacity-35' : undefined}
                    size="md"
                />
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{channel.name}</p>
                        <Badge variant={archived ? 'outline' : 'secondary'}>
                            {archived ? m.channel_archived() : m.channel_active()}
                        </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                        {channelProfileLabel(channel.profileId)}
                    </p>
                </div>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            aria-label={m.channel_manage({ channel: channel.name })}
                            variant="ghost"
                            size="icon-sm"
                            disabled={disabled}>
                            <MenuDotsIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onEditProfile}>
                        <Pen2Icon aria-hidden="true" />
                        {m.channel_edit_profile()}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onLifecycleAction('rename')}>
                        <Pen2Icon aria-hidden="true" />
                        {m.channel_rename()}
                    </DropdownMenuItem>
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
        </div>
    )
}
