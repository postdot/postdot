import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { FolderOpenIcon } from '@solar-icons/react/linear/folder-open'
import { GalleryAddIcon } from '@solar-icons/react/linear/gallery-add'
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
import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import { formatMediaRetentionDuration } from '@/lib/media-retention'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

import { MediaAssetCollection, mediaLibraryGridClass } from './media-asset-collection'
import { MediaLibraryToolbar, type MediaLibraryFeatureOptions } from './media-library-toolbar'

export interface MediaLibraryManagementSurfaceProps {
    readonly projectId: string
    readonly assets: readonly MediaReference[]
    readonly restorableAssetIds: ReadonlySet<string>
    readonly selectedAssetById: ReadonlyMap<string, MediaSelection>
    readonly loading: boolean
    readonly loadingMore: boolean
    readonly nextCursor: string | null
    readonly loadMoreSentinelRef: RefObject<HTMLDivElement | null>
    readonly interactionDisabled: boolean
    readonly mediaWriteDisabled: boolean
    readonly error: string | null
    readonly emptyDescription?: string
    readonly uploading: string | null
    readonly dragActive: boolean
    readonly bulkSelectionMode: boolean
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
    readonly onBrowse: () => void
    readonly onLoadMore: () => void | Promise<void>
    readonly onSearchQueryChange: (query: string) => void
    readonly onDateChange: (value: MediaListDateFilter) => void
    readonly onFamilyChange: (value: MediaListFamilyFilter) => void
    readonly onSortChange: (value: MediaListSort) => void
    readonly onViewModeChange: (value: MediaLibraryViewMode) => void
    readonly onToggleSelectionMode: () => void
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
    readonly onRequestDelete?: (asset: MediaReference) => void
    readonly onToggleAsset: (asset: MediaReference) => void
    readonly onViewChange: (view: 'library' | 'trash') => void
    readonly onRestore?: (asset: MediaReference) => void
}

