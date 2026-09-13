import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { AltArrowLeftIcon } from '@solar-icons/react/bold/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CloseIcon } from '@solar-icons/react/bold/close'
import { GalleryAddIcon } from '@solar-icons/react/bold/gallery-add'
import { UploadIcon } from '@solar-icons/react/bold/upload'
import {
    lazy,
    Suspense,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
} from 'react'

import { MediaAssetCard, MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, formatApiError, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { MediaVerificationError } from '@/lib/media-errors'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

const MediaImageEditorDialog = lazy(async () => {
    const module = await import('@/components/media-image-editor-dialog')
    return { default: module.MediaImageEditorDialog }
})
const MediaImageViewerDialog = lazy(async () => {
    const module = await import('@/components/media-image-editor-dialog')
    return { default: module.MediaImageViewerDialog }
})

export type { MediaSelection } from '@/lib/target-media'

interface MediaAttachmentPickerProps {
    readonly projectId: string
    readonly value: readonly MediaSelection[]
    readonly onChange: (value: MediaSelection[]) => void
    readonly onAssetsChange?: (assets: MediaReference[]) => void
    readonly disabled?: boolean
    readonly emptyDescription?: string
    readonly variant?: 'library' | 'publication-new' | 'publication-new-inline'
}

export function MediaAttachmentPicker({
    projectId,
    value,
    onChange,
    onAssetsChange,
    disabled = false,
    emptyDescription,
    variant = 'library',
}: MediaAttachmentPickerProps) {
    useLanguage()
    const inputRef = useRef<HTMLInputElement>(null)
    const [assets, setAssets] = useState<MediaReference[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [viewerAsset, setViewerAsset] = useState<MediaReference | null>(null)
    const [editorAsset, setEditorAsset] = useState<MediaReference | null>(null)
    const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null)
    const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null)
    const interactionDisabled = disabled || uploading !== null
    const compact = variant === 'publication-new' || variant === 'publication-new-inline'
    const inline = variant === 'publication-new-inline'

    useEffect(() => {
        onAssetsChange?.(assets)
    }, [assets, onAssetsChange])

    useEffect(() => {
        let active = true
        setLoading(true)
        setError(null)

        void api
            .listMedia(projectId)
            .then(response => {
                if (active) setAssets(response.media)
            })
            .catch(caughtError => {
                if (active) setError(errorMessage(caughtError))
            })
            .finally(() => {
                if (active) setLoading(false)
            })

        return () => {
            active = false
        }
    }, [projectId])

    async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
        const input = event.currentTarget
        const files = Array.from(input.files ?? [])
        input.value = ''
        if (files.length === 0) return

        setError(null)
        const uploaded: MediaReference[] = []
        const selected = [...value]
        const failures: string[] = []

        for (const file of files) {
            setUploading(file.name)
            try {
                const reservation = await api.reserveMediaUpload(projectId, {
                    originalFilename: file.name,
                    expectedSize: file.size,
                    contentType: file.type || undefined,
                })
                await api.uploadMedia(projectId, reservation.intent.id, file)
                const media = await completeMediaUpload(projectId, reservation.intent.id)
                uploaded.push(media)
                if (!selected.some(item => item.assetId === media.asset.id)) {
                    const defaultAccessibilityText = media.asset.defaultAccessibilityText
                    selected.push(
                        defaultAccessibilityText === null
                            ? { assetId: media.asset.id }
                            : {
                                  assetId: media.asset.id,
                                  accessibilityText: defaultAccessibilityText,
                              }
                    )
                }
            } catch (caughtError) {
                failures.push(`${file.name}: ${errorMessage(caughtError)}`)
            }
        }

        setUploading(null)
        if (uploaded.length > 0) {
            setAssets(current => upsertAssets(current, uploaded))
            onChange(selected)
        }
        if (failures.length > 0) setError(failures.join(' '))
    }

    function toggleAsset(asset: MediaReference) {
        if (interactionDisabled || asset.asset.state !== 'ready') return
        const selected = value.find(item => item.assetId === asset.asset.id)
        if (selected !== undefined) {
            onChange(value.filter(item => item.assetId !== asset.asset.id))
            return
        }

        const defaultAccessibilityText = asset.asset.defaultAccessibilityText
        onChange([
            ...value,
            defaultAccessibilityText === null
                ? { assetId: asset.asset.id }
                : { assetId: asset.asset.id, accessibilityText: defaultAccessibilityText },
        ])
    }

    function updateAccessibilityText(assetId: string, text: string) {
        onChange(
            value.map(item => {
                if (item.assetId !== assetId) return item
                if (text.trim() === '') {
                    const next = { ...item }
                    delete next.accessibilityText
                    return next
                }
                return { ...item, accessibilityText: text }
            })
        )
    }

    function moveSelection(index: number, offset: -1 | 1) {
        const nextIndex = index + offset
        if (nextIndex < 0 || nextIndex >= value.length) return

        const next = [...value]
        const [selection] = next.splice(index, 1)
        if (selection === undefined) return
        next.splice(nextIndex, 0, selection)
        onChange(next)
    }

    function removeSelection(assetId: string) {
        onChange(value.filter(item => item.assetId !== assetId))
    }

    function openViewer(asset: MediaReference) {
        setViewerAsset(asset)
    }

    function openEditor(asset: MediaReference) {
        setViewerAsset(null)
        setEditorAsset(asset)
    }

    async function saveEditedAsset(sourceAssetId: string, file: File) {
        setError(null)
        setUploading(file.name)
        try {
            const reservation = await api.reserveMediaUpload(projectId, {
                originalFilename: file.name,
                expectedSize: file.size,
                contentType: file.type || undefined,
            })
            await api.uploadMedia(projectId, reservation.intent.id, file)
            const editedAsset = await completeMediaUpload(projectId, reservation.intent.id)
            setAssets(current => upsertAssets(current, [editedAsset]))

            const sourceSelection = value.find(item => item.assetId === sourceAssetId)
            if (sourceSelection !== undefined) {
                const defaultAccessibilityText = editedAsset.asset.defaultAccessibilityText
                onChange(
                    value.map(item => {
                        if (item.assetId !== sourceAssetId) return item
                        if (item.accessibilityText !== undefined) {
                            return { ...item, assetId: editedAsset.asset.id }
                        }
                        return defaultAccessibilityText === null
                            ? { assetId: editedAsset.asset.id }
                            : {
                                  assetId: editedAsset.asset.id,
                                  accessibilityText: defaultAccessibilityText,
                              }
                    })
                )
            }
            setEditorAsset(null)
            setViewerAsset(null)
        } catch (caughtError) {
            setError(errorMessage(caughtError))
            throw caughtError
        } finally {
            setUploading(null)
        }
    }

    function startReorder(event: DragEvent<HTMLDivElement>, assetId: string) {
        if (interactionDisabled) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', assetId)
        setDraggingAssetId(assetId)
    }

    function overReorder(event: DragEvent<HTMLDivElement>, assetId: string) {
        const sourceAssetId = draggingAssetId ?? event.dataTransfer.getData('text/plain')
        if (sourceAssetId === '' || sourceAssetId === assetId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOverAssetId(assetId)
    }

    function dropReorder(event: DragEvent<HTMLDivElement>, targetAssetId: string) {
        event.preventDefault()
        const sourceAssetId = draggingAssetId ?? event.dataTransfer.getData('text/plain')
        if (sourceAssetId !== '') moveSelectionTo(sourceAssetId, targetAssetId)
        setDraggingAssetId(null)
        setDragOverAssetId(null)
    }

    function moveSelectionTo(sourceAssetId: string, targetAssetId: string) {
        if (sourceAssetId === targetAssetId) return
        const sourceIndex = value.findIndex(item => item.assetId === sourceAssetId)
        const targetIndex = value.findIndex(item => item.assetId === targetAssetId)
        if (sourceIndex < 0 || targetIndex < 0) return

        const next = [...value]
        const [selection] = next.splice(sourceIndex, 1)
        if (selection === undefined) return
        next.splice(targetIndex, 0, selection)
        onChange(next)
    }

    const selectedAssets = value.map(selection => ({
        selection,
        asset: assets.find(candidate => candidate.asset.id === selection.assetId),
    }))

    return (
        <>
            <div
                data-media-picker="true"
                className={
                    inline
                        ? 'border-t border-border/70 bg-muted/25 px-3 py-2'
                        : compact
                          ? 'pt-1'
                          : 'rounded-lg bg-muted p-4 sm:p-5'
                }>
                {inline && !loading && selectedAssets.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {selectedAssets.map(({ asset, selection }, index) => (
                            <CompactMediaPreview
                                key={selection.assetId}
                                asset={asset}
                                index={index}
                                projectId={projectId}
                                selection={selection}
                                total={value.length}
                                onMove={moveSelection}
                                onRemove={removeSelection}
                                onPreview={openViewer}
                                onDragStart={startReorder}
                                onDragOver={overReorder}
                                onDrop={dropReorder}
                                onDragEnd={() => {
                                    setDraggingAssetId(null)
                                    setDragOverAssetId(null)
                                }}
                                dragging={draggingAssetId === selection.assetId}
                                dragOver={dragOverAssetId === selection.assetId}
                            />
                        ))}
                    </div>
                ) : null}
                <div
                    className={
                        inline
                            ? 'flex items-center justify-between gap-3'
                            : compact
                              ? 'flex items-center justify-between gap-3'
                              : 'flex flex-col justify-between gap-3 sm:flex-row sm:items-center'
                    }>
                    {!inline ? (
                        <div>
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <GalleryAddIcon aria-hidden="true" />
                                {m.media_attachments_title()}
                            </div>
                            {!compact ? (
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                    {m.media_picker_description()}
                                </p>
                            ) : null}
                        </div>
                    ) : (
                        <span className="text-xs text-muted-foreground">
                            {value.length === 0
                                ? m.media_attachments_title()
                                : m.common_media_selected({ count: value.length })}
                        </span>
                    )}
                    <Button
                        type="button"
                        variant={compact ? 'ghost' : 'secondary'}
                        size={compact ? 'sm' : 'default'}
                        disabled={interactionDisabled}
                        onClick={() =>
                            compact ? setLibraryOpen(true) : inputRef.current?.click()
                        }>
                        {inline || compact ? (
                            <GalleryAddIcon aria-hidden="true" />
                        ) : (
                            <UploadIcon aria-hidden="true" />
                        )}
                        {uploading === null
                            ? m.media_upload()
                            : m.media_uploading({ filename: uploading })}
                    </Button>
                </div>

                <input
                    ref={inputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    disabled={interactionDisabled}
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={event => void handleFilesSelected(event)}
                />

                {error !== null ? (
                    <Alert variant="destructive" className="mt-4 rounded-md">
                        <AlertTitle>{m.media_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                {loading ? (
                    <p
                        className={
                            inline
                                ? 'mt-2 text-xs text-muted-foreground'
                                : 'mt-4 text-sm text-muted-foreground'
                        }>
                        {m.media_loading()}
                    </p>
                ) : compact ? (
                    inline ? null : selectedAssets.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                            {m.media_empty_publication_new()}
                        </p>
                    ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {selectedAssets.map(({ asset, selection }, index) => (
                                <CompactMediaPreview
                                    key={selection.assetId}
                                    asset={asset}
                                    index={index}
                                    projectId={projectId}
                                    selection={selection}
                                    total={value.length}
                                    onMove={moveSelection}
                                    onRemove={removeSelection}
                                    onPreview={openViewer}
                                    onDragStart={startReorder}
                                    onDragOver={overReorder}
                                    onDrop={dropReorder}
                                    onDragEnd={() => {
                                        setDraggingAssetId(null)
                                        setDragOverAssetId(null)
                                    }}
                                    dragging={draggingAssetId === selection.assetId}
                                    dragOver={dragOverAssetId === selection.assetId}
                                />
                            ))}
                        </div>
                    )
                ) : assets.length === 0 ? (
                    <Empty className="mt-4 min-h-28 bg-surface-field px-4 py-5">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <GalleryAddIcon aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>{m.media_empty_title()}</EmptyTitle>
                            <EmptyDescription>
                                {emptyDescription ?? m.media_empty_here()}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {assets.map(asset => {
                            const selected = value.find(item => item.assetId === asset.asset.id)
                            return (
                                <MediaAssetCard
                                    key={asset.asset.id}
                                    asset={asset}
                                    interactionDisabled={interactionDisabled}
                                    projectId={projectId}
                                    selected={selected}
                                    onAccessibilityTextChange={updateAccessibilityText}
                                    onToggle={toggleAsset}
                                    onPreview={openViewer}
                                />
                            )
                        })}
                    </div>
                )}

                {value.some(item => !assets.some(asset => asset.asset.id === item.assetId)) ? (
                    <div className="mt-3 flex items-start gap-2 rounded-md bg-state-attention/10 px-3 py-2 text-xs text-state-attention">
                        <CloseIcon aria-hidden="true" className="mt-0.5 shrink-0" />
                        <p>{m.media_missing_assets()}</p>
                    </div>
                ) : null}
            </div>

            {compact ? (
                <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
                    <DialogContent
                        data-media-library="true"
                        className="max-h-[min(44rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-3xl">
                        <DialogHeader>
                            <div className="flex items-start justify-between gap-4 pr-8">
                                <div className="min-w-0">
                                    <DialogTitle>{m.media_title()}</DialogTitle>
                                    <DialogDescription>
                                        {m.media_picker_description()}
                                    </DialogDescription>
                                </div>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={interactionDisabled}
                                    onClick={() => inputRef.current?.click()}>
                                    <UploadIcon aria-hidden="true" />
                                    {uploading === null
                                        ? m.media_upload_image()
                                        : m.media_uploading({ filename: uploading })}
                                </Button>
                            </div>
                        </DialogHeader>

                        {error !== null ? (
                            <Alert variant="destructive" className="rounded-md">
                                <AlertTitle>{m.media_action_failed()}</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        ) : null}

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
                                    onClick={() => inputRef.current?.click()}>
                                    <UploadIcon aria-hidden="true" />
                                    {m.media_upload_image()}
                                </Button>
                            </Empty>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {assets.map(asset => (
                                    <MediaAssetCard
                                        key={asset.asset.id}
                                        asset={asset}
                                        interactionDisabled={interactionDisabled}
                                        projectId={projectId}
                                        selected={value.find(
                                            item => item.assetId === asset.asset.id
                                        )}
                                        onAccessibilityTextChange={updateAccessibilityText}
                                        onToggle={toggleAsset}
                                        onPreview={openViewer}
                                    />
                                ))}
                            </div>
                        )}

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setLibraryOpen(false)}>
                                {m.common_done()}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
            <Suspense fallback={null}>
                <MediaImageViewerDialog
                    asset={viewerAsset}
                    open={viewerAsset !== null}
                    onOpenChange={open => {
                        if (!open) setViewerAsset(null)
                    }}
                    onEdit={openEditor}
                />
                <MediaImageEditorDialog
                    asset={editorAsset}
                    open={editorAsset !== null}
                    saving={uploading !== null}
                    onOpenChange={open => {
                        if (!open && uploading === null) setEditorAsset(null)
                    }}
                    onSave={file =>
                        editorAsset === null
                            ? Promise.resolve()
                            : saveEditedAsset(editorAsset.asset.id, file)
                    }
                />
            </Suspense>
        </>
    )
}

function CompactMediaPreview({
    asset,
    index,
    projectId,
    selection,
    total,
    onMove,
    onRemove,
    onPreview,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    dragging,
    dragOver,
}: {
    readonly asset: MediaReference | undefined
    readonly index: number
    readonly projectId: string
    readonly selection: MediaSelection
    readonly total: number
    readonly onMove: (index: number, offset: -1 | 1) => void
    readonly onRemove: (assetId: string) => void
    readonly onPreview: (asset: MediaReference) => void
    readonly onDragStart: (event: DragEvent<HTMLDivElement>, assetId: string) => void
    readonly onDragOver: (event: DragEvent<HTMLDivElement>, assetId: string) => void
    readonly onDrop: (event: DragEvent<HTMLDivElement>, assetId: string) => void
    readonly onDragEnd: () => void
    readonly dragging: boolean
    readonly dragOver: boolean
}) {
    const filename = asset?.asset.originalFilename ?? m.media_file_type()
    const representation = asset === undefined ? undefined : readyRepresentation(asset)

    return (
        <div
            draggable={asset !== undefined && total > 1}
            data-media-dragging={dragging || undefined}
            data-media-drop-target={dragOver || undefined}
            data-media-reorderable={asset !== undefined && total > 1 ? 'true' : undefined}
            title={total > 1 ? m.media_reorder_hint() : undefined}
            className={`group relative size-20 overflow-hidden rounded-md bg-surface-field ${
                dragging ? 'opacity-45' : ''
            } ${dragOver ? 'ring-2 ring-primary' : ''}`}
            onDragStart={event => {
                if (asset !== undefined) onDragStart(event, selection.assetId)
            }}
            onDragOver={event => onDragOver(event, selection.assetId)}
            onDrop={event => onDrop(event, selection.assetId)}
            onDragEnd={onDragEnd}>
            {asset !== undefined && representation !== undefined ? (
                <button
                    type="button"
                    data-media-preview="true"
                    className="block size-20 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    aria-label={m.media_view_asset({ filename })}
                    onClick={() => onPreview(asset)}>
                    <MediaPreview
                        projectId={projectId}
                        asset={asset}
                        representation={representation}
                        className="size-20 rounded-md object-cover"
                    />
                </button>
            ) : (
                <span className="flex size-20 items-center justify-center text-xs text-muted-foreground">
                    {m.media_file_type()}
                </span>
            )}
            {total > 1 ? (
                <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-xs"
                        aria-label={m.media_move_left({ filename })}
                        disabled={index === 0}
                        onClick={() => onMove(index, -1)}>
                        <AltArrowLeftIcon aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-xs"
                        aria-label={m.media_move_right({ filename })}
                        disabled={index === total - 1}
                        onClick={() => onMove(index, 1)}>
                        <AltArrowRightIcon aria-hidden="true" />
                    </Button>
                </div>
            ) : null}
            <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                className="absolute top-1 right-1 border-2 border-background bg-state-failed text-white shadow-control hover:bg-state-failed/85"
                aria-label={m.media_remove({ filename })}
                onClick={() => onRemove(selection.assetId)}>
                <CloseIcon aria-hidden="true" />
            </Button>
        </div>
    )
}

async function completeMediaUpload(projectId: string, intentId: string): Promise<MediaReference> {
    const finalized = await api.finalizeMediaUpload(projectId, intentId)
    if (finalized.status === 'ready') return finalized.media
    if (finalized.status === 'failed') {
        throw new MediaVerificationError(finalized.media)
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(250)
        const media = await api.getMedia(projectId, finalized.media.asset.id)
        if (media.asset.state === 'ready') return media
        if (media.asset.state === 'failed') {
            throw new MediaVerificationError(media)
        }
    }

    throw new Error('media_verification_pending')
}

function upsertAssets(current: readonly MediaReference[], additions: readonly MediaReference[]) {
    const byId = new Map(current.map(asset => [asset.asset.id, asset]))
    for (const asset of additions) byId.set(asset.asset.id, asset)
    return [...byId.values()].sort((left, right) => right.asset.createdAt - left.asset.createdAt)
}

function delay(milliseconds: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown) {
    if (error instanceof MediaVerificationError) {
        if (error.detail === null) {
            return error.code === 'media_verification_failed'
                ? m.media_verification_failed()
                : m.media_verification_failed_code({ code: error.code })
        }
        return m.media_verification_failed_detail({ code: error.code, detail: error.detail })
    }
    if (error instanceof Error && error.message === 'media_verification_pending') {
        return m.media_verification_pending()
    }
    if (error instanceof Error && error.message.startsWith('media_editor_')) {
        return m.media_editor_failed()
    }
    return formatApiError(error)
}
