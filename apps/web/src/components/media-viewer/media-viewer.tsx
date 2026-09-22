import { Button } from '@herald/ui/components/button'
import { ButtonGroup } from '@herald/ui/components/button-group'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Kbd } from '@herald/ui/components/kbd'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@herald/ui/components/tooltip'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { FullScreenIcon } from '@solar-icons/react/linear/full-screen'
import { GalleryEditIcon } from '@solar-icons/react/linear/gallery-edit'
import { QuitFullScreenIcon } from '@solar-icons/react/linear/quit-full-screen'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { AnimatePresence, motion, type PanInfo, useReducedMotion, wrap } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FullScreen, useFullScreenHandle } from 'react-full-screen'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import { MediaViewerThumbnails } from './media-viewer-thumbnails'
import {
    MediaViewerZoomControls,
    MediaViewerZoomableImage,
    type MediaViewerZoomControlsHandle,
    type MediaViewerZoomStatus,
} from './media-viewer-zoomable-image'
import { MEDIA_VIEWER_SHORTCUTS, useMediaViewerKeyboard } from './use-media-viewer-keyboard'

const swipeConfidenceThreshold = 10_000

const defaultZoomStatus: MediaViewerZoomStatus = {
    panEdges: {
        bottom: false,
        left: false,
        right: false,
        top: false,
    },
    scalePercent: 100,
}

const imageVariants = {
    enter: (direction: number) => ({
        x: direction > 0 ? '100%' : '-100%',
        opacity: 0,
        scale: 0.96,
    }),
    center: {
        x: 0,
        opacity: 1,
        scale: 1,
    },
    exit: (direction: number) => ({
        x: direction > 0 ? '-100%' : '100%',
        opacity: 0,
        scale: 0.96,
    }),
}

export interface MediaViewerProps {
    readonly assets?: readonly MediaReference[]
    readonly asset: MediaReference | null
    readonly allowDelete?: boolean
    readonly open: boolean
    readonly onAssetChange: (asset: MediaReference) => void
    readonly onOpenChange: (open: boolean) => void
    readonly onEdit?: (asset: MediaReference) => void
    readonly onRequestDelete?: (asset: MediaReference) => void
}

