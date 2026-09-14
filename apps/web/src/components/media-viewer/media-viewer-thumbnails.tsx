import {
    animate,
    motion,
    useMotionValue,
    useReducedMotion,
    useSpring,
    useTransform,
} from 'motion/react'
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

interface DragConstraints {
    readonly left: number
    readonly right: number
}

interface ThumbnailDrag {
    readonly pointerId: number
    readonly startTrackX: number
    readonly startX: number
    moved: boolean
}

const minThumbSize = 56
const maxThumbSize = 80
const dockRadius = 112
const dragThreshold = 4

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
    const dragRef = useRef<ThumbnailDrag | null>(null)
    const isDraggingRef = useRef(false)
    const suppressClickRef = useRef(false)
    const trackX = useMotionValue(0)
    const mouseX = useMotionValue(Number.POSITIVE_INFINITY)
    const [dragConstraints, setDragConstraints] = useState<DragConstraints>({
        left: 0,
        right: 0,
    })
    const [isDragging, setIsDragging] = useState(false)

    const updateDragConstraints = useCallback(() => {
        const viewport = viewportRef.current
        const track = trackRef.current
        if (viewport === null || track === null) return

        const overflow = Math.max(0, track.scrollWidth - viewport.clientWidth)
        const next = { left: -overflow, right: 0 }
        setDragConstraints(current =>
            current.left === next.left && current.right === next.right ? current : next
        )

        const currentX = trackX.get()
        const clampedX = Math.max(next.left, Math.min(next.right, currentX))
        if (clampedX !== currentX) trackX.set(clampedX)
    }, [trackX])

    useEffect(() => {
        updateDragConstraints()
        if (typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(updateDragConstraints)
        if (viewportRef.current !== null) observer.observe(viewportRef.current)
        if (trackRef.current !== null) observer.observe(trackRef.current)
        return () => observer.disconnect()
    }, [assets.length, updateDragConstraints])

    useEffect(() => {
        let animation: ReturnType<typeof animate> | undefined
        const frame = window.requestAnimationFrame(() => {
            if (isDraggingRef.current) return
            const viewport = viewportRef.current
            const activeThumb = activeThumbRef.current
            if (viewport === null || activeThumb === null) return

            const viewportBounds = viewport.getBoundingClientRect()
            const thumbBounds = activeThumb.getBoundingClientRect()
            const offset =
                viewportBounds.left +
                viewportBounds.width / 2 -
                (thumbBounds.left + thumbBounds.width / 2)
            const currentX = trackX.get()
            const nextX = Math.max(
                dragConstraints.left,
                Math.min(dragConstraints.right, currentX + offset)
            )

            if (reduceMotion) {
                trackX.set(nextX)
            } else {
                animation = animate(trackX, nextX, {
                    type: 'spring',
                    stiffness: 360,
                    damping: 32,
                })
            }
        })

        return () => {
            window.cancelAnimationFrame(frame)
            animation?.stop()
        }
    }, [activeIndex, dragConstraints, reduceMotion, trackX])

    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (dragConstraints.left === dragConstraints.right) return

        dragRef.current = {
            pointerId: event.pointerId,
            startTrackX: trackX.get(),
            startX: event.clientX,
            moved: false,
        }
        isDraggingRef.current = true
        setIsDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        mouseX.set(event.clientX)
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return

        const delta = event.clientX - drag.startX
        if (!drag.moved && Math.abs(delta) < dragThreshold) return
        drag.moved = true
        suppressClickRef.current = true
        event.preventDefault()

        const nextX = Math.max(
            dragConstraints.left,
            Math.min(dragConstraints.right, drag.startTrackX + delta)
        )
        trackX.set(nextX)
    }

    function finishPointerDrag(event: React.PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        dragRef.current = null
        isDraggingRef.current = false
        setIsDragging(false)
        mouseX.set(event.clientX)

        if (drag.moved) {
            window.setTimeout(() => {
                suppressClickRef.current = false
            }, 0)
        }
    }

    return (
        <div className="h-[6.25rem] shrink-0 bg-surface-inset/95 px-3 pt-2 pb-3 backdrop-blur-md sm:px-5">
            <div
                ref={viewportRef}
                role="group"
                aria-label={m.media_viewer_thumbnails()}
                data-media-viewer-thumbnails="true"
                className="h-20 touch-pan-y overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerDrag}
                onPointerCancel={finishPointerDrag}
                onPointerLeave={() => {
                    if (!isDraggingRef.current) mouseX.set(Number.POSITIVE_INFINITY)
                }}>
                <motion.div
                    ref={trackRef}
                    data-media-viewer-thumbnail-track="true"
                    style={{
                        cursor: isDragging
                            ? 'grabbing'
                            : dragConstraints.left < 0
                              ? 'grab'
                              : 'default',
                        x: trackX,
                    }}
                    className="relative mx-auto flex h-20 w-max shrink-0 items-end gap-3">
                    {assets.map((asset, index) => (
                        <div
                            key={asset.asset.id}
                            className="relative flex size-20 shrink-0 items-end justify-center">
                            <DockThumbnail
                                asset={asset}
                                active={index === activeIndex}
                                activeRef={index === activeIndex ? activeThumbRef : undefined}
                                mouseX={mouseX}
                                reduceMotion={reduceMotion}
                                suppressClickRef={suppressClickRef}
                                onAssetChange={onAssetChange}
                            />
                        </div>
                    ))}
                </motion.div>
            </div>
        </div>
    )
}

