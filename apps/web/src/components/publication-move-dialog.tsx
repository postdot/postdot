import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@postdot/ui/components/dialog'
import { Label } from '@postdot/ui/components/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { useState } from 'react'

import {
    api,
    formatApiError,
    type PublicationEditorState,
    type Channel,
    type ChannelListItem,
} from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function PublicationMoveDialog({
    editor,
    channels,
    onClose,
    onMoved,
    onError,
    disabled,
}: {
    editor: PublicationEditorState
    channels: readonly (Channel & { execution?: ChannelListItem['execution'] })[]
    onClose: () => void
    onMoved: (publicationId: string) => Promise<void>
    onError: (error: unknown) => void
    disabled: boolean
}) {
    const [snapshot] = useState(editor)
    const [target, setTarget] = useState<
        (Channel & { execution?: ChannelListItem['execution'] }) | null
    >(null)
    const [mode, setMode] = useState<'manual' | 'automatic'>(snapshot.publication.deliveryMode)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const targets = channels.filter(c => c.id !== snapshot.channel.id && c.state === 'active')
    const selected = targets.find(c => c.id === target?.id)
    const automatic = selected?.execution !== undefined && selected.execution.kind !== 'manual'
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open && !pending) onClose()
            }}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{m.publication_move_title()}</DialogTitle>
                    <DialogDescription>{m.publication_move_description()}</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 space-y-4 overflow-y-auto">
                    <div className="space-y-2">
                        <Label htmlFor="publication-move-channel">
                            {m.publication_move_channel()}
                        </Label>
                        <Select
                            value={target?.id ?? null}
                            items={targets.map(c => ({ value: c.id, label: c.name }))}
                            onValueChange={id => {
                                const next = targets.find(c => c.id === id) ?? null
                                setTarget(next)
                                if (!next?.execution || next.execution.kind === 'manual')
                                    setMode('manual')
                            }}>
                            <SelectTrigger
                                id="publication-move-channel"
                                className="w-full"
                                disabled={pending || disabled}>
                                <SelectValue placeholder={m.publication_move_choose()} />
                            </SelectTrigger>
                            <SelectContent>
                                {targets.map(channel => (
                                    <SelectItem key={channel.id} value={channel.id}>
                                        {channel.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {selected && automatic ? (
                        <div className="space-y-2">
                            <Label htmlFor="publication-move-mode">
                                {m.publication_move_mode()}
                            </Label>
                            <Select
                                value={mode}
                                onValueChange={value => {
                                    if (value === 'automatic' || value === 'manual') setMode(value)
                                }}
                                items={[
                                    { value: 'manual', label: m.publication_move_mode_manual() },
                                    {
                                        value: 'automatic',
                                        label: m.publication_move_mode_automatic(),
                                    },
                                ]}>
                                <SelectTrigger
                                    id="publication-move-mode"
                                    className="w-full"
                                    disabled={pending || disabled}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="manual">
                                        {m.publication_move_mode_manual()}
                                    </SelectItem>
                                    <SelectItem value="automatic">
                                        {m.publication_move_mode_automatic()}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    ) : selected ? (
                        <p className="text-sm text-muted-foreground">
                            {m.publication_move_manual()}
                        </p>
                    ) : null}
                    {targets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            {m.publication_move_no_channels()}
                        </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">{m.publication_move_review()}</p>
                    {error ? (
                        <Alert variant="destructive" role="alert">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={onClose}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        disabled={disabled || pending || !selected}
                        onClick={async () => {
                            if (!target) return
                            setPending(true)
                            setError(null)
                            try {
                                const response = await api.movePublication(
                                    snapshot.publication.projectId,
                                    snapshot.publication.id,
                                    {
                                        targetChannelId: target.id,
                                        deliveryMode: mode,
                                        expectedTargetProfileVersionId: target.profileVersionId,
                                        expectedPublicationUpdatedAt:
                                            snapshot.publication.updatedAt,
                                        expectedDraftRevision: snapshot.draft.revision,
                                        expectedSourceRevision: snapshot.post.sourceRevision,
                                        expectedTargetRevisionId:
                                            snapshot.publication.targetRevisionId,
                                        expectedScheduledAt: snapshot.publication.scheduledAt,
                                    }
                                )
                                await onMoved(response.editor.publication.id)
                            } catch (caught) {
                                setError(formatApiError(caught))
                                onError(caught)
                            } finally {
                                setPending(false)
                            }
                        }}>
                        {m.publication_move_confirm()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
