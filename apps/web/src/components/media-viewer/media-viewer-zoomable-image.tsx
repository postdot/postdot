import { Button } from '@herald/ui/components/button'
import { ButtonGroup, ButtonGroupText } from '@herald/ui/components/button-group'
import { MagnifierZoomInIcon } from '@solar-icons/react/linear/magnifier-zoom-in'
import { MagnifierZoomOutIcon } from '@solar-icons/react/linear/magnifier-zoom-out'
import { useCallback, useState } from 'react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'

import * as m from '@/paraglide/messages.js'

interface MediaViewerZoomableImageProps {
    readonly alt: string
    readonly onZoomedChange: (zoomed: boolean) => void
    readonly reduceMotion: boolean | null
    readonly src: string
}

const minScale = 1
const maxScale = 3
const zoomStep = 0.5

export function MediaViewerZoomableImage({
    alt,
    onZoomedChange,
    reduceMotion,
    src,
}: MediaViewerZoomableImageProps) {
    const [scalePercent, setScalePercent] = useState(100)
    const motionReduced = reduceMotion === true
    const animationTime = motionReduced ? 0 : 180

    const handleTransform = useCallback(
        (_: unknown, { scale }: { scale: number }) => {
            const nextScalePercent = Math.round(scale * 100)
            setScalePercent(current => (current === nextScalePercent ? current : nextScalePercent))
            onZoomedChange(scale > minScale + 0.01)
        },
        [onZoomedChange]
    )

    return (
        <TransformWrapper
            initialScale={minScale}
            minScale={minScale}
            maxScale={maxScale}
            centerOnInit
            centerZoomedOut
            disablePadding
            wheel={{ step: 0.12, touchPadDisabled: false }}
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
            {({ resetTransform, zoomIn, zoomOut }) => (
                <div className="relative size-full">
                    <TransformComponent
                        wrapperClass="!size-full"
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

                    <MediaViewerZoomControls
                        scalePercent={scalePercent}
                        onReset={() => void resetTransform(animationTime)}
                        onZoomIn={() => void zoomIn(zoomStep, animationTime)}
                        onZoomOut={() => void zoomOut(zoomStep, animationTime)}
                    />
                </div>
            )}
        </TransformWrapper>
    )
}

function MediaViewerZoomControls({
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
        <div
            className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 flex justify-start sm:inset-x-4"
            onClick={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}>
            <ButtonGroup className="rounded-md bg-surface-raised/95 p-0.5 shadow-overlay">
                <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    disabled={isAtMinimum}
                    data-media-viewer-zoom-out="true"
                    aria-label={m.media_viewer_zoom_out()}
                    title={m.media_viewer_zoom_out()}
                    className="bg-surface-overlay text-foreground shadow-field hover:bg-surface-field"
                    onClick={onZoomOut}>
                    <MagnifierZoomOutIcon aria-hidden="true" />
                </Button>
                <ButtonGroupText className="min-w-12 justify-center border-0 bg-surface-raised px-2 text-xs tabular-nums text-foreground shadow-none">
                    {scalePercent}%
                </ButtonGroupText>
                <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    disabled={isAtMaximum}
                    data-media-viewer-zoom-in="true"
                    aria-label={m.media_viewer_zoom_in()}
                    title={m.media_viewer_zoom_in()}
                    className="bg-surface-overlay text-foreground shadow-field hover:bg-surface-field"
                    onClick={onZoomIn}>
                    <MagnifierZoomInIcon aria-hidden="true" />
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isAtMinimum}
                    data-media-viewer-zoom-reset="true"
                    aria-label={m.media_viewer_zoom_reset()}
                    title={m.media_viewer_zoom_reset()}
                    className="bg-surface-overlay px-2 text-xs text-foreground shadow-field hover:bg-surface-field"
                    onClick={onReset}>
                    <span aria-hidden="true">{m.media_viewer_zoom_reset_short()}</span>
                </Button>
            </ButtonGroup>
        </div>
    )
}
