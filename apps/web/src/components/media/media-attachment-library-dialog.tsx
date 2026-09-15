import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { GalleryAddIcon } from '@solar-icons/react/bold/gallery-add'
import { UploadIcon } from '@solar-icons/react/bold/upload'
import type { RefObject } from 'react'

import {
    MediaAssetCollection,
    mediaLibraryGridClass,
} from '@/components/media/media-asset-collection'
import { MediaLibraryToolbar } from '@/components/media/media-library-toolbar'
import type {
    MediaListDateFilter,
    MediaListFamilyFilter,
    MediaListSort,
    MediaReference,
} from '@/lib/api'
import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

interface MediaAttachmentLibraryDialogProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly projectId: string
    readonly assets: readonly MediaReference[]
    readonly selectedAssetById: ReadonlyMap<string, MediaSelection>
    readonly loading: boolean
    readonly loadingMore: boolean
    readonly nextCursor: string | null
    readonly interactionDisabled: boolean
    readonly error: string | null
    readonly emptyDescription?: string
    readonly uploading: string | null
    readonly searchQuery: string
    readonly searchPending: boolean
    readonly mediaDateFilter: MediaListDateFilter
    readonly mediaFamilyFilter: MediaListFamilyFilter
    readonly mediaSort: MediaListSort
    readonly mediaViewMode: MediaLibraryViewMode
    readonly totalAssets: number
    readonly scrollRef: RefObject<HTMLDivElement | null>
    readonly loadMoreSentinelRef: RefObject<HTMLDivElement | null>
    readonly onUpload: () => void
    readonly onLoadMore: () => void | Promise<void>
    readonly onToggle: (asset: MediaReference) => void
    readonly onConfirm: () => void
    readonly onSearchQueryChange: (query: string) => void
    readonly onDateChange: (value: MediaListDateFilter) => void
    readonly onFamilyChange: (value: MediaListFamilyFilter) => void
    readonly onSortChange: (value: MediaListSort) => void
    readonly onViewModeChange: (value: MediaLibraryViewMode) => void
}

export function MediaAttachmentLibraryDialog({
    open,
    onOpenChange,
    projectId,
    assets,
    selectedAssetById,
    loading,
    loadingMore,
    nextCursor,
    interactionDisabled,
    error,
    emptyDescription,
    uploading,
    searchQuery,
    searchPending,
    mediaDateFilter,
    mediaFamilyFilter,
    mediaSort,
    mediaViewMode,
    totalAssets,
    scrollRef,
    loadMoreSentinelRef,
    onUpload,
    onLoadMore,
    onToggle,
    onConfirm,
    onSearchQueryChange,
    onDateChange,
    onFamilyChange,
    onSortChange,
    onViewModeChange,
}: MediaAttachmentLibraryDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-media-library="true"
                data-media-picker-mode="attach"
                className="flex max-h-[min(44rem,calc(100vh-2rem))] flex-col overflow-hidden sm:max-w-3xl">
                <DialogHeader>
                    <div className="flex items-start justify-between gap-4 pr-8">
                        <div className="min-w-0">
                            <DialogTitle>{m.media_title()}</DialogTitle>
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={interactionDisabled}
                            onClick={onUpload}>
                            <UploadIcon aria-hidden="true" />
                            {uploading === null
                                ? m.media_upload_image()
                                : m.media_uploading({ filename: uploading })}
                        </Button>
                    </div>
                </DialogHeader>

                <MediaLibraryToolbar
                    assetCount={assets.length}
                    bulkSelectionMode={false}
                    className="shrink-0"
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
                    projectId={`${projectId}-attachment`}
                    searchPending={searchPending}
                    searchQuery={searchQuery}
                    showSelectionMode={false}
                    totalAssets={totalAssets}
                />

                {error !== null ? (
                    <Alert variant="destructive" className="rounded-md">
                        <AlertTitle>{m.media_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                <div
                    ref={scrollRef}
                    data-media-attachment-scroll="true"
                    className="-mr-5 min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 pr-5">
                    {loading ? (
                        <p className="text-sm text-muted-foreground">{m.media_loading()}</p>
                    ) : assets.length === 0 ? (
                        <Empty className="min-h-40 bg-surface-field px-4 py-5">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <GalleryAddIcon aria-hidden="true" />
                                </EmptyMedia>
                                <EmptyTitle>{m.media_empty_title()}</EmptyTitle>
                                <EmptyDescription>
                                    {emptyDescription ?? m.media_empty_here()}
                                </EmptyDescription>
                            </EmptyHeader>
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={interactionDisabled}
                                onClick={onUpload}>
                                <UploadIcon aria-hidden="true" />
                                {m.media_upload_image()}
                            </Button>
                        </Empty>
                    ) : (
                        <>
                            <MediaAssetCollection
                                assets={assets}
                                className={mediaLibraryGridClass(mediaViewMode)}
                                interactionDisabled={interactionDisabled}
                                layout={mediaViewMode}
                                onToggle={onToggle}
                                projectId={projectId}
                                selectable
                                selectedAssetById={selectedAssetById}
                                showActions={false}
                                showAccessibilityText={false}
                                viewMode={mediaViewMode}
                            />
                            {nextCursor !== null ? (
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
                    )}
                </div>

                <DialogFooter className="shrink-0">
                    <Button type="button" variant="secondary" onClick={onConfirm}>
                        {m.common_done()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
