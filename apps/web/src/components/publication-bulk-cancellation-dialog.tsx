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

export function PublicationBulkCancellationDialog({
    onCancel,
    onOpenChange,
    open,
    pending,
    selectedCount,
}: {
    readonly onCancel: () => Promise<boolean>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pending: boolean
    readonly selectedCount: number
}) {
    useLanguage()

    function handleCancel() {
        void onCancel().then(succeeded => {
            if (succeeded) onOpenChange(false)
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{m.queue_cancel_title({ count: selectedCount })}</DialogTitle>
                    <DialogDescription>{m.queue_cancel_description()}</DialogDescription>
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
                        data-bulk-cancel-confirm="true"
                        onClick={handleCancel}
                        disabled={pending}>
                        <TrashBinMinimalisticIcon aria-hidden="true" />
                        {m.queue_cancel_submit()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
