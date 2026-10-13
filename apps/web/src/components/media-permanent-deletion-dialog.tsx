import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'

import type { MediaReference } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function MediaPermanentDeletionDialog({
    asset,
    error,
    onConfirm,
    onOpenChange,
    open,
    pending,
}: {
    readonly asset: MediaReference | null
    readonly error: string | null
    readonly onConfirm: () => void
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pending: boolean
}) {
    if (asset === null) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-media-permanent-delete-dialog="true"
                showCloseButton={false}
                className="min-w-0 max-w-md gap-0 overflow-hidden p-0">
                <DialogHeader className="min-w-0 px-5 py-4">
                    <DialogTitle>{m.media_trash_delete_permanently_title()}</DialogTitle>
                </DialogHeader>

                <div className="min-w-0 space-y-2 px-5 pb-4">
                    <p className="truncate text-sm font-medium">{asset.asset.originalFilename}</p>
                    <DialogDescription className="text-xs leading-4">
                        {m.media_trash_delete_permanently_description()}
                    </DialogDescription>
                    {error !== null ? (
                        <p role="alert" className="text-xs text-state-failed">
                            {error}
                        </p>
                    ) : null}
                </div>

                <DialogFooter className="mx-0 mb-0 min-w-0 flex-wrap bg-muted px-5 py-3">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => onOpenChange(false)}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        data-media-permanent-delete-confirm="true"
                        disabled={pending}
                        onClick={onConfirm}>
                        <TrashBinMinimalisticIcon aria-hidden="true" />
                        {pending ? m.media_delete_pending() : m.media_delete_confirm()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
