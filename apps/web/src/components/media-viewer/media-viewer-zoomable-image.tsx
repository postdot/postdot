import { Button } from '@postdot/ui/components/button'
import { ButtonGroupText } from '@postdot/ui/components/button-group'
import { Kbd } from '@postdot/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postdot/ui/components/tooltip'
import { MagnifierZoomInIcon } from '@solar-icons/react/linear/magnifier-zoom-in'
import { MagnifierZoomOutIcon } from '@solar-icons/react/linear/magnifier-zoom-out'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
    TransformComponent,
    TransformWrapper,
    type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'

import * as m from '@/paraglide/messages.js'

import { MEDIA_VIEWER_SHORTCUTS } from './use-media-viewer-keyboard'

const minScale = 1
const maxScale = 3
const zoomStep = 0.5
const wheelStep = 0.15
const edgeThreshold = 2

const noPanEdges = {
    bottom: false,
    left: false,
    right: false,
    top: false,
} as const

type TransformControls = Pick<ReactZoomPanPinchRef, 'resetTransform' | 'zoomIn' | 'zoomOut'>

export interface MediaViewerZoomControlsHandle {
    readonly reset: () => Promise<void>
    readonly zoomIn: () => Promise<void>
    readonly zoomOut: () => Promise<void>
}

export interface MediaViewerZoomStatus {
    readonly panEdges: {
        readonly bottom: boolean
        readonly left: boolean
        readonly right: boolean
        readonly top: boolean
    }
    readonly scalePercent: number
}

interface MediaViewerZoomableImageProps {
    readonly alt: string
    readonly onZoomStatusChange: (status: MediaViewerZoomStatus) => void
    readonly reduceMotion: boolean | null
    readonly src: string
}

export const MediaViewerZoomableImage = forwardRef<
    MediaViewerZoomControlsHandle,
    MediaViewerZoomableImageProps
>(function MediaViewerZoomableImage({ alt, onZoomStatusChange, reduceMotion, src }, ref) {
    const controlsRef = useRef<TransformControls | null>(null)
    const [scalePercent, setScalePercent] = useState(100)
    const [panEdges, setPanEdges] = useState<MediaViewerZoomStatus['panEdges']>(noPanEdges)
    const motionReduced = reduceMotion === true
    const animationTime = motionReduced ? 0 : 180

    useImperativeHandle(
        ref,
        () => ({
            reset: () => controlsRef.current?.resetTransform(animationTime) ?? Promise.resolve(),
            zoomIn: () => controlsRef.current?.zoomIn(zoomStep, animationTime) ?? Promise.resolve(),
            zoomOut: () =>
                controlsRef.current?.zoomOut(zoomStep, animationTime) ?? Promise.resolve(),
        }),
        [animationTime]
    )

    useEffect(() => {
        onZoomStatusChange({ panEdges, scalePercent })
    }, [onZoomStatusChange, panEdges, scalePercent])

    const handleTransform = useCallback(
        (
            ref: ReactZoomPanPinchRef,
            { positionX, positionY, scale }: { positionX: number; positionY: number; scale: number }
        ) => {
            const nextScalePercent = Math.round(scale * 100)
            setScalePercent(current => (current === nextScalePercent ? current : nextScalePercent))

            if (scale <= minScale + 0.01 || ref.instance.bounds === null) {
                setPanEdges(current => (current === noPanEdges ? current : noPanEdges))
                return
            }

            const bounds = ref.instance.bounds
            const canPanX = bounds.maxPositionX - bounds.minPositionX > edgeThreshold
            const canPanY = bounds.maxPositionY - bounds.minPositionY > edgeThreshold
            const nextPanEdges = {
                bottom: canPanY && positionY <= bounds.minPositionY + edgeThreshold,
                left: canPanX && positionX >= bounds.maxPositionX - edgeThreshold,
                right: canPanX && positionX <= bounds.minPositionX + edgeThreshold,
                top: canPanY && positionY >= bounds.maxPositionY - edgeThreshold,
            }

            setPanEdges(current => {
                if (
                    current.bottom === nextPanEdges.bottom &&
                    current.left === nextPanEdges.left &&
                    current.right === nextPanEdges.right &&
                    current.top === nextPanEdges.top
                ) {
                    return current
                }
                return nextPanEdges
            })
        },
        []
    )

    return (
        <TransformWrapper
            initialScale={minScale}
            minScale={minScale}
            maxScale={maxScale}
            centerOnInit
            centerZoomedOut
            disablePadding
            smooth={false}
            wheel={{ step: wheelStep, touchPadDisabled: false }}
            pinch={{ step: 5, allowPanning: true }}
            panning={{
                disabled: scalePercent <= 100,
                velocityDisabled: true,
            }}
            doubleClick={{
                mode: 'toggle',
                step: 0.8,
                animationTime,
            }}
            keyboard={{ disabled: true }}
            zoomAnimation={{ disabled: motionReduced, animationTime }}
            velocityAnimation={{ disabled: true }}
            onTransform={handleTransform}>
            {({ resetTransform, zoomIn, zoomOut }) => {
                controlsRef.current = { resetTransform, zoomIn, zoomOut }

                return (
                    <div className="relative size-full">
                        <TransformComponent
                            wrapperClass={`!size-full ${scalePercent > 100 ? '!cursor-grab active:!cursor-grabbing' : '!cursor-default'}`}
                            contentClass="!flex !size-full !items-center !justify-center"
                            wrapperStyle={{
                                height: '100%',
                                touchAction: 'none',
                                width: '100%',
                            }}
                            contentStyle={{
                                height: '100%',
                                width: '100%',
                            }}>
                            <img
                                src={src}
                                alt={alt}
                                draggable={false}
                                loading="eager"
                                className="size-full max-h-full max-w-full select-none object-contain"
                            />
                        </TransformComponent>

                        <MediaViewerPanEdgeIndicators
                            edges={panEdges}
                            reduceMotion={motionReduced}
                        />
                    </div>
                )
            }}
        </TransformWrapper>
    )
})

