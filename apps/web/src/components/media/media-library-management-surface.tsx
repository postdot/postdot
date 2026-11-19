import { Alert, AlertDescription, AlertTitle } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { FolderOpenIcon } from '@solar-icons/react/linear/folder-open'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import type { RefObject } from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import { EmptyState } from '@/components/empty-state'
import type {
    MediaListDateFilter,
    MediaListFamilyFilter,
    MediaListSort,
    MediaReference,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

import { MediaAssetCollection, mediaLibraryGridClass } from './media-asset-collection'
import { MediaFailedUploadsNotice } from './media-failed-uploads-notice'
import { MediaLibrarySkeleton } from './media-library-skeleton'
import { MediaLibraryToolbar, type MediaLibraryFeatureOptions } from './media-library-toolbar'

export interface MediaLibraryManagementSurfaceProps {
    readonly projectId: string
    readonly assets: readonly MediaReference[]
    readonly failedAssets?: readonly MediaReference[]
    readonly removingFailedAssetIds?: ReadonlySet<string>
    readonly restorableAssetIds: ReadonlySet<string>
    readonly selectedAssetById: ReadonlyMap<string, MediaSelection>
    readonly loading: boolean
    readonly loadingMore: boolean
    readonly nextCursor: string | null
    readonly loadMoreSentinelRef: RefObject<HTMLDivElement | null>
    readonly interactionDisabled: boolean
    readonly error: string | null
    readonly emptyDescription?: string
    readonly bulkSelectionResolutionPending: boolean
    readonly bulkSelectedAssetIds: ReadonlySet<string>
    readonly bulkSelectedCount: number
    readonly allVisibleBulkSelected: boolean
    readonly visibleReadyAssetCount: number
    readonly searchQuery: string
    readonly searchPending: boolean
    readonly mediaDateFilter: MediaListDateFilter
    readonly mediaFamilyFilter: MediaListFamilyFilter
    readonly mediaSort: MediaListSort
    readonly mediaViewMode: MediaLibraryViewMode
    readonly totalAssets: number
    readonly trashCount: number
    readonly retentionMs: number
    readonly view: 'library' | 'trash'
    readonly statusMessage: string | null
    readonly canManageLibrary: boolean
    readonly libraryFeatures?: MediaLibraryFeatureOptions
    readonly onLoadMore: () => void | Promise<void>
    readonly onSearchQueryChange: (query: string) => void
    readonly onDateChange: (value: MediaListDateFilter) => void
    readonly onFamilyChange: (value: MediaListFamilyFilter) => void
    readonly onSortChange: (value: MediaListSort) => void
    readonly onViewModeChange: (value: MediaLibraryViewMode) => void
    readonly onOpenSelected: () => void
    readonly onOpenBulkDeletion: () => void
    readonly onClearBulkSelection: () => void
    readonly onToggleVisibleBulkSelection?: () => void
    readonly onToggleBulkAsset?: (asset: MediaReference) => void
    readonly onAccessibilityTextChange: (assetId: string, text: string) => void
    readonly onDownload?: (asset: MediaReference) => void
    readonly onEdit?: (asset: MediaReference) => void
    readonly onInfo?: (asset: MediaReference) => void
    readonly onOpenAsset?: (asset: MediaReference) => void
    readonly onRemoveFailedAsset?: (asset: MediaReference) => void
    readonly onRequestDelete?: (asset: MediaReference) => void
    readonly onPermanentlyDelete?: (asset: MediaReference) => void
    readonly onToggleAsset: (asset: MediaReference) => void
    readonly onViewChange: (view: 'library' | 'trash') => void
    readonly onRestore?: (asset: MediaReference) => void
}

export function MediaLibraryManagementSurface({
    projectId,
    assets,
    failedAssets = [],
    removingFailedAssetIds,
    restorableAssetIds,
    selectedAssetById,
    loading,
    loadingMore,
    nextCursor,
    loadMoreSentinelRef,
    interactionDisabled,
    error,
    emptyDescription,
    bulkSelectionResolutionPending,
    bulkSelectedAssetIds,
    bulkSelectedCount,
    allVisibleBulkSelected,
    visibleReadyAssetCount,
    searchQuery,
    searchPending,
    mediaDateFilter,
    mediaFamilyFilter,
    mediaSort,
    mediaViewMode,
    totalAssets,
    trashCount,
    retentionMs,
    view,
    statusMessage,
    canManageLibrary,
    libraryFeatures,
    onLoadMore,
    onSearchQueryChange,
    onDateChange,
    onFamilyChange,
    onSortChange,
    onViewModeChange,
    onOpenSelected,
    onOpenBulkDeletion,
    onClearBulkSelection,
    onToggleVisibleBulkSelection,
    onToggleBulkAsset,
    onAccessibilityTextChange,
    onDownload,
    onEdit,
    onInfo,
    onOpenAsset,
    onRemoveFailedAsset,
    onRequestDelete,
    onPermanentlyDelete,
    onRestore,
    onViewChange,
    onToggleAsset,
}: MediaLibraryManagementSurfaceProps) {
    const { locale } = useLanguage()
    const hasActiveLibraryQuery =
        searchQuery.trim() !== '' ||
        mediaFamilyFilter !== 'all' ||
        mediaDateFilter !== 'all' ||
        mediaSort !== 'newest'
    const hasActiveQuery = view === 'library' ? hasActiveLibraryQuery : searchQuery.trim() !== ''
    const showToolbar = totalAssets >= 2 || hasActiveQuery

    const trashButton =
        view === 'library' && canManageLibrary ? (
            <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shadow-none"
                disabled={interactionDisabled}
                data-media-trash-open="true"
                onClick={() => onViewChange('trash')}>
                <TrashBinMinimalisticIcon aria-hidden="true" />
                {m.media_trash_open()}
                {trashCount > 0 ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                        {formatNumber(trashCount, locale)}
                    </span>
                ) : null}
            </Button>
        ) : undefined

    return (
        <>
            {view === 'trash' ? (
                <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium">{m.media_trash_heading()}</h2>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0 shadow-none"
                        disabled={interactionDisabled}
                        onClick={() => onViewChange('library')}>
                        <AltArrowLeftIcon aria-hidden="true" />
                        {m.media_trash_back()}
                    </Button>
                </div>
            ) : null}

            {showToolbar ? (
                <MediaLibraryToolbar
                    assetCount={assets.length}
                    interactionDisabled={interactionDisabled}
                    mediaDateFilter={mediaDateFilter}
                    mediaFamilyFilter={mediaFamilyFilter}
                    mediaSort={mediaSort}
                    mediaViewMode={mediaViewMode}
                    onDateChange={onDateChange}
                    onFamilyChange={onFamilyChange}
                    onSearchQueryChange={onSearchQueryChange}
                    onSortChange={onSortChange}
                    onViewModeChange={onViewModeChange}
                    projectId={projectId}
                    searchPending={searchPending}
                    searchQuery={searchQuery}
                    features={
                        view === 'trash'
                            ? { ...libraryFeatures, filters: false, viewModes: false }
                            : libraryFeatures
                    }
                    navigationAction={trashButton}
                    totalAssets={totalAssets}
                />
            ) : view === 'library' && trashCount > 0 && trashButton !== undefined ? (
                <div className="flex justify-end">{trashButton}</div>
            ) : null}

            {statusMessage !== null ? (
                <p role="status" className="mt-3 text-sm text-muted-foreground">
                    {statusMessage}
                </p>
            ) : null}

            {canManageLibrary && view === 'library' && bulkSelectedCount > 0 ? (
                <div
                    className="fixed bottom-5 left-1/2 z-40 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2"
                    data-media-selection-bar="true">
                    <BulkActionBar
                        actions={[
                            {
                                id: 'open',
                                label: m.media_bulk_open_action(),
                                icon: <FolderOpenIcon aria-hidden="true" />,
                                variant: 'secondary',
                                disabled: bulkSelectionResolutionPending,
                                onSelect: onOpenSelected,
                            },
                            {
                                id: 'delete',
                                label: m.media_bulk_delete_action(),
                                icon: <TrashBinMinimalisticIcon aria-hidden="true" />,
                                variant: 'destructive',
                                disabled: bulkSelectionResolutionPending,
                                onSelect: onOpenBulkDeletion,
                            },
                        ]}
                        allSelected={allVisibleBulkSelected}
                        ariaLabel={m.media_bulk_actions()}
                        clearLabel={m.media_bulk_clear_selection()}
                        onClear={onClearBulkSelection}
                        onToggleAll={
                            visibleReadyAssetCount > 0 ? onToggleVisibleBulkSelection : undefined
                        }
                        selectedCount={bulkSelectedCount}
                        selectionSummary={m.media_bulk_selected({ count: bulkSelectedCount })}
                        toggleAllLabel={
                            visibleReadyAssetCount > 0 ? m.media_bulk_select_visible() : undefined
                        }
                    />
                </div>
            ) : null}

            {error !== null ? (
                <Alert variant="destructive" className="mt-4 rounded-md">
                    <AlertTitle>{m.media_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            {view === 'library' && failedAssets.length > 0 ? (
                <MediaFailedUploadsNotice
                    assets={failedAssets}
                    disabled={interactionDisabled}
                    removingAssetIds={removingFailedAssetIds}
                    onRemove={onRemoveFailedAsset}
                />
            ) : null}

            {loading && assets.length === 0 && failedAssets.length === 0 ? (
                <MediaLibrarySkeleton viewMode={mediaViewMode} />
            ) : assets.length === 0 && nextCursor === null ? (
                hasActiveQuery ? (
                    <EmptyState
                        className="mt-4"
                        description={null}
                        illustration="result"
                        illustrationClassName="w-32"
                        title={m.media_no_results()}
                    />
                ) : (
                    <EmptyState
                        className="mt-6"
                        description={view === 'trash' ? null : (emptyDescription ?? null)}
                        icon={
                            view === 'trash' ? (
                                <TrashBinMinimalisticIcon aria-hidden="true" />
                            ) : undefined
                        }
                        illustration={view === 'library' ? 'image' : undefined}
                        title={
                            view === 'trash' ? m.media_trash_empty_title() : m.media_empty_title()
                        }
                    />
                )
            ) : assets.length > 0 ? (
                <MediaAssetCollection
                    assets={assets}
                    restorableAssetIds={restorableAssetIds}
                    className={mediaLibraryGridClass(mediaViewMode)}
                    interactionDisabled={interactionDisabled}
                    layout={mediaViewMode}
                    retentionMs={view === 'trash' ? retentionMs : undefined}
                    onAccessibilityTextChange={onAccessibilityTextChange}
                    onActionSelectionToggle={onToggleBulkAsset}
                    onDownload={view === 'library' ? onDownload : undefined}
                    onEdit={view === 'library' ? onEdit : undefined}
                    onInfo={view === 'library' ? onInfo : undefined}
                    onOpen={view === 'library' ? onOpenAsset : undefined}
                    onPreview={onOpenAsset}
                    onRequestDelete={view === 'library' ? onRequestDelete : undefined}
                    onPermanentlyDelete={view === 'trash' ? onPermanentlyDelete : undefined}
                    onRestore={view === 'trash' ? onRestore : undefined}
                    onToggle={onToggleAsset}
                    projectId={projectId}
                    selectable={false}
                    selectedAssetById={selectedAssetById}
                    actionSelectedAssetIds={bulkSelectedAssetIds}
                    actionSelectionEnabled={canManageLibrary && view === 'library'}
                    showActions
                    viewMode={mediaViewMode}
                />
            ) : null}

            {!loading && (assets.length > 0 || failedAssets.length > 0) && nextCursor !== null ? (
                <div ref={loadMoreSentinelRef} className="mt-4 flex justify-center">
                    <Button
                        type="button"
                        className="shadow-none"
                        variant="outline"
                        disabled={interactionDisabled || loadingMore}
                        data-media-load-more="true"
                        onClick={() => void onLoadMore()}>
                        {loadingMore ? m.media_loading_more() : m.media_load_more()}
                    </Button>
                </div>
            ) : null}
        </>
    )
}
