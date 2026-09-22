import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function PublicationDraftDeletionDialog({
    onDelete,
    onOpenChange,
    open,
    pending,
}: {
    readonly onDelete: () => Promise<boolean>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pending: boolean
}) {
    useLanguage()

    function handleDelete() {
        void onDelete().then(succeeded => {
            if (succeeded) onOpenChange(false)
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{m.queue_delete_draft_title()}</DialogTitle>
                    <DialogDescription>{m.queue_delete_draft_description()}</DialogDescription>
                </DialogHeader>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        data-publication-draft-delete-confirm="true"
                        onClick={handleDelete}
                        disabled={pending}>
                        <TrashBinMinimalisticIcon aria-hidden="true" />
                        {pending ? m.common_loading() : m.queue_delete_draft_submit()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