export function MediaLibraryManagementSurface({
    projectId,
    assets,
    restorableAssetIds,
    selectedAssetById,
    loading,
    loadingMore,
    nextCursor,
    loadMoreSentinelRef,
    interactionDisabled,
    mediaWriteDisabled,
    error,
    emptyDescription,
    uploading,
    dragActive,
    bulkSelectionMode,
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
    onBrowse,
    onLoadMore,
    onSearchQueryChange,
    onDateChange,
    onFamilyChange,
    onSortChange,
    onViewModeChange,
    onToggleSelectionMode,
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
    onRequestDelete,
    onRestore,
    onViewChange,
    onToggleAsset,
}: MediaLibraryManagementSurfaceProps) {
    return (
        <>
            <div
                role="group"
                aria-label={m.media_library_views()}
                className="mb-3 flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
                <Button
                    type="button"
                    size="sm"
                    variant={view === 'library' ? 'secondary' : 'ghost'}
                    aria-pressed={view === 'library'}
                    onClick={() => onViewChange('library')}>
                    {m.media_library_tab()}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={view === 'trash' ? 'secondary' : 'ghost'}
                    aria-pressed={view === 'trash'}
                    onClick={() => onViewChange('trash')}>
                    {m.media_trash_tab({ count: trashCount })}
                </Button>
            </div>

            <MediaLibraryToolbar
                assetCount={assets.length}
                bulkSelectionMode={bulkSelectionMode}
                interactionDisabled={interactionDisabled}
                mediaDateFilter={mediaDateFilter}
                mediaFamilyFilter={mediaFamilyFilter}
                mediaSort={mediaSort}
                mediaViewMode={mediaViewMode}
                onDateChange={onDateChange}
                onFamilyChange={onFamilyChange}
                onSearchQueryChange={onSearchQueryChange}
                onSortChange={onSortChange}
                onToggleSelectionMode={onToggleSelectionMode}
                onViewModeChange={onViewModeChange}
                projectId={projectId}
                searchPending={searchPending}
                searchQuery={searchQuery}
                features={
                    view === 'trash'
                        ? { ...libraryFeatures, filters: false, viewModes: false }
                        : libraryFeatures
                }
                showSelectionMode={canManageLibrary && view === 'library'}
                totalAssets={totalAssets}
            />

            {statusMessage !== null ? (
                <p role="status" className="mt-3 text-sm text-muted-foreground">
                    {statusMessage}
                </p>
            ) : null}

            {canManageLibrary && view === 'library' && bulkSelectionMode ? (
                <div className="sticky top-0 z-20 mt-3">
                    <BulkActionBar
                        actions={[
                            {
                                id: 'open',
                                label: m.media_bulk_open_action({ count: bulkSelectedCount }),
                                icon: <FolderOpenIcon aria-hidden="true" />,
                                variant: 'secondary',
                                disabled: bulkSelectionResolutionPending,
                                onSelect: onOpenSelected,
                            },
                            {
                                id: 'delete',
                                label: m.media_bulk_delete_action({ count: bulkSelectedCount }),
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
                            visibleReadyAssetCount > 0
                                ? allVisibleBulkSelected
                                    ? m.media_bulk_clear_visible()
                                    : m.media_bulk_select_visible()
                                : undefined
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

            {loading && assets.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{m.media_loading()}</p>
            ) : assets.length === 0 ? (
                searchQuery.trim() !== '' ? (
                    <EmptyState
                        className="mt-4 min-h-48 bg-surface-field px-4 py-6 shadow-none"
                        description={null}
                        illustration="result"
                        illustrationClassName="w-32"
                        title={m.media_no_results()}
                    />
                ) : (
                    <EmptyState
                        action={
                            view === 'library' && canManageLibrary ? (
                                <MediaDropHint
                                    active={dragActive}
                                    disabled={mediaWriteDisabled}
                                    onBrowse={onBrowse}
                                    uploading={uploading}
                                />
                            ) : undefined
                        }
                        className={`mt-2 min-h-72 flex-1 transition-colors ${
                            dragActive && view === 'library'
                                ? 'bg-primary/10'
                                : 'bg-surface-raised/70'
                        }`}
                        description={
                            view === 'trash'
                                ? retentionMs > 0
                                    ? m.media_trash_empty_description({
                                          duration: formatMediaRetentionDuration(retentionMs),
                                      })
                                    : m.media_trash_empty_immediate()
                                : (emptyDescription ?? null)
                        }
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
            ) : (
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
                    onRestore={view === 'trash' ? onRestore : undefined}
                    onToggle={onToggleAsset}
                    projectId={projectId}
                    selectable={false}
                    selectedAssetById={selectedAssetById}
                    actionSelectedAssetIds={bulkSelectedAssetIds}
                    actionSelectionEnabled={canManageLibrary && bulkSelectionMode}
                    showActions
                    viewMode={mediaViewMode}
                />
            )}

            {!loading && assets.length > 0 && nextCursor !== null ? (
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

            {canManageLibrary && view === 'library' && assets.length > 0 ? (
                <MediaDropHint
                    active={dragActive}
                    className="mt-5"
                    disabled={mediaWriteDisabled}
                    onBrowse={onBrowse}
                    uploading={uploading}
                />
            ) : null}
        </>
    )
}

export function MediaDropHint({
    active,
    className,
    disabled,
    onBrowse,
    uploading,
}: {
    readonly active: boolean
    readonly className?: string
    readonly disabled: boolean
    readonly onBrowse: () => void
    readonly uploading: string | null
}) {
    return (
        <div
            data-media-drop-hint="true"
            className={`flex w-full flex-col items-center gap-2 px-4 py-2 text-center text-sm transition-colors ${
                active ? 'rounded-lg bg-primary/10 py-4 text-primary' : 'text-muted-foreground'
            } ${className ?? ''}`}>
            <GalleryAddIcon aria-hidden="true" className={active ? 'size-8' : 'size-7'} />
            <p>
                {active ? m.media_drop_files_active() : m.media_drop_files()}{' '}
                {m.media_drop_files_hint()}{' '}
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    disabled={disabled}
                    className="h-auto p-0 align-baseline text-sm font-medium"
                    onClick={onBrowse}>
                    {uploading === null
                        ? m.media_browse_files()
                        : m.media_uploading({ filename: uploading })}
                </Button>
            </p>
            <p className="text-xs text-muted-foreground">{m.media_supported_types()}</p>
        </div>
    )
}
