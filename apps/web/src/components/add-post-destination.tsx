import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@herald/ui/components/dialog'
import { Field, FieldLabel } from '@herald/ui/components/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, type ChannelListItem } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function AddPostDestination({
    projectId,
    postId,
    channels,
    onAdded,
}: {
    projectId: string
    postId: string
    channels: readonly ChannelListItem[]
    onAdded: (publicationId: string) => Promise<void>
}) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Button variant="outline" onClick={() => setOpen(true)}>
                {m.add_destination_title()}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.add_destination_title()}</DialogTitle>
                    </DialogHeader>
                    {open ? (
                        <DestinationForm
                            projectId={projectId}
                            postId={postId}
                            channels={channels}
                            onAdded={onAdded}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    )
}

function DestinationForm({
    projectId,
    postId,
    channels,
    onAdded,
}: {
    projectId: string
    postId: string
    channels: readonly ChannelListItem[]
    onAdded: (publicationId: string) => Promise<void>
}) {
    const [channelId, setChannelId] = useState<string | null>(null)
    const [deliveryMode, setDeliveryMode] = useState<'manual' | 'automatic'>('manual')
    const [confirmed, setConfirmed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const query = useQuery({
        queryKey: ['project', projectId, 'post-destination-source', postId],
        queryFn: () => api.getPost(projectId, postId),
        staleTime: Infinity,
        gcTime: 0,
        refetchOnMount: 'always',
    })
    const destinationQuery = useQuery({
        queryKey: ['project', projectId, 'post-destinations', postId],
        queryFn: async () => {
            const result = []
            let cursor: string | undefined
            do {
                const page = await api.listPublications(projectId, {
                    limit: 100,
                    ...(cursor ? { cursor } : {}),
                })
                result.push(...page.publications.filter(item => item.postId === postId))
                cursor = page.nextCursor ?? undefined
            } while (cursor)
            return result
        },
        staleTime: 0,
    })
    const automaticAllowed =
        channels.find(channel => channel.id === channelId)?.execution.kind !== 'manual' &&
        channelId !== null
    const repeat = destinationQuery.data?.some(item => item.channelId === channelId) ?? false
    const ready = query.isSuccess && destinationQuery.isSuccess
    async function submit() {
        if (!ready || !channelId || busy) return
        if (repeat && !confirmed) {
            setConfirmed(true)
            return
        }
        setBusy(true)
        setError(null)
        try {
            const created = await api.addPostDestinations(projectId, postId, {
                expectedSourceRevision: query.data.post.sourceRevision,
                confirmExistingChannels: repeat && confirmed,
                publications: [{ channelId, deliveryMode }],
            })
            const publication = created.publications[0]
            if (publication) await onAdded(publication.id)
        } catch (cause) {
            if (cause instanceof ApiError && cause.status === 409) {
                setConfirmed(false)
                await destinationQuery.refetch()
            }
            setError(
                cause instanceof ApiError && cause.code === 'write_conflict'
                    ? m.add_destination_conflict()
                    : m.add_destination_failure()
            )
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="space-y-4">
            {query.data ? (
                <p className="text-sm text-muted-foreground">
                    {m.add_destination_source({ revision: String(query.data.post.sourceRevision) })}
                </p>
            ) : (
                <p className="text-sm text-muted-foreground">{m.add_destination_loading()}</p>
            )}
            <Field>
                <FieldLabel htmlFor="add-destination-channel">
                    {m.add_destination_channel()}
                </FieldLabel>
                <Select
                    items={channels.map(channel => ({ value: channel.id, label: channel.name }))}
                    value={channelId}
                    onValueChange={value => {
                        setChannelId(value)
                        if (
                            channels.find(channel => channel.id === value)?.execution.kind ===
                            'manual'
                        )
                            setDeliveryMode('manual')
                        setConfirmed(false)
                        setError(null)
                    }}>
                    <SelectTrigger id="add-destination-channel" disabled={busy}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {channels.map(channel => (
                            <SelectItem key={channel.id} value={channel.id}>
                                {channel.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>
            <Field>
                <FieldLabel htmlFor="add-destination-mode">{m.add_destination_mode()}</FieldLabel>
                <Select
                    items={[
                        { value: 'manual', label: m.add_destination_manual() },
                        { value: 'automatic', label: m.add_destination_automatic() },
                    ]}
                    value={deliveryMode}
                    onValueChange={value => {
                        if (value === 'manual' || value === 'automatic') {
                            setDeliveryMode(value)
                            setConfirmed(false)
                            setError(null)
                        }
                    }}>
                    <SelectTrigger id="add-destination-mode" disabled={busy}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="manual">{m.add_destination_manual()}</SelectItem>
                        <SelectItem value="automatic" disabled={!automaticAllowed}>
                            {m.add_destination_automatic()}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </Field>
            {repeat ? (
                <p className="text-sm text-muted-foreground">{m.add_destination_repeat()}</p>
            ) : null}
            {error || query.isError || destinationQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                    {error ?? m.add_destination_failure()}
                </p>
            ) : null}
            <DialogFooter>
                <Button disabled={!ready || !channelId || busy} onClick={() => void submit()}>
                    {confirmed && repeat ? m.add_destination_confirm() : m.add_destination_submit()}
                </Button>
            </DialogFooter>
        </div>
    )
}
