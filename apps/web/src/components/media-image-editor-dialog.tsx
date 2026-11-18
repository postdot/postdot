import { Alert, AlertDescription } from '@postdot/ui/components/alert'
import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { CropMinimalisticIcon } from '@solar-icons/react/linear/crop-minimalistic'
import { GalleryEditIcon } from '@solar-icons/react/linear/gallery-edit'
import { exportCrop } from '@zriz/core/dom'
import type { Cropper as CropperApi } from '@zriz/react'
import { useEffect, useRef, useState } from 'react'

import { readyRepresentation } from '@/components/media-asset-card'
import {
    Cropper,
    CropperAngle,
    CropperAspect,
    CropperAspectItem,
    CropperDial,
    CropperFlip,
    CropperReset,
    CropperRotate,
    CropperViewport,
} from '@/components/media-cropper'
import { api, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface MediaImageEditorDialogProps {
    readonly asset: MediaReference | null
    readonly open: boolean
    readonly saving: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSave: (file: File) => Promise<void>
}

type LoadState = 'loading' | 'ready' | 'failed'

export function MediaImageEditorDialog({
    asset,
    open,
    saving,
    onOpenChange,
    onSave,
}: MediaImageEditorDialogProps) {
    useLanguage()
    const cropper = useRef<CropperApi>(null)
    const [loadState, setLoadState] = useState<LoadState>('loading')
    const [exporting, setExporting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setLoadState('loading')
        setError(null)
    }, [asset?.asset.id, open])

    const representation = asset === null ? undefined : readyRepresentation(asset)
    if (asset === null || representation?.family !== 'image') return null

    const editorAsset = asset
    const sourceType =
        representation.detectedContentType ?? representation.declaredContentType ?? ''
    const imageSrc = api.mediaContentUrl(editorAsset.asset.projectId, editorAsset.asset.id)
    const busy = saving || exporting

    async function save() {
        const current = cropper.current
        if (current === null || busy) return
        setError(null)
        setExporting(true)
        try {
            // JPEG stays JPEG (photos, and what most networks expect); everything else keeps its
            // transparency as PNG.
            const type = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
            const { blob } = await exportCrop(current, { type, quality: 0.92 })
            await onSave(
                new File(
                    [blob],
                    createEditedFilename(editorAsset.asset.originalFilename, blob.type),
                    {
                        type: blob.type,
                        lastModified: Date.now(),
                    }
                )
            )
        } catch {
            setError(m.media_editor_failed())
        } finally {
            setExporting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
                className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
                <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
                    <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
                        <CropMinimalisticIcon aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{asset.asset.originalFilename}</span>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {m.media_editor_description()}
                    </DialogDescription>
                </DialogHeader>

                <Cropper
                    key={editorAsset.asset.id}
                    actionsRef={cropper}
                    src={imageSrc}
                    // Most crops keep the photo's own shape; a network's ratio is one click away.
                    defaultValue={{ aspect: 'original' }}
                    onLoad={() => setLoadState('ready')}
                    onError={() => setLoadState('failed')}>
                    <CropperViewport className="h-[min(56vh,32rem)] min-h-64 bg-surface-canvas" />

                    <div
                        className="grid gap-3 border-t border-border/60 bg-muted px-5 pt-3 pb-4 sm:px-6"
                        data-media-editor-controls>
                        <div className="mx-auto flex w-full max-w-md items-end gap-1">
                            <CropperRotate className="mb-1" />
                            <div className="flex min-w-0 flex-1 flex-col items-center">
                                <CropperAngle />
                                <CropperDial className="w-full flex-none" />
                            </div>
                            <CropperFlip className="mb-1" />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CropperAspect>
                                <CropperAspectItem value="original">
                                    {m.media_editor_aspect_source()}
                                </CropperAspectItem>
                                <CropperAspectItem value="free">
                                    {m.media_editor_aspect_free()}
                                </CropperAspectItem>
                                <CropperAspectItem value={1}>1:1</CropperAspectItem>
                                <CropperAspectItem value={4 / 5}>4:5</CropperAspectItem>
                                <CropperAspectItem value={16 / 9}>16:9</CropperAspectItem>
                            </CropperAspect>
                            <CropperReset />
                        </div>
                    </div>
                </Cropper>

                <div className="grid gap-3 bg-muted px-5 pb-4 sm:px-6">
                    {loadState === 'failed' ? (
                        <Alert variant="destructive">
                            <AlertDescription>{m.media_editor_unreadable()}</AlertDescription>
                        </Alert>
                    ) : null}
                    {error !== null ? (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}
                    <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onOpenChange(false)}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            type="button"
                            disabled={busy || loadState !== 'ready'}
                            onClick={() => void save()}>
                            <GalleryEditIcon aria-hidden="true" />
                            {busy ? m.media_editor_saving() : m.media_editor_save()}
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
