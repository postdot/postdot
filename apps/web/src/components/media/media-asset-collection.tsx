import { MediaAssetCard, type MediaAssetCardLayout } from '@/components/media-asset-card'
import type { MediaReference } from '@/lib/api'
import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import type { MediaSelection } from '@/lib/target-media'

interface MediaAssetCollectionProps {
    readonly assets: readonly MediaReference[]
    readonly projectId: string
    readonly interactionDisabled: boolean
    readonly layout: MediaAssetCardLayout
    readonly className?: string
    readonly viewMode?: MediaLibraryViewMode
    readonly selectedAssetById?: ReadonlyMap<string, MediaSelection>
    readonly selectable?: boolean
    readonly showAccessibilityText?: boolean
    readonly showActions?: boolean
    readonly actionSelectionEnabled?: boolean
    readonly actionSelectedAssetIds?: ReadonlySet<string>
    readonly onAccessibilityTextChange?: (assetId: string, text: string) => void
    readonly onActionSelectionToggle?: (asset: MediaReference) => void
    readonly onDownload?: (asset: MediaReference) => void
    readonly onEdit?: (asset: MediaReference) => void
    readonly onInfo?: (asset: MediaReference) => void
    readonly onOpen?: (asset: MediaReference) => void
    readonly onRequestDelete?: (asset: MediaReference) => void
    readonly onToggle: (asset: MediaReference) => void
    readonly onPreview?: (asset: MediaReference) => void
    readonly previewUrl?: (asset: MediaReference) => string | undefined
}

export function MediaAssetCollection({
    assets,
    projectId,
    interactionDisabled,
    layout,
    className,
    viewMode,
    selectedAssetById,
    selectable = true,
    showAccessibilityText = true,
    showActions = true,
    actionSelectionEnabled = false,
    actionSelectedAssetIds,
    onAccessibilityTextChange,
    onActionSelectionToggle,
    onDownload,
    onEdit,
    onInfo,
    onOpen,
    onRequestDelete,
    onToggle,
    onPreview,
    previewUrl,
}: MediaAssetCollectionProps) {
    return (
        <div data-media-library-view={viewMode} className={`grid gap-3 ${className ?? ''}`}>
            {assets.map(asset => (
                <MediaAssetCard
                    key={asset.asset.id}
                    asset={asset}
                    interactionDisabled={interactionDisabled}
                    layout={layout}
                    projectId={projectId}
                    selected={selectedAssetById?.get(asset.asset.id)}
                    selectable={selectable}
                    showAccessibilityText={showAccessibilityText}
                    showActions={showActions}
                    actionSelectionEnabled={actionSelectionEnabled}
                    actionSelected={actionSelectedAssetIds?.has(asset.asset.id)}
                    onAccessibilityTextChange={onAccessibilityTextChange}
                    onActionSelectionToggle={onActionSelectionToggle}
                    onDownload={onDownload}
                    onEdit={onEdit}
                    onInfo={onInfo}
                    onOpen={onOpen}
                    onRequestDelete={onRequestDelete}
                    onToggle={onToggle}
                    onPreview={onPreview}
                    previewUrl={previewUrl?.(asset)}
                />
            ))}
        </div>
    )
}

export function mediaLibraryGridClass(viewMode: MediaLibraryViewMode) {
    switch (viewMode) {
        case 'compact':
            return 'grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))]'
        case 'list':
            return 'grid-cols-1'
        case 'grid':
        default:
            return 'grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]'
    }
}
