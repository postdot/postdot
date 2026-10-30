import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Input } from '@postdot/ui/components/input'
import { toast } from '@postdot/ui/components/toast'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@postdot/ui/components/tooltip'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useRef, useState } from 'react'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function CopyPublicationLink({
    projectId,
    publicationId,
}: {
    readonly projectId: string
    readonly publicationId: string
}) {
    useLanguage()
    const [copying, setCopying] = useState(false)
    const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
    const input = useRef<HTMLInputElement>(null)

    async function copy() {
        const url = new URL(
            `/dashboard/projects/${encodeURIComponent(projectId)}/publications/${encodeURIComponent(publicationId)}`,
            window.location.origin
        ).href
        if (!navigator.clipboard?.writeText) {
            setFallbackUrl(url)
            return
        }
        setCopying(true)
        try {
            await navigator.clipboard.writeText(url)
            toast.add({ title: m.publication_link_copied(), type: 'success' })
        } catch {
            setFallbackUrl(url)
        } finally {
            setCopying(false)
        }
    }

    return (
        <>
            <TooltipProvider delay={300}>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                aria-label={m.publication_copy_link()}
                                className="text-muted-foreground hover:text-foreground"
                                disabled={copying}
                                onClick={event => {
                                    event.stopPropagation()
                                    void copy()
                                }}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                            />
                        }>
                        <LinkIcon aria-hidden="true" className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>{m.publication_copy_link()}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <Dialog
                open={fallbackUrl !== null}
                onOpenChange={open => {
                    if (!open) setFallbackUrl(null)
                }}>
                <DialogContent initialFocus={input}>
                    <DialogHeader>
                        <DialogTitle>{m.publication_copy_link()}</DialogTitle>
                        <DialogDescription>{m.publication_link_manual_copy()}</DialogDescription>
                    </DialogHeader>
                    <Input
                        aria-label={m.publication_link_label()}
                        onFocus={event => event.currentTarget.select()}
                        readOnly
                        ref={input}
                        value={fallbackUrl ?? ''}
                    />
                    <DialogFooter>
                        <DialogClose render={<Button type="button" variant="outline" />}>
                            {m.common_close()}
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
