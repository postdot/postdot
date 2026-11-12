import type { ComponentProps } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'

import type { ProviderDefinition } from '../contract'

type Props = ComponentProps<NonNullable<ProviderDefinition['preview']['Media']>>

export function BlueskyLinkMediaPreview({ media, mediaSelections, target, renderFallback }: Props) {
    const external = target?.external
    const card =
        external && typeof external === 'object' && !Array.isArray(external)
            ? (external as Record<string, unknown>)
            : undefined
    if (
        !card ||
        typeof card.uri !== 'string' ||
        typeof card.title !== 'string' ||
        typeof card.description !== 'string'
    )
        return renderFallback()
    let url: URL
    try {
        url = new URL(card.uri)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            return renderFallback()
    } catch {
        return renderFallback()
    }
    const image = media.length === 1 ? media[0] : undefined
    return (
        <div
            data-bluesky-link-card
            className="mt-3 overflow-hidden rounded-md border border-border">
            {image ? (
                <MediaPreview
                    projectId={image.asset.projectId}
                    asset={image}
                    representation={readyRepresentation(image)}
                    alt={
                        mediaSelections?.find(item => item.assetId === image.asset.id)
                            ?.accessibilityText ??
                        image.asset.defaultAccessibilityText ??
                        ''
                    }
                    className="h-auto max-h-64 w-full object-contain"
                />
            ) : null}
            <div className="min-w-0 space-y-1 p-3">
                <p className="break-words text-sm font-semibold">{card.title}</p>
                <p className="line-clamp-3 break-words text-sm text-muted-foreground">
                    {card.description}
                </p>
                <p className="truncate text-xs text-muted-foreground">{url.hostname}</p>
            </div>
        </div>
    )
}
