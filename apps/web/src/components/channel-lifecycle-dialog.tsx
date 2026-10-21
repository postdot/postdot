import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import { toast } from '@postdot/ui/components/toast'
import { ArchiveIcon } from '@solar-icons/react/linear/archive'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { useEffect, useState } from 'react'

import type { Channel } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export type ChannelLifecycleAction = 'rename' | 'archive' | 'restore' | 'delete'

export function ChannelLifecycleDialog({
    action,
    channel,
    onAction,
    onOpenChange,
    open,
    pending,
    error,
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
    readonly error?: string | null
    readonly pending: boolean
}) {
    useLanguage()
    const [name, setName] = useState('')
    const [attempted, setAttempted] = useState(false)

    useEffect(() => {
        setAttempted(false)
        if (open && channel !== null) setName(channel.name)
    }, [channel, open])

    if (action === null || channel === null) return null

    const isRename = action === 'rename'
    const title =
        action === 'rename'
            ? m.channel_lifecycle_rename_title()
            : action === 'archive'
              ? m.channel_lifecycle_archive_title()
              : action === 'restore'
                ? m.channel_lifecycle_restore_title()
                : m.channel_lifecycle_delete_title()
    const description =
        action === 'rename'
            ? m.channel_lifecycle_rename_description()
            : action === 'archive'
              ? m.channel_lifecycle_archive_description()
              : action === 'restore'
                ? m.channel_lifecycle_restore_description()
                : m.channel_lifecycle_delete_description()
    const destructive = action === 'archive' || action === 'delete'

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 max-w-md flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain">
                    {isRename ? (
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="rename-channel-name">
                                {m.channel_name()}
                            </FieldLabel>
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

                    {attempted && error ? (
                        <Alert variant="destructive" role="alert">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}
                </div>
                <DialogFooter className="shrink-0">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        type="button"
                        variant={destructive ? 'destructive' : 'default'}
                        disabled={pending || (isRename && name.trim() === '')}
                        onClick={async () => {
                            setAttempted(false)
                            const succeeded = await onAction(action, channel, name.trim())
                            if (!succeeded) {
                                setAttempted(true)
                                return
                            }
                            const title =
                                action === 'rename'
                                    ? m.channel_renamed_success({ channel: name.trim() })
                                    : action === 'archive'
                                      ? m.channel_archived_success({ channel: channel.name })
                                      : action === 'restore'
                                        ? m.channel_restored_success({ channel: channel.name })
                                        : m.channel_deleted_success({ channel: channel.name })
                            toast.add({ title, type: 'success' })
                        }}>
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
