import { Button } from '@postdot/ui/components/button'
import { DangerTriangleIcon } from '@solar-icons/react/linear/danger-triangle'
import { useId, useState } from 'react'

import type { MediaReference } from '@/lib/api'
import { type MediaFailureReason, mediaFailureReason } from '@/lib/media-errors'
import * as m from '@/paraglide/messages.js'

const MAX_VISIBLE_FAILED_UPLOADS = 3

export interface MediaFailedUploadsNoticeProps {
    readonly assets: readonly MediaReference[]
    readonly disabled?: boolean
    readonly removingAssetIds?: ReadonlySet<string>
    readonly onRemove?: (asset: MediaReference) => void
}

export function MediaFailedUploadsNotice({
    assets,
    disabled = false,
    removingAssetIds,
    onRemove,
}: MediaFailedUploadsNoticeProps) {
    const headingId = useId()
    const [expanded, setExpanded] = useState(false)

    if (assets.length === 0) return null

    const hasOverflow = assets.length > MAX_VISIBLE_FAILED_UPLOADS
    const visibleAssets =
        expanded || !hasOverflow ? assets : assets.slice(0, MAX_VISIBLE_FAILED_UPLOADS)
    const hiddenCount = assets.length - MAX_VISIBLE_FAILED_UPLOADS

    return (
        <section
            aria-labelledby={headingId}
            data-media-failed-uploads-notice="true"
            className="rounded-lg border border-border bg-surface-raised">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <DangerTriangleIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-state-failed"
                />
                <h2 id={headingId} className="text-sm font-medium text-foreground">
                    {m.media_failed_uploads_title({ count: assets.length })}
                </h2>
            </div>

            <ul className="divide-y divide-border">
                {visibleAssets.map(asset => {
                    const reason = mediaFailureReason(asset)
                    const removing = removingAssetIds?.has(asset.asset.id) ?? false
                    return (
                        <li
                            key={asset.asset.id}
                            data-media-failed-upload-item={asset.asset.id}
                            className="flex min-w-0 items-center justify-between gap-3 px-4 py-2">
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:gap-2">
                                <span className="max-w-full truncate font-medium text-foreground">
                                    {asset.asset.originalFilename}
                                </span>
                                <span
                                    data-media-failed-reason={reason}
                                    className="text-xs text-muted-foreground">
                                    {mediaFailureReasonLabel(reason)}
                                </span>
                            </div>
                            {onRemove !== undefined ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                    disabled={disabled || removing}
                                    data-media-failed-remove="true"
                                    aria-label={m.media_remove({
                                        filename: asset.asset.originalFilename,
                                    })}
                                    onClick={() => onRemove(asset)}>
                                    {m.common_remove()}
                                </Button>
                            ) : null}
                        </li>
                    )
                })}
            </ul>

            {hasOverflow ? (
                <div className="border-t border-border px-2 py-1.5">
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        data-media-failed-toggle="true"
                        aria-expanded={expanded}
                        onClick={() => setExpanded(current => !current)}>
                        {expanded
                            ? m.media_failed_uploads_show_less()
                            : m.media_failed_uploads_show_more({ count: hiddenCount })}
                    </Button>
                </div>
            ) : null}
        </section>
    )
}

function mediaFailureReasonLabel(reason: MediaFailureReason): string {
    switch (reason) {
        case 'unsupported_format':
            return m.media_failed_reason_unsupported_format()
        case 'file_too_large':
            return m.media_failed_reason_file_too_large()
        case 'upload_expired':
            return m.media_failed_reason_upload_expired()
        case 'upload_incomplete':
            return m.media_failed_reason_upload_incomplete()
        case 'file_missing':
            return m.media_failed_reason_file_missing()
        case 'generic':
            return m.media_failed_reason_generic()
    }
}
