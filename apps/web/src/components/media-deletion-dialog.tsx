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
import { useEffect, useState } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, type MediaAssetUsage, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { mediaCanBeDeleted } from '@/lib/media-deletion-policy'
import * as m from '@/paraglide/messages.js'

export function MediaDeletionDialog({
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
    useLanguage()

    const [usage, setUsage] = useState<MediaAssetUsage | null>(null)
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState(false)

    useEffect(() => {
        if (!open || asset === null) {
            setUsage(null)
            setUsageLoading(false)
            setUsageError(false)
            return
        }

        let active = true
        setUsage(null)
        setUsageLoading(true)
        setUsageError(false)
        void api
            .getMediaUsage(asset.asset.projectId, asset.asset.id)
            .then(result => {
                if (active) setUsage(result)
            })
            .catch(() => {
                if (active) setUsageError(true)
            })
            .finally(() => {
                if (active) setUsageLoading(false)
            })

        return () => {
            active = false
        }
    }, [asset?.asset.id, asset?.asset.projectId, open])

    if (asset === null) return null

    const canDelete = mediaCanBeDeleted(usage)
    const representation = readyRepresentation(asset)
    const hasReferences = usage !== null && !canDelete

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-media-delete-dialog="true"
                showCloseButton={false}
                className="min-w-0 max-w-md gap-0 overflow-hidden p-0 sm:max-w-lg">
                <DialogHeader className="min-w-0 border-b border-border/60 px-5 py-4">
                    <DialogTitle>{m.media_delete_title()}</DialogTitle>
                </DialogHeader>

                <div data-media-delete-body="true" className="min-w-0 space-y-3 px-5 py-4">
                    <div
                        data-media-delete-preview="true"
                        className="flex h-48 w-full items-center justify-center overflow-hidden rounded-md bg-muted">
                        <MediaPreview
                            projectId={asset.asset.projectId}
                            asset={asset}
                            representation={representation}
                            className="size-full rounded-md object-contain text-xs font-medium uppercase text-muted-foreground"
                        />
                    </div>
                    <DialogDescription className="truncate">
                        {asset.asset.originalFilename}
                    </DialogDescription>
                    {usageLoading ? (
                        <p
                            data-media-delete-usage="checking"
                            className="text-sm text-muted-foreground">
                            {m.media_usage_checking()}
                        </p>
                    ) : usageError ? (
                        <p
                            data-media-delete-usage="unavailable"
                            className="text-sm text-state-attention">
                            {m.media_delete_unavailable_description()}
                        </p>
                    ) : hasReferences ? (
                        <div
                            data-media-delete-usage="blocked"
                            className="rounded-md bg-state-attention/10 px-3 py-2 text-sm text-state-attention">
                            <p>{mediaUsageDescription(usage)}</p>
                            <p className="mt-1 text-xs">{m.media_delete_used_description()}</p>
                        </div>
                    ) : null}

                    {error !== null ? (
                        <p
                            role="alert"
                            data-media-delete-error="true"
                            className="text-sm text-state-failed">
                            {error}
                        </p>
                    ) : null}
                </div>

                <DialogFooter className="mx-0 mb-0 min-w-0 flex-wrap border-t border-border/60 bg-muted px-5 py-3">
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
    return labels.join(' · ')
}