export function MediaViewer({
    assets = [],
    asset,
    allowDelete = false,
    open,
    onAssetChange,
    onOpenChange,
    onEdit,
    onRequestDelete,
}: MediaViewerProps) {
    useLanguage()

    const fullScreenHandle = useFullScreenHandle()
    const reduceMotion = useReducedMotion()
    const [direction, setDirection] = useState<1 | -1>(1)
    const zoomControlsRef = useRef<MediaViewerZoomControlsHandle>(null)
    const [zoomStatus, setZoomStatus] = useState<MediaViewerZoomStatus>(defaultZoomStatus)
    const gallery = useMemo(() => {
        if (asset === null) return []
        const next = assets.length > 0 ? [...assets] : [asset]
        if (!next.some(candidate => candidate.asset.id === asset.asset.id)) next.unshift(asset)
        return next
    }, [asset, assets])
    const assetIndex = Math.max(
        0,
        gallery.findIndex(candidate => candidate.asset.id === asset?.asset.id)
    )
    const currentAsset = gallery[assetIndex] ?? asset
    const hasNavigation = gallery.length > 1

    useEffect(() => {
        if (!open && fullScreenHandle.active) void fullScreenHandle.exit()
        if (!open) setDirection(1)
    }, [fullScreenHandle, open])

    useEffect(() => {
        setZoomStatus(defaultZoomStatus)
    }, [currentAsset?.asset.id])

    const handleZoomStatusChange = useCallback((status: MediaViewerZoomStatus) => {
        setZoomStatus(current => {
            if (
                current.scalePercent === status.scalePercent &&
                current.panEdges.bottom === status.panEdges.bottom &&
                current.panEdges.left === status.panEdges.left &&
                current.panEdges.right === status.panEdges.right &&
                current.panEdges.top === status.panEdges.top
            ) {
                return current
            }
            return status
        })
    }, [])

    const move = useCallback(
        (offset: -1 | 1) => {
            if (!hasNavigation) return
            const nextIndex = wrap(0, gallery.length, assetIndex + offset)
            const nextAsset = gallery[nextIndex]
            if (nextAsset === undefined) return
            setDirection(offset)
            onAssetChange(nextAsset)
        },
        [assetIndex, gallery, hasNavigation, onAssetChange]
    )

    const selectAsset = useCallback(
        (nextAsset: MediaReference) => {
            const nextIndex = gallery.findIndex(
                candidate => candidate.asset.id === nextAsset.asset.id
            )
            if (nextIndex < 0 || nextIndex === assetIndex) return
            setDirection(nextIndex > assetIndex ? 1 : -1)
            onAssetChange(nextAsset)
        },
        [assetIndex, gallery, onAssetChange]
    )

    const currentRepresentation =
        currentAsset === null ? undefined : readyRepresentation(currentAsset)
    const isImageAsset = currentRepresentation?.family === 'image'

    useMediaViewerKeyboard(open, {
        onFullscreenToggle: handleFullscreenToggle,
        onNext: hasNavigation ? () => move(1) : undefined,
        onPrevious: hasNavigation ? () => move(-1) : undefined,
        onZoomIn: isImageAsset ? () => void zoomControlsRef.current?.zoomIn() : undefined,
        onZoomOut: isImageAsset ? () => void zoomControlsRef.current?.zoomOut() : undefined,
        onZoomReset: isImageAsset ? () => void zoomControlsRef.current?.reset() : undefined,
    })

    if (currentAsset === null) return null

    const viewerAsset = currentAsset
    const representation = currentRepresentation
    const image = isImageAsset
    const imageTransition = reduceMotion
        ? { duration: 0 }
        : {
              x: { type: 'spring' as const, stiffness: 260, damping: 30 },
              opacity: { duration: 0.2 },
              scale: { duration: 0.25 },
          }
    const position = m.media_viewer_position({
        current: assetIndex + 1,
        total: gallery.length,
    })
    const isZoomed = zoomStatus.scalePercent > 100

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen && fullScreenHandle.active) void fullScreenHandle.exit()
        onOpenChange(nextOpen)
    }

    function handleFullscreenToggle() {
        void (fullScreenHandle.active ? fullScreenHandle.exit() : fullScreenHandle.enter())
    }

    function handleEdit() {
        if (fullScreenHandle.active) void fullScreenHandle.exit()
        onEdit?.(viewerAsset)
    }

    function handleDelete() {
        if (fullScreenHandle.active) void fullScreenHandle.exit()
        onRequestDelete?.(viewerAsset)
    }

    function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
        if (!hasNavigation) return
        const swipe = Math.abs(info.offset.x) * Math.abs(info.velocity.x)
        if (swipe < swipeConfidenceThreshold) return
        move(info.offset.x < 0 ? 1 : -1)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={false}
                data-media-viewer="true"
                className="flex h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[min(82vh,52rem)] sm:max-h-[min(82vh,52rem)] sm:w-full sm:max-w-6xl">
                <TooltipProvider delay={450}>
                    <FullScreen
                        handle={fullScreenHandle}
                        className={`flex min-h-0 w-full flex-1 flex-col ${fullScreenHandle.active ? 'bg-background' : 'bg-surface-canvas'}`}>
                        <DialogHeader className="flex shrink-0 flex-row items-center gap-3 border-b border-border/60 bg-surface-inset px-4 py-3 sm:px-5">
                            <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-baseline gap-3 pr-2">
                                    <DialogTitle className="min-w-0 truncate leading-5">
                                        {currentAsset.asset.originalFilename}
                                    </DialogTitle>
                                    {hasNavigation ? (
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {position}
                                        </span>
                                    ) : null}
                                </div>
                                <DialogDescription className="sr-only">
                                    {m.media_viewer_description()}
                                </DialogDescription>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <ButtonGroup className="h-7 rounded-md bg-surface-raised/95 p-0">
                                    {image ? (
                                        <MediaViewerZoomControls
                                            scalePercent={zoomStatus.scalePercent}
                                            onReset={() => void zoomControlsRef.current?.reset()}
                                            onZoomIn={() => void zoomControlsRef.current?.zoomIn()}
                                            onZoomOut={() =>
                                                void zoomControlsRef.current?.zoomOut()
                                            }
                                        />
                                    ) : null}
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="icon-sm"
                                                    aria-label={
                                                        fullScreenHandle.active
                                                            ? m.media_viewer_exit_fullscreen()
                                                            : m.media_viewer_fullscreen()
                                                    }
                                                    aria-keyshortcuts={
                                                        MEDIA_VIEWER_SHORTCUTS.fullscreen
                                                    }
                                                    data-media-viewer-fullscreen="true"
                                                    className="bg-surface-overlay text-foreground shadow-field hover:bg-surface-field"
                                                    onClick={handleFullscreenToggle}>
                                                    {fullScreenHandle.active ? (
                                                        <QuitFullScreenIcon aria-hidden="true" />
                                                    ) : (
                                                        <FullScreenIcon aria-hidden="true" />
                                                    )}
                                                </Button>
                                            }
                                        />
                                        <TooltipContent>
                                            <span>
                                                {fullScreenHandle.active
                                                    ? m.media_viewer_exit_fullscreen()
                                                    : m.media_viewer_fullscreen()}
                                            </span>
                                            <Kbd aria-hidden="true">
                                                {MEDIA_VIEWER_SHORTCUTS.fullscreen}
                                            </Kbd>
                                        </TooltipContent>
                                    </Tooltip>
                                </ButtonGroup>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size="icon-sm"
                                                aria-label={m.common_close()}
                                                aria-keyshortcuts="Escape"
                                                data-media-viewer-close="true"
                                                className="bg-surface-overlay text-foreground shadow-field hover:bg-surface-raised"
                                                onClick={() => handleOpenChange(false)}>
                                                <CloseIcon aria-hidden="true" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        <span>{m.common_close()}</span>
                                        <Kbd aria-hidden="true">Esc</Kbd>
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        </DialogHeader>

                        <main className="flex min-h-0 flex-1 flex-col">
                            <div className="group/media-stage relative min-h-0 flex-1 overflow-hidden bg-background">
                                <AnimatePresence initial={false} custom={direction} mode="sync">
                                    <motion.div
                                        key={currentAsset.asset.id}
                                        custom={direction}
                                        variants={imageVariants}
                                        initial={reduceMotion ? false : 'enter'}
                                        animate="center"
                                        exit="exit"
                                        transition={imageTransition}
                                        drag={hasNavigation && !isZoomed ? 'x' : false}
                                        dragConstraints={{ left: 0, right: 0 }}
                                        dragElastic={1}
                                        onDragEnd={handleDragEnd}
                                        className="absolute inset-0 z-10 flex touch-pan-y items-center justify-center">
                                        {image ? (
                                            <MediaViewerZoomableImage
                                                ref={zoomControlsRef}
                                                src={api.mediaContentUrl(
                                                    currentAsset.asset.projectId,
                                                    currentAsset.asset.id
                                                )}
                                                alt={
                                                    currentAsset.asset.defaultAccessibilityText ??
                                                    currentAsset.asset.originalFilename
                                                }
                                                reduceMotion={reduceMotion}
                                                onZoomStatusChange={handleZoomStatusChange}
                                            />
                                        ) : (
                                            <MediaPreview
                                                projectId={currentAsset.asset.projectId}
                                                asset={currentAsset}
                                                representation={representation}
                                                className="flex size-48 items-center justify-center rounded-md bg-surface-field text-sm font-medium uppercase text-muted-foreground"
                                            />
                                        )}
                                    </motion.div>
                                </AnimatePresence>

                                {hasNavigation ? (
                                    <>
                                        <div className="pointer-events-none absolute inset-y-0 left-3 z-20 flex items-center opacity-0 transition-opacity duration-150 group-hover/media-stage:opacity-100 group-focus-within/media-stage:opacity-100 [@media(hover:none)]:opacity-100">
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            variant="secondary"
                                                            size="icon-lg"
                                                            aria-label={m.media_viewer_previous()}
                                                            aria-keyshortcuts={
                                                                MEDIA_VIEWER_SHORTCUTS.previous
                                                            }
                                                            data-media-viewer-previous="true"
                                                            className="pointer-events-auto bg-surface-overlay text-foreground shadow-field hover:bg-surface-raised"
                                                            onClick={() => move(-1)}>
                                                            <AltArrowLeftIcon aria-hidden="true" />
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    <span>{m.media_viewer_previous()}</span>
                                                    <Kbd aria-hidden="true" className="p-0">
                                                        <AltArrowLeftIcon
                                                            aria-hidden="true"
                                                            className="size-3"
                                                        />
                                                    </Kbd>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <div className="pointer-events-none absolute inset-y-0 right-3 z-20 flex items-center opacity-0 transition-opacity duration-150 group-hover/media-stage:opacity-100 group-focus-within/media-stage:opacity-100 [@media(hover:none)]:opacity-100">
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            variant="secondary"
                                                            size="icon-lg"
                                                            aria-label={m.media_viewer_next()}
                                                            aria-keyshortcuts={
                                                                MEDIA_VIEWER_SHORTCUTS.next
                                                            }
                                                            data-media-viewer-next="true"
                                                            className="pointer-events-auto bg-surface-overlay text-foreground shadow-field hover:bg-surface-raised"
                                                            onClick={() => move(1)}>
                                                            <AltArrowRightIcon aria-hidden="true" />
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    <span>{m.media_viewer_next()}</span>
                                                    <Kbd aria-hidden="true" className="p-0">
                                                        <AltArrowRightIcon
                                                            aria-hidden="true"
                                                            className="size-3"
                                                        />
                                                    </Kbd>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </>
                                ) : null}
                            </div>
                            {hasNavigation ? (
                                <MediaViewerThumbnails
                                    assets={gallery}
                                    activeIndex={assetIndex}
                                    onAssetChange={selectAsset}
                                />
                            ) : null}
                        </main>

                        {allowDelete || (image && onEdit !== undefined) ? (
                            <footer className="flex shrink-0 justify-end gap-1 border-t border-border/60 bg-muted px-4 py-3 sm:px-5">
                                {allowDelete ? (
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        data-media-viewer-delete="true"
                                        onClick={handleDelete}>
                                        <TrashBinMinimalisticIcon aria-hidden="true" />
                                        {m.media_delete_confirm()}
                                    </Button>
                                ) : null}
                                {image && onEdit !== undefined ? (
                                    <Button
                                        type="button"
                                        variant="default"
                                        data-media-viewer-edit="true"
                                        onClick={handleEdit}>
                                        <GalleryEditIcon aria-hidden="true" />
                                        {m.media_edit_image()}
                                    </Button>
                                ) : null}
                            </footer>
                        ) : null}
                    </FullScreen>
                </TooltipProvider>
            </DialogContent>
        </Dialog>
    )
}