function DockThumbnail({
    asset,
    active,
    activeRef,
    mouseX,
    reduceMotion,
    suppressClickRef,
    onAssetChange,
}: {
    readonly asset: MediaReference
    readonly active: boolean
    readonly activeRef?: React.RefObject<HTMLButtonElement | null>
    readonly mouseX: ReturnType<typeof useMotionValue<number>>
    readonly reduceMotion: boolean | null
    readonly suppressClickRef: React.RefObject<boolean>
    readonly onAssetChange: (asset: MediaReference) => void
}) {
    const thumbRef = useRef<HTMLButtonElement>(null)
    const distance = useTransform(mouseX, value => {
        const bounds = thumbRef.current?.getBoundingClientRect()
        if (bounds === undefined || !Number.isFinite(value)) return dockRadius
        return Math.abs(value - (bounds.left + bounds.width / 2))
    })
    const size = useSpring(useTransform(distance, [0, dockRadius], [maxThumbSize, minThumbSize]), {
        stiffness: 220,
        damping: 18,
        mass: 0.12,
    })
    const indicatorSize = useTransform(size, value => value + 8)
    const indicatorLeft = useTransform(size, value => (maxThumbSize - (value + 8)) / 2)
    const representation = readyRepresentation(asset)

    return (
        <>
            {active ? (
                <motion.span
                    layoutId="media-viewer-active-thumbnail"
                    style={{
                        bottom: 0,
                        height: indicatorSize,
                        left: indicatorLeft,
                        width: indicatorSize,
                    }}
                    className="pointer-events-none absolute z-0 rounded-lg border border-primary/60 bg-primary/10"
                    transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                />
            ) : null}
            <motion.button
                ref={node => {
                    thumbRef.current = node
                    if (activeRef !== undefined) activeRef.current = node
                }}
                type="button"
                aria-label={m.media_open_asset({ filename: asset.asset.originalFilename })}
                aria-current={active ? 'true' : undefined}
                data-media-viewer-thumbnail="true"
                style={{ height: size, width: size }}
                whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                className={`relative origin-bottom overflow-hidden rounded-md bg-surface-raised p-0 shadow-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'z-20' : 'z-10 opacity-75 hover:z-20 hover:opacity-100'}`}
                onClick={event => {
                    if (suppressClickRef.current) {
                        event.preventDefault()
                        event.stopPropagation()
                        suppressClickRef.current = false
                        return
                    }
                    onAssetChange(asset)
                }}>
                <MediaPreview
                    projectId={asset.asset.projectId}
                    asset={asset}
                    representation={representation}
                    className="size-full rounded-md object-cover"
                />
            </motion.button>
        </>
    )
}
