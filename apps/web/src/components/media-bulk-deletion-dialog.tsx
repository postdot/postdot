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
import { formatMediaRetentionDuration } from '@/lib/media-retention'
import * as m from '@/paraglide/messages.js'

export function MediaBulkDeletionDialog({
    assets,
    error,
    onConfirm,
    onOpenChange,
    open,
    pending,
    retentionMs,
}: {
    readonly assets: readonly MediaReference[]
    readonly error: string | null
    readonly onConfirm: () => void
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pending: boolean
    readonly retentionMs: number
}) {
    useLanguage()

    const assetIds = assets.map(asset => asset.asset.id).join('\u0000')
    const [usageByAssetId, setUsageByAssetId] = useState<Record<string, MediaAssetUsage>>({})
    const [usageErrorIds, setUsageErrorIds] = useState<Set<string>>(() => new Set())
    const [usageLoading, setUsageLoading] = useState(false)

    useEffect(() => {
        if (!open || assets.length === 0) {
            setUsageByAssetId({})
            setUsageErrorIds(new Set())
            setUsageLoading(false)
            return
        }

        let active = true
        setUsageByAssetId({})
        setUsageErrorIds(new Set())
        setUsageLoading(true)

        void Promise.allSettled(
            assets.map(async asset => ({
                assetId: asset.asset.id,
                usage: await api.getMediaUsage(asset.asset.projectId, asset.asset.id),
            }))
        ).then(results => {
            if (!active) return

            const nextUsage: Record<string, MediaAssetUsage> = {}
            const nextErrors = new Set<string>()
            for (const [index, result] of results.entries()) {
                const asset = assets[index]
                if (asset === undefined) continue
                if (result.status === 'fulfilled') {
                    nextUsage[result.value.assetId] = result.value.usage
                } else {
                    nextErrors.add(asset.asset.id)
                }
            }
            setUsageByAssetId(nextUsage)
            setUsageErrorIds(nextErrors)
            setUsageLoading(false)
        })

        return () => {
            active = false
        }
    }, [assetIds, assets, open])

    if (!open || assets.length === 0) return null

    const blockedAssets = assets.filter(asset => {
        const usage = usageByAssetId[asset.asset.id]
        return usage !== undefined && !mediaCanBeDeleted(usage)
    })
    const canDelete =
        !usageLoading && usageErrorIds.size === 0 && blockedAssets.length === 0 && assets.length > 0
    const previewAssets = assets.slice(0, 8)
    const hiddenPreviewCount = assets.length - previewAssets.length

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-media-bulk-delete-dialog="true"
                showCloseButton={false}
                className="min-w-0 max-w-md gap-0 overflow-hidden p-0 sm:max-w-lg">
                <DialogHeader className="min-w-0 border-b border-border/60 px-5 py-4">
                    <DialogTitle>{m.media_bulk_delete_title({ count: assets.length })}</DialogTitle>
                </DialogHeader>

                <div data-media-bulk-delete-body="true" className="min-w-0 space-y-4 px-5 py-4">
                    <div
                        aria-label={m.media_bulk_delete_preview_label()}
                        data-media-bulk-delete-previews="true"
                        className="flex max-w-full gap-2 overflow-x-auto pb-1">
                        {previewAssets.map(asset => (
                            <div
                                key={asset.asset.id}
                                role="img"
                                aria-label={asset.asset.originalFilename}
                                data-media-bulk-delete-preview="true"
                                title={asset.asset.originalFilename}
                                className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                                <MediaPreview
                                    projectId={asset.asset.projectId}
                                    asset={asset}
                                    representation={readyRepresentation(asset)}
                                    className="size-full object-cover text-xs font-medium uppercase text-muted-foreground"
                                />
                            </div>
                        ))}
                        {hiddenPreviewCount > 0 ? (
                            <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground">
                                +{hiddenPreviewCount}
                            </div>
                        ) : null}
                    </div>

                    <DialogDescription>
                        {retentionMs > 0
                            ? m.media_bulk_delete_description({
                                  count: assets.length,
                                  duration: formatMediaRetentionDuration(retentionMs),
                              })
                            : m.media_bulk_delete_immediate({ count: assets.length })}
                    </DialogDescription>

                    {usageLoading ? (
                        <p
                            data-media-bulk-delete-usage="checking"
                            className="text-sm text-muted-foreground">
                            {m.media_bulk_usage_checking({ count: assets.length })}
                        </p>
                    ) : usageErrorIds.size > 0 ? (
                        <div
                            data-media-bulk-delete-usage="unavailable"
                            className="rounded-md bg-state-attention/10 px-3 py-2 text-sm text-state-attention">
                            {m.media_bulk_delete_unavailable({ count: usageErrorIds.size })}
                        </div>
                    ) : blockedAssets.length > 0 ? (
                        <div
                            data-media-bulk-delete-usage="blocked"
                            className="rounded-md bg-state-attention/10 px-3 py-2 text-sm text-state-attention">
                            <p>{m.media_bulk_delete_blocked({ count: blockedAssets.length })}</p>
                            <ul className="mt-2 space-y-1 text-xs">
                                {blockedAssets.slice(0, 4).map(asset => (
                                    <li key={asset.asset.id} className="truncate">
                                        {asset.asset.originalFilename}
                                    </li>
                                ))}
                            </ul>
                            {blockedAssets.length > 4 ? (
                                <p className="mt-1 text-xs">
                                    {m.media_bulk_delete_more_blocked({
                                        count: blockedAssets.length - 4,
                                    })}
                                </p>
                            ) : null}
                            <p className="mt-2 text-xs">{m.media_bulk_delete_remove_blocked()}</p>
                        </div>
                    ) : null}

                    {error !== null ? (
                        <p
                            role="alert"
                            data-media-bulk-delete-error="true"
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
                    <Button
                        type="button"
                        variant="destructive"
                        data-media-bulk-delete-confirm="true"
                        disabled={!canDelete || pending}
                        onClick={onConfirm}>
                        <TrashBinMinimalisticIcon aria-hidden="true" />
                        {pending ? m.media_bulk_delete_pending() : m.media_delete_confirm()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
