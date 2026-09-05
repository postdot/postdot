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

import { channelMarkerClass, channelProfileLabel } from '@/components/dashboard-publication-parts'
import type { Channel } from '@/lib/api'

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
    const archived = channel.state === 'archived'

    return (
        <div className="flex min-w-0 flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
                <span
                    className={`size-2.5 shrink-0 rounded-full bg-current ${channelMarkerClass(channel.profileId)} ${archived ? 'opacity-35' : ''}`}
                    aria-hidden="true"
                />
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{channel.name}</p>
                        <Badge variant={archived ? 'outline' : 'secondary'}>
                            {archived ? 'Archived' : 'Active'}
                        </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                        {channelProfileLabel(channel.profileId)} · profile v
                        {channel.profileVersionId.slice(0, 8)}
                    </p>
                </div>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            aria-label={`Manage ${channel.name}`}
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
                        Edit profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onLifecycleAction('rename')}>
                        <Pen2Icon aria-hidden="true" />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {archived ? (
                        <DropdownMenuItem onClick={() => onLifecycleAction('restore')}>
                            <RestartIcon aria-hidden="true" />
                            Restore
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onClick={() => onLifecycleAction('archive')}>
                            <ArchiveIcon aria-hidden="true" />
                            Archive
                        </DropdownMenuItem>
                    )}
                    {archived ? (
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onLifecycleAction('delete')}>
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                            Delete permanently
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
