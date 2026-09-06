import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/bold/add'
import { LinkIcon } from '@solar-icons/react/bold/link'
import { useState } from 'react'

import type { Channel } from '@/lib/api'

interface MastodonConnectionDialogProps {
    readonly channel: Channel
    readonly disabled: boolean
    readonly onConnect: (channelId: string, instanceUrl: string) => Promise<void>
}

export function MastodonConnectionDialog({
    channel,
    disabled,
    onConnect,
}: MastodonConnectionDialogProps) {
    const [open, setOpen] = useState(false)
    const [instanceUrl, setInstanceUrl] = useState('')
    const [error, setError] = useState<string | null>(null)

    function reset() {
        setInstanceUrl('')
        setError(null)
    }

    async function submit() {
        const normalizedInstanceUrl = instanceUrl.trim()
        if (normalizedInstanceUrl === '') {
            setError('Enter the Mastodon instance URL.')
            return
        }

        let parsed: URL
        try {
            parsed = new URL(normalizedInstanceUrl)
        } catch {
            setError('Enter a valid Mastodon instance URL, such as https://mastodon.social.')
            return
        }
        if (
            parsed.protocol !== 'https:' ||
            parsed.username ||
            parsed.password ||
            (parsed.pathname !== '/' && parsed.pathname !== '')
        ) {
            setError('Use the HTTPS origin of the Mastodon instance without a path.')
            return
        }

        setError(null)
        await onConnect(channel.id, parsed.origin)
    }

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
                <AddIcon aria-hidden="true" />
                Connect Mastodon
            </Button>
            <Dialog
                open={open}
                onOpenChange={nextOpen => {
                    setOpen(nextOpen)
                    if (!nextOpen) reset()
                }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Connect {channel.name}</DialogTitle>
                        <DialogDescription>
                            Mastodon is decentralized. Enter the instance that hosts the account;
                            Herald will open that instance&apos;s authorization page.
                        </DialogDescription>
                    </DialogHeader>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor={`mastodon-instance-${channel.id}`}>
                            Mastodon instance
                        </FieldLabel>
                        <Input
                            id={`mastodon-instance-${channel.id}`}
                            autoFocus
                            autoComplete="url"
                            inputMode="url"
                            value={instanceUrl}
                            onChange={event => setInstanceUrl(event.target.value)}
                            placeholder="https://mastodon.social"
                            aria-describedby={`mastodon-instance-help-${channel.id}`}
                        />
                        <FieldDescription id={`mastodon-instance-help-${channel.id}`}>
                            Use only the instance origin, for example https://mastodon.social.
                        </FieldDescription>
                        {error === null ? null : (
                            <p className="text-sm text-destructive" role="alert">
                                {error}
                            </p>
                        )}
                    </Field>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setOpen(false)}
                            disabled={disabled}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={() => void submit()} disabled={disabled}>
                            <LinkIcon aria-hidden="true" />
                            Continue to Mastodon
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
