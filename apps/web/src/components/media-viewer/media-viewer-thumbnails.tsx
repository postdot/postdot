import type { MotionValue } from 'motion/react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
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

const minThumbSize = 56
const maxThumbSize = 80
const followerMargin = 4

const thumbnailSpringConfig = {
    stiffness: 200,
    damping: 20,
    mass: 0.1,
}

const followerSpringConfig = {
    stiffness: 200,
    damping: 15,
    mass: 0.1,
}

export function MediaViewerThumbnails({
    assets,
    activeIndex,
    onAssetChange,
}: MediaViewerThumbnailsProps) {
    useLanguage()

    const dockRef = useRef<HTMLDivElement>(null)
    const mouseX = useMotionValue(Number.POSITIVE_INFINITY)
    const thumbContainerRef = useRef<HTMLDivElement>(null)
    const thumbGroupRef = useRef<HTMLDivElement>(null)
    const [dragConstraints, setDragConstraints] = useState<DragConstraints>({
        left: 0,
        right: 0,
    })
    const [followed, setFollowed] = useState<HTMLButtonElement | null>(null)
    const followerSpring = {
        width: useSpring(0, followerSpringConfig),
        height: useSpring(0, followerSpringConfig),
        left: useSpring(0, followerSpringConfig),
        bottom: useSpring(0, followerSpringConfig),
    }

    const updateDragConstraints = useCallback(() => {
        const thumbGroup = thumbGroupRef.current
        const thumbContainer = thumbContainerRef.current
        if (thumbGroup === null || thumbContainer === null) return

        const groupWidth = thumbGroup.getBoundingClientRect().width
        const containerWidth = thumbContainer.getBoundingClientRect().width
        const next =
            groupWidth < containerWidth
                ? { left: 0, right: 0 }
                : { left: -groupWidth / 2, right: groupWidth / 2 }

        setDragConstraints(current =>
            current.left === next.left && current.right === next.right ? current : next
        )
    }, [])

    useEffect(() => {
        updateDragConstraints()
        window.addEventListener('resize', updateDragConstraints)
        return () => window.removeEventListener('resize', updateDragConstraints)
    }, [updateDragConstraints])

    useEffect(() => {
        updateDragConstraints()
    }, [assets.length, updateDragConstraints])

    useEffect(() => {
        const thumbGroup = thumbGroupRef.current
        if (thumbGroup === null) {
            setFollowed(null)
            return
        }

        const thumbnails = thumbGroup.querySelectorAll<HTMLButtonElement>(
            '[data-media-viewer-thumbnail="true"]'
        )
        setFollowed(thumbnails[activeIndex] ?? null)
    }, [activeIndex, assets.length])

    useEffect(() => {
        const thumbGroup = thumbGroupRef.current
        if (followed === null || thumbGroup === null) return

        const updateFollower = () => {
            const group = thumbGroupRef.current
            if (group === null) return

            const { width, height, left, bottom } = followed.getBoundingClientRect()
            const containerRect = group.getBoundingClientRect()
            followerSpring.width.set(width + followerMargin * 2)
            followerSpring.height.set(height + followerMargin * 2)
            followerSpring.left.set(left - containerRect.left - followerMargin)
            followerSpring.bottom.set(bottom - containerRect.bottom - followerMargin)
        }

        const resizeObserver = new ResizeObserver(updateFollower)
        resizeObserver.observe(thumbGroup)
        resizeObserver.observe(followed)

        const mutationObserver = new MutationObserver(updateFollower)
        mutationObserver.observe(thumbGroup, { childList: true, subtree: true })

        updateFollower()

        return () => {
            resizeObserver.disconnect()
            mutationObserver.disconnect()
        }
    }, [
        followed,
        followerSpring.bottom,
        followerSpring.height,
        followerSpring.left,
        followerSpring.width,
    ])

    return (
        <motion.div
            ref={dockRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="group"
            aria-label={m.media_viewer_thumbnails()}
            data-media-viewer-thumbnails="true"
            className="h-20 w-full shrink-0 bg-background/20 backdrop-blur-md"
            onMouseMove={event => mouseX.set(event.pageX)}
            onMouseLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}>
            <motion.div
                ref={thumbContainerRef}
                data-media-viewer-thumbnail-track="true"
                className="relative flex h-20 w-full touch-pan-y justify-center"
                drag="x"
                dragConstraints={dragConstraints}
                dragElastic={1}
                whileTap={{ cursor: 'grabbing' }}>
                <div
                    ref={thumbGroupRef}
                    className="absolute bottom-3 flex min-w-min items-end gap-3">
                    <motion.div
                        className="pointer-events-none absolute z-0 rounded-lg border-2 border-border/40 bg-surface-raised/50"
                        style={{ ...followerSpring }}
                    />
                    {assets.map((asset, index) => (
                        <DockThumbnail
                            key={asset.asset.id}
                            asset={asset}
                            active={index === activeIndex}
                            mouseX={mouseX}
                            onAssetChange={onAssetChange}
                        />
                    ))}
                </div>
            </motion.div>
        </motion.div>
    )
}

function DockThumbnail({
    asset,
    active,
    mouseX,
    onAssetChange,
}: {
    readonly asset: MediaReference
    readonly active: boolean
    readonly mouseX: MotionValue<number>
    readonly onAssetChange: (asset: MediaReference) => void
}) {
    const thumbRef = useRef<HTMLButtonElement>(null)
    const distance = useTransform(mouseX, value => {
        const bounds = thumbRef.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
        return value - bounds.x - bounds.width / 2
    })
    const widthTransform = useTransform(
        distance,
        [-minThumbSize * 2, 0, minThumbSize * 2],
        [minThumbSize, maxThumbSize, minThumbSize]
    )
    const size = useSpring(widthTransform, thumbnailSpringConfig)
    const representation = readyRepresentation(asset)

    return (
        <motion.button
            ref={thumbRef}
            type="button"
            dragPropagation
            aria-label={m.media_open_asset({ filename: asset.asset.originalFilename })}
            aria-current={active ? 'true' : undefined}
            data-media-viewer-thumbnail="true"
            style={{ height: size, width: size }}
            className={`relative m-0 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-surface-raised p-0 shadow-field transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'brightness-[1.12] saturate-100' : 'brightness-90 saturate-[0.9] hover:brightness-[1.10] hover:saturate-100'}`}
            onClick={() => onAssetChange(asset)}>
            <MediaPreview
                projectId={asset.asset.projectId}
                asset={asset}
                representation={representation}
                className="size-full rounded-md object-cover"
            />
        </motion.button>
    )
}
