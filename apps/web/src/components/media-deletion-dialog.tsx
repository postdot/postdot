import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'

import { type MediaAssetUsage, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaDeletionDialog({
    asset,
    error,
    onConfirm,
    onOpenChange,
    open,
    pending,
    usage,
}: {
    readonly asset: MediaReference | null
    readonly error: string | null
    readonly onConfirm: () => void
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pending: boolean
    readonly usage: MediaAssetUsage | null
}) {
    useLanguage()
    if (asset === null) return null

    const canDelete = mediaCanBeDeleted(usage)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-media-delete-dialog="true"
                showCloseButton={false}
                className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{m.media_delete_title()}</DialogTitle>
                    <DialogDescription className="truncate">
                        {asset.asset.originalFilename}
                    </DialogDescription>
                </DialogHeader>

                <div
                    data-media-delete-usage="true"
                    className={
                        canDelete
                            ? 'rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground'
                            : 'rounded-md bg-state-attention/10 px-3 py-2 text-sm text-state-attention'
                    }>
                    <p>{mediaUsageDescription(usage)}</p>
                    <p className="mt-1 text-xs">{deletionDescription(usage)}</p>
                </div>

                {error !== null ? (
                    <p
                        role="alert"
                        data-media-delete-error="true"
                        className="text-sm text-state-failed">
                        {error}
                    </p>
                ) : null}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => onOpenChange(false)}>
                        {m.common_cancel()}
                    </Button>
                    {canDelete ? (
                        <Button
                            type="button"
                            variant="destructive"
                            data-media-delete-confirm="true"
                            disabled={pending}
                            onClick={onConfirm}>
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                            {pending ? m.media_delete_pending() : m.media_delete_confirm()}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function mediaCanBeDeleted(usage: MediaAssetUsage | null): boolean {
    return (
        usage !== null &&
        usage.active.length === 0 &&
        usage.history.length === 0 &&
        usage.auditEventCount === 0
    )
}

function mediaUsageDescription(usage: MediaAssetUsage | null): string {
    if (usage === null) return m.media_usage_unavailable()

    const labels: string[] = []
    if (usage.active.some(reference => reference.kind === 'post')) {
        labels.push(m.media_usage_source())
    }
    const activePublications = usage.active.filter(
        reference => reference.kind === 'publication'
    ).length
    if (activePublications > 0) {
        labels.push(m.media_usage_active({ count: activePublications }))
    }
    const historyPublications = usage.history.filter(
        reference => reference.kind === 'publication'
    ).length
    if (historyPublications > 0) {
        labels.push(m.media_usage_history({ count: historyPublications }))
    }
    if (usage.auditEventCount > 0) {
        labels.push(m.media_usage_audit({ count: usage.auditEventCount }))
    }
    return labels.length === 0 ? m.media_usage_unused() : labels.join(' · ')
}

function deletionDescription(usage: MediaAssetUsage | null): string {
    if (usage === null) return m.media_delete_unavailable_description()
    return mediaCanBeDeleted(usage)
        ? m.media_delete_unused_description()
        : m.media_delete_used_description()
}