export function MediaViewerZoomControls({
    onReset,
    onZoomIn,
    onZoomOut,
    scalePercent,
}: {
    readonly onReset: () => void
    readonly onZoomIn: () => void
    readonly onZoomOut: () => void
    readonly scalePercent: number
}) {
    const isAtMinimum = scalePercent <= minScale * 100
    const isAtMaximum = scalePercent >= maxScale * 100

    return (
        <>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            disabled={isAtMinimum}
                            data-media-viewer-zoom-out="true"
                            aria-label={m.media_viewer_zoom_out()}
                            aria-keyshortcuts={MEDIA_VIEWER_SHORTCUTS.zoomOut}
                            className="bg-surface-overlay text-foreground shadow-field hover:bg-surface-field"
                            onClick={onZoomOut}>
                            <MagnifierZoomOutIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <TooltipContent>
                    <span>{m.media_viewer_zoom_out()}</span>
                    <Kbd aria-hidden="true">{MEDIA_VIEWER_SHORTCUTS.zoomOut}</Kbd>
                </TooltipContent>
            </Tooltip>
            <ButtonGroupText
                aria-live="polite"
                aria-atomic="true"
                className="h-7 min-w-12 justify-center border-0 bg-transparent px-2 text-xs leading-none tabular-nums text-foreground shadow-none">
                {scalePercent}%
            </ButtonGroupText>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            disabled={isAtMaximum}
                            data-media-viewer-zoom-in="true"
                            aria-label={m.media_viewer_zoom_in()}
                            aria-keyshortcuts={MEDIA_VIEWER_SHORTCUTS.zoomInAria}
                            className="bg-surface-overlay text-foreground shadow-field hover:bg-surface-field"
                            onClick={onZoomIn}>
                            <MagnifierZoomInIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <TooltipContent>
                    <span>{m.media_viewer_zoom_in()}</span>
                    <Kbd aria-hidden="true">{MEDIA_VIEWER_SHORTCUTS.zoomIn}</Kbd>
                </TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isAtMinimum}
                            data-media-viewer-zoom-reset="true"
                            aria-label={m.media_viewer_zoom_reset()}
                            aria-keyshortcuts={MEDIA_VIEWER_SHORTCUTS.zoomReset}
                            className="bg-surface-overlay px-2 text-xs text-foreground shadow-field hover:bg-surface-field"
                            onClick={onReset}>
                            <span aria-hidden="true">{m.media_viewer_zoom_reset_short()}</span>
                        </Button>
                    }
                />
                <TooltipContent>
                    <span>{m.media_viewer_zoom_reset()}</span>
                    <Kbd aria-hidden="true">{MEDIA_VIEWER_SHORTCUTS.zoomReset}</Kbd>
                </TooltipContent>
            </Tooltip>
        </>
    )
}

function MediaViewerPanEdgeIndicators({
    edges,
    reduceMotion,
}: {
    readonly edges: MediaViewerZoomStatus['panEdges']
    readonly reduceMotion: boolean
}) {
    const transition = reduceMotion ? { duration: 0 } : { duration: 0.16 }

    return (
        <AnimatePresence initial={false}>
            {edges.left ? (
                <motion.span
                    key="left"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={transition}
                    className="pointer-events-none absolute inset-y-0 left-0 z-20 w-5 bg-gradient-to-r from-foreground/15 to-transparent"
                />
            ) : null}
            {edges.right ? (
                <motion.span
                    key="right"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={transition}
                    className="pointer-events-none absolute inset-y-0 right-0 z-20 w-5 bg-gradient-to-l from-foreground/15 to-transparent"
                />
            ) : null}
            {edges.top ? (
                <motion.span
                    key="top"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={transition}
                    className="pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-gradient-to-b from-foreground/15 to-transparent"
                />
            ) : null}
            {edges.bottom ? (
                <motion.span
                    key="bottom"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={transition}
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-gradient-to-t from-foreground/15 to-transparent"
                />
            ) : null}
        </AnimatePresence>
    )
}
