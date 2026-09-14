import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface MediaViewerThumbnailsProps {
    readonly assets: readonly MediaReference[]
    readonly activeIndex: number
    readonly onAssetChange: (asset: MediaReference) => void
}

export function MediaViewerThumbnails({
    assets,
    activeIndex,
    onAssetChange,
}: MediaViewerThumbnailsProps) {
    useLanguage()

    const reduceMotion = useReducedMotion()
    const viewportRef = useRef<HTMLDivElement>(null)
    const trackRef = useRef<HTMLDivElement>(null)
    const activeThumbRef = useRef<HTMLButtonElement>(null)
    const trackX = useMotionValue(0)
    const [dragConstraints, setDragConstraints] = useState({ left: 0, right: 0 })

    const updateDragConstraints = useCallback(() => {
        const viewport = viewportRef.current
        const track = trackRef.current
        if (viewport === null || track === null) return

        const overflow = Math.max(0, track.scrollWidth - viewport.clientWidth)
        setDragConstraints(current => {
            const next = { left: -overflow, right: 0 }
            return current.left === next.left && current.right === next.right ? current : next
        })
    }, [])

    useEffect(() => {
        updateDragConstraints()
        if (typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(updateDragConstraints)
        if (viewportRef.current !== null) observer.observe(viewportRef.current)
        if (trackRef.current !== null) observer.observe(trackRef.current)
        return () => observer.disconnect()
    }, [assets.length, updateDragConstraints])

    useEffect(() => {
        const viewport = viewportRef.current
        const activeThumb = activeThumbRef.current
        if (viewport === null || activeThumb === null) return

        const viewportBounds = viewport.getBoundingClientRect()
        const thumbBounds = activeThumb.getBoundingClientRect()
        const offset =
            viewportBounds.left +
            viewportBounds.width / 2 -
            (thumbBounds.left + thumbBounds.width / 2)
        const nextX = Math.min(
            dragConstraints.right,
            Math.max(dragConstraints.left, trackX.get() + offset)
        )
        const controls = animate(trackX, nextX, {
            type: 'spring',
            stiffness: 300,
            damping: 30,
        })
        return () => controls.stop()
    }, [activeIndex, dragConstraints, trackX])

    return (
        <div className="shrink-0 bg-surface-inset/95 px-3 pt-2 pb-3 backdrop-blur-md sm:px-5">
            <div
                ref={viewportRef}
                role="group"
                aria-label={m.media_viewer_thumbnails()}
                data-media-viewer-thumbnails="true"
                className="overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <motion.div
                    ref={trackRef}
                    drag="x"
                    dragConstraints={dragConstraints}
                    dragElastic={0.12}
                    style={{ x: trackX }}
                    whileTap={{ cursor: 'grabbing' }}
                    className="mx-auto flex w-max items-end gap-2 py-1 cursor-grab">
                    {assets.map((asset, index) => {
                        const isActive = index === activeIndex
                        return (
                            <motion.button
                                key={asset.asset.id}
                                ref={isActive ? activeThumbRef : undefined}
                                type="button"
                                aria-label={m.media_open_asset({
                                    filename: asset.asset.originalFilename,
                                })}
                                aria-current={isActive ? 'true' : undefined}
                                data-media-viewer-thumbnail="true"
                                whileHover={reduceMotion ? undefined : { scale: 1.06, zIndex: 2 }}
                                whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                                className={`size-14 shrink-0 overflow-hidden rounded-md bg-surface-field p-0 shadow-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:size-16 ${isActive ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                                onClick={() => onAssetChange(asset)}>
                                <MediaPreview
                                    projectId={asset.asset.projectId}
                                    asset={asset}
                                    representation={readyRepresentation(asset)}
                                    className="size-full rounded-md object-cover"
                                />
                            </motion.button>
                        )
                    })}
                </motion.div>
            </div>
        </div>
    )
}
