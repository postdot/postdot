import { Alert, AlertDescription } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { AltArrowLeftIcon } from '@solar-icons/react/bold/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CameraRotateIcon } from '@solar-icons/react/bold/camera-rotate'
import { CropMinimalisticIcon } from '@solar-icons/react/bold/crop-minimalistic'
import { GalleryEditIcon } from '@solar-icons/react/bold/gallery-edit'
import { RefreshCircleIcon } from '@solar-icons/react/bold/refresh-circle'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useEffect, useMemo, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

import 'react-easy-crop/react-easy-crop.css'

type EditorAspect = 'source' | 'square' | 'portrait' | 'landscape'

interface MediaImageViewerDialogProps {
    readonly assets?: readonly MediaReference[]
    readonly asset: MediaReference | null
    readonly allowDelete?: boolean
    readonly open: boolean
    readonly onAssetChange: (asset: MediaReference) => void
    readonly onOpenChange: (open: boolean) => void
    readonly onEdit: (asset: MediaReference) => void
    readonly onRequestDelete?: (asset: MediaReference) => void
}

export function MediaImageViewerDialog({
    assets = [],
    asset,
    allowDelete = false,
    open,
    onAssetChange,
    onOpenChange,
    onEdit,
    onRequestDelete,
}: MediaImageViewerDialogProps) {
    useLanguage()

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

    if (currentAsset === null) return null

    const representation = readyRepresentation(currentAsset)
    const image = representation?.family === 'image'
    const hasNavigation = gallery.length > 1
    const hasPrevious = assetIndex > 0
    const hasNext = assetIndex < gallery.length - 1

    function move(offset: -1 | 1) {
        const nextAsset = gallery[assetIndex + offset]
        if (nextAsset !== undefined) onAssetChange(nextAsset)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
                data-media-viewer="true"
                className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-6xl">
                <DialogHeader className="border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4">
                    <div className="flex min-w-0 items-baseline gap-3 pr-8">
                        <DialogTitle className="min-w-0 truncate">
                            {currentAsset.asset.originalFilename}
                        </DialogTitle>
                        {hasNavigation ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {m.media_viewer_position({
                                    current: assetIndex + 1,
                                    total: gallery.length,
                                })}
                            </span>
                        ) : null}
                    </div>
                    <DialogDescription className="sr-only">
                        {m.media_viewer_description()}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 gap-3 bg-surface-canvas p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4 sm:p-5">
                    <div className="min-w-0">
                        <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-md bg-background">
                            {image ? (
                                <img
                                    src={api.mediaContentUrl(
                                        currentAsset.asset.projectId,
                                        currentAsset.asset.id
                                    )}
                                    alt={
                                        currentAsset.asset.defaultAccessibilityText ??
                                        currentAsset.asset.originalFilename
                                    }
                                    className="max-h-[min(62vh,42rem)] max-w-full object-contain"
                                />
                            ) : (
                                <MediaPreview
                                    projectId={currentAsset.asset.projectId}
                                    asset={currentAsset}
                                    representation={representation}
                                    className="flex size-48 items-center justify-center bg-surface-field text-sm font-medium uppercase text-muted-foreground"
                                />
                            )}
                        </div>
                        {hasNavigation ? (
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon-lg"
                                    disabled={!hasPrevious}
                                    aria-label={m.media_viewer_previous()}
                                    data-media-viewer-previous="true"
                                    className="shadow-control"
                                    onClick={() => move(-1)}>
                                    <AltArrowLeftIcon aria-hidden="true" />
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                    {m.media_viewer_position({
                                        current: assetIndex + 1,
                                        total: gallery.length,
                                    })}
                                </span>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon-lg"
                                    disabled={!hasNext}
                                    aria-label={m.media_viewer_next()}
                                    data-media-viewer-next="true"
                                    className="shadow-control"
                                    onClick={() => move(1)}>
                                    <AltArrowRightIcon aria-hidden="true" />
                                </Button>
                            </div>
                        ) : null}
                    </div>
                    {hasNavigation ? (
                        <div
                            aria-label={m.media_viewer_thumbnails()}
                            data-media-viewer-thumbnails="true"
                            className="flex max-h-24 min-w-0 gap-2 overflow-x-auto sm:max-h-[min(62vh,42rem)] sm:w-20 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto">
                            {gallery.map(candidate => {
                                const candidateRepresentation = readyRepresentation(candidate)
                                const isCurrent = candidate.asset.id === currentAsset.asset.id
                                return (
                                    <button
                                        key={candidate.asset.id}
                                        type="button"
                                        aria-label={m.media_open_asset({
                                            filename: candidate.asset.originalFilename,
                                        })}
                                        aria-current={isCurrent ? 'true' : undefined}
                                        data-media-viewer-thumbnail="true"
                                        className={`size-16 shrink-0 overflow-hidden rounded-md bg-surface-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:size-20 ${isCurrent ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                                        onClick={() => onAssetChange(candidate)}>
                                        <MediaPreview
                                            projectId={candidate.asset.projectId}
                                            asset={candidate}
                                            representation={candidateRepresentation}
                                            className="size-full rounded-md object-cover"
                                        />
                                    </button>
                                )
                            })}
                        </div>
                    ) : null}
                </div>
                <div className="flex justify-end border-t border-border/60 bg-muted px-4 py-3 sm:px-6">
                    <div className="flex shrink-0 justify-end gap-1">
                        {allowDelete ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-state-failed hover:bg-state-failed/10 hover:text-state-failed"
                                onClick={() => onRequestDelete?.(currentAsset)}>
                                <TrashBinMinimalisticIcon aria-hidden="true" />
                                {m.media_delete_confirm()}
                            </Button>
                        ) : null}
                        {image ? (
                            <Button type="button" onClick={() => onEdit(currentAsset)}>
                                <GalleryEditIcon aria-hidden="true" />
                                {m.media_edit_image()}
                            </Button>
                        ) : null}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

interface MediaImageEditorDialogProps {
    readonly asset: MediaReference | null
    readonly open: boolean
    readonly saving: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSave: (file: File) => Promise<void>
}

export function MediaImageEditorDialog({
    asset,
    open,
    saving,
    onOpenChange,
    onSave,
}: MediaImageEditorDialogProps) {
    useLanguage()
    const [crop, setCrop] = useState({ x: 0, y: 0 })
    const [zoom, setZoom] = useState(1)
    const [rotation, setRotation] = useState(0)
    const [aspectMode, setAspectMode] = useState<EditorAspect>('source')
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
    const [error, setError] = useState<string | null>(null)

    const representation = asset === null ? undefined : readyRepresentation(asset)
    const sourceAspect =
        representation?.width !== null &&
        representation?.width !== undefined &&
        representation.height !== null &&
        representation.height !== undefined &&
        representation.height > 0
            ? representation.width / representation.height
            : 1
    const aspect = useMemo(
        () => aspectForMode(aspectMode, sourceAspect),
        [aspectMode, sourceAspect]
    )

    useEffect(() => {
        if (!open) return
        setCrop({ x: 0, y: 0 })
        setZoom(1)
        setRotation(0)
        setAspectMode('source')
        setCroppedAreaPixels(null)
        setError(null)
    }, [asset?.asset.id, open])

    if (asset === null || representation?.family !== 'image') return null

    const editorAsset = asset
    const editorRepresentation = representation
    const imageSrc = api.mediaContentUrl(editorAsset.asset.projectId, editorAsset.asset.id)

    async function save() {
        if (croppedAreaPixels === null) return
        setError(null)
        try {
            const edited = await createEditedImage({
                imageSrc,
                crop: croppedAreaPixels,
                rotation,
                contentType:
                    editorRepresentation.detectedContentType ??
                    editorRepresentation.declaredContentType ??
                    '',
                originalFilename: editorAsset.asset.originalFilename,
            })
            await onSave(edited)
        } catch {
            setError(m.media_editor_failed())
        }
    }

    function rotateBy(degrees: -90 | 90) {
        setRotation(current => normalizeRotation(current + degrees))
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
                className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
                <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
                    <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
                        <CropMinimalisticIcon aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{asset.asset.originalFilename}</span>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {m.media_editor_description()}
                    </DialogDescription>
                </DialogHeader>

                <div className="relative h-[min(58vh,34rem)] min-h-64 bg-surface-canvas">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        rotation={rotation}
                        aspect={aspect}
                        minZoom={1}
                        maxZoom={3}
                        zoomSpeed={0.1}
                        cropShape="rect"
                        objectFit="contain"
                        showGrid
                        zoomWithScroll
                        roundCropAreaPixels
                        keyboardStep={1}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onRotationChange={setRotation}
                        onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
                        classes={{
                            containerClassName: 'bg-surface-canvas',
                            cropAreaClassName: 'border-2 border-primary',
                        }}
                    />
                </div>

                <div className="grid gap-4 border-t border-border/60 bg-muted px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                        <label className="flex min-w-52 flex-1 items-center gap-3 text-sm">
                            <span className="shrink-0 font-medium">{m.media_editor_zoom()}</span>
                            <input
                                aria-label={m.media_editor_zoom()}
                                className="min-w-0 flex-1 accent-primary"
                                type="range"
                                min="1"
                                max="3"
                                step="0.05"
                                value={zoom}
                                onChange={event => setZoom(Number(event.target.value))}
                            />
                            <span className="w-10 text-right text-xs text-muted-foreground">
                                {zoom.toFixed(1)}×
                            </span>
                        </label>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{m.media_editor_rotation()}</span>
                            <Button
                                type="button"
                                variant="secondary"
                                size="icon-sm"
                                aria-label={m.media_editor_rotate_left()}
                                onClick={() => rotateBy(-90)}>
                                <CameraRotateIcon aria-hidden="true" />
                            </Button>
                            <span className="w-10 text-center text-xs text-muted-foreground">
                                {rotation}°
                            </span>
                            <Button
                                type="button"
                                variant="secondary"
                                size="icon-sm"
                                aria-label={m.media_editor_rotate_right()}
                                onClick={() => rotateBy(90)}>
                                <CameraRotateIcon aria-hidden="true" className="rotate-180" />
                            </Button>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setCrop({ x: 0, y: 0 })
                                setZoom(1)
                                setRotation(0)
                                setAspectMode('source')
                            }}>
                            <RefreshCircleIcon aria-hidden="true" />
                            {m.media_editor_reset()}
                        </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-sm font-medium">{m.media_editor_aspect()}</span>
                        {(
                            [
                                ['source', m.media_editor_aspect_source()],
                                ['square', m.media_editor_aspect_square()],
                                ['portrait', m.media_editor_aspect_portrait()],
                                ['landscape', m.media_editor_aspect_landscape()],
                            ] as const
                        ).map(([value, label]) => (
                            <Button
                                key={value}
                                type="button"
                                variant={aspectMode === value ? 'secondary' : 'ghost'}
                                size="sm"
                                aria-pressed={aspectMode === value}
                                onClick={() => setAspectMode(value)}>
                                {label}
                            </Button>
                        ))}
                    </div>

                    {error !== null ? (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}

                    <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => onOpenChange(false)}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            type="button"
                            disabled={saving || croppedAreaPixels === null}
                            onClick={() => void save()}>
                            <GalleryEditIcon aria-hidden="true" />
                            {saving ? m.media_editor_saving() : m.media_editor_save()}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function createEditedFilename(originalFilename: string, contentType: string) {
    const base = originalFilename.replace(/\.[^.]+$/, '') || 'media'
    const extension = contentType === 'image/jpeg' ? 'jpg' : 'png'
    return `${base}-edited.${extension}`
}

function aspectForMode(mode: EditorAspect, sourceAspect: number) {
    switch (mode) {
        case 'square':
            return 1
        case 'portrait':
            return 4 / 5
        case 'landscape':
            return 16 / 9
        case 'source':
        default:
            return sourceAspect
    }
}

function normalizeRotation(rotation: number) {
    return ((rotation % 360) + 360) % 360
}

async function createEditedImage({
    imageSrc,
    crop,
    rotation,
    contentType,
    originalFilename,
}: {
    readonly imageSrc: string
    readonly crop: Area
    readonly rotation: number
    readonly contentType: string
    readonly originalFilename: string
}) {
    const response = await fetch(imageSrc, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`media_editor_source_${response.status}`)

    const sourceBlob = await response.blob()
    const sourceUrl = URL.createObjectURL(sourceBlob)
    try {
        const image = await loadImage(sourceUrl)
        const rotated = document.createElement('canvas')
        const rotatedSize = rotateSize(image.width, image.height, rotation)
        rotated.width = rotatedSize.width
        rotated.height = rotatedSize.height

        const rotatedContext = rotated.getContext('2d')
        if (rotatedContext === null) throw new Error('media_editor_canvas_unavailable')
        rotatedContext.translate(rotatedSize.width / 2, rotatedSize.height / 2)
        rotatedContext.rotate((rotation * Math.PI) / 180)
        rotatedContext.translate(-image.width / 2, -image.height / 2)
        rotatedContext.drawImage(image, 0, 0)

        const cropped = document.createElement('canvas')
        cropped.width = crop.width
        cropped.height = crop.height
        const croppedContext = cropped.getContext('2d')
        if (croppedContext === null) throw new Error('media_editor_canvas_unavailable')
        croppedContext.drawImage(
            rotated,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height
        )

        const outputType = contentType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
        const blob = await canvasToBlob(cropped, outputType)
        return new File([blob], createEditedFilename(originalFilename, blob.type), {
            type: blob.type,
            lastModified: Date.now(),
        })
    } finally {
        URL.revokeObjectURL(sourceUrl)
    }
}

function loadImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('media_editor_source_unreadable'))
        image.src = source
    })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            blob => {
                if (blob === null) {
                    reject(new Error('media_editor_export_failed'))
                    return
                }
                resolve(blob)
            },
            type,
            0.92
        )
    })
}

function rotateSize(width: number, height: number, rotation: number) {
    const angle = (rotation * Math.PI) / 180
    return {
        width: Math.abs(Math.cos(angle) * width) + Math.abs(Math.sin(angle) * height),
        height: Math.abs(Math.sin(angle) * width) + Math.abs(Math.cos(angle) * height),
    }
}
