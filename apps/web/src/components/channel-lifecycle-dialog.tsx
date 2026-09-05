import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { ArchiveIcon } from '@solar-icons/react/bold/archive'
import { RestartIcon } from '@solar-icons/react/bold/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useEffect, useState } from 'react'

import type { Channel } from '@/lib/api'

export type ChannelLifecycleAction = 'rename' | 'archive' | 'restore' | 'delete'

export function ChannelLifecycleDialog({
    action,
    channel,
    onAction,
    onOpenChange,
    open,
    pending,
}: {
    readonly action: ChannelLifecycleAction | null
    readonly channel: Channel | null
    readonly onAction: (
        action: ChannelLifecycleAction,
        channel: Channel,
        name: string
    ) => Promise<boolean>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pending: boolean
}) {
    const [name, setName] = useState('')

    useEffect(() => {
        if (open && channel !== null) setName(channel.name)
    }, [channel, open])

    if (action === null || channel === null) return null

    const isRename = action === 'rename'
    const title =
        action === 'rename'
            ? 'Rename channel'
            : action === 'archive'
              ? 'Archive channel'
              : action === 'restore'
                ? 'Restore channel'
                : 'Delete channel'
    const description =
        action === 'rename'
            ? 'The new name is applied to this project channel only.'
            : action === 'archive'
              ? 'Archiving removes the channel from new composition and publisher actions while preserving its history.'
              : action === 'restore'
                ? 'Restoring makes this channel available for new publications again.'
                : 'Delete is only available after archiving and permanently removes the channel record.'
    const destructive = action === 'archive' || action === 'delete'

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                {isRename ? (
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="rename-channel-name">Channel name</FieldLabel>
                        <Input
                            id="rename-channel-name"
                            value={name}
                            onChange={event => setName(event.target.value)}
                            autoFocus
                        />
                    </Field>
                ) : (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                        {channel.name}
                    </p>
                )}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant={destructive ? 'destructive' : 'default'}
                        disabled={pending || (isRename && name.trim() === '')}
                        onClick={() => void onAction(action, channel, name.trim())}>
                        {action === 'archive' ? <ArchiveIcon aria-hidden="true" /> : null}
                        {action === 'restore' ? <RestartIcon aria-hidden="true" /> : null}
                        {action === 'delete' ? (
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                        ) : null}
                        {title}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
