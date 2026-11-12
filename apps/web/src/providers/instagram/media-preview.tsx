import { Button } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { useState } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { MediaReference } from '@/lib/api'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

export function InstagramMediaPreview({
    media,
    mediaSelections,
}: {
    readonly media: readonly MediaReference[]
    readonly mediaSelections?: readonly MediaSelection[]
}) {
    const [position, setPosition] = useState(0)
    if (media.length === 0) return null
    const index = Math.min(position, media.length - 1)
    const asset = media[index]!
    const description =
        mediaSelections?.find(item => item.assetId === asset.asset.id)?.accessibilityText ??
        asset.asset.defaultAccessibilityText ??
        ''
    return (
        <div data-instagram-carousel-preview className="mt-3 min-w-0">
            <div
                data-publication-preview-media
                className="overflow-hidden rounded-md bg-surface-inset">
                <MediaPreview
                    projectId={asset.asset.projectId}
                    asset={asset}
                    representation={readyRepresentation(asset)}
                    alt={description}
                    className="flex h-auto max-h-[420px] w-full items-center justify-center object-contain"
                />
            </div>
            {media.length > 1 ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={m.media_viewer_previous()}
                        onClick={() => setPosition((index - 1 + media.length) % media.length)}>
                        <AltArrowLeftIcon aria-hidden="true" />
                    </Button>
                    <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
                        {m.media_viewer_position({ current: index + 1, total: media.length })}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={m.media_viewer_next()}
                        onClick={() => setPosition((index + 1) % media.length)}>
                        <AltArrowRightIcon aria-hidden="true" />
                    </Button>
                </div>
            ) : null}
        </div>
    )
}
