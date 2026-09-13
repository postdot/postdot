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
import { Input } from '@herald/ui/components/input'
import { AltArrowLeftIcon } from '@solar-icons/react/bold/alt-arrow-left'
import { AltArrowRightIcon } from '@solar-icons/react/bold/alt-arrow-right'
import { CloseIcon } from '@solar-icons/react/bold/close'
import { GalleryAddIcon } from '@solar-icons/react/bold/gallery-add'
import { MagnifierIcon } from '@solar-icons/react/bold/magnifier'
import { UploadIcon } from '@solar-icons/react/bold/upload'
import { UppyContextProvider, useDropzone, useFileInput, useUppyState } from '@uppy/react'
import { lazy, useMemo, Suspense, useEffect, useRef, useState, type DragEvent } from 'react'

import { MediaAssetCard, MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, formatApiError, type MediaReference } from '@/lib/api'
import {
    createHeraldMediaUploadController,
    uploadHeraldMediaFile,
    type HeraldMediaUploadController,
    type HeraldMediaUppyFile,
} from '@/lib/herald-media-upload'
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

const MEDIA_PAGE_SIZE = 24

interface MediaAttachmentPickerProps {
    readonly projectId: string
    readonly value: readonly MediaSelection[]
    readonly onChange: (value: MediaSelection[]) => void
    readonly onAssetsChange?: (assets: MediaReference[]) => void
    readonly disabled?: boolean
    readonly emptyDescription?: string
    readonly variant?: 'library' | 'publication-new' | 'publication-new-inline'
    readonly selectionMode?: 'attach' | 'manage'
}

export function MediaAttachmentPicker(props: MediaAttachmentPickerProps) {
    return <MediaAttachmentPickerInstance key={props.projectId} {...props} />
}

function MediaAttachmentPickerInstance(props: MediaAttachmentPickerProps) {
    const [controller] = useState(() => createHeraldMediaUploadController(props.projectId, api))

    useEffect(() => {
        return () => {
            void controller.uppy.destroy()
        }
    }, [controller])

    return (
        <UppyContextProvider uppy={controller.uppy}>
            <MediaAttachmentPickerView {...props} controller={controller} />
        </UppyContextProvider>
    )
}

function MediaAttachmentPickerView({
    projectId,
    value,
    onChange,
    onAssetsChange,
    disabled = false,
    emptyDescription,
    variant = 'library',
    selectionMode = 'attach',
    controller,
}: MediaAttachmentPickerProps & { readonly controller: HeraldMediaUploadController }) {
    useLanguage()
    const [assets, setAssets] = useState<MediaReference[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [savingEdited, setSavingEdited] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [listRefreshKey, setListRefreshKey] = useState(0)
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [viewerAsset, setViewerAsset] = useState<MediaReference | null>(null)
    const [editorAsset, setEditorAsset] = useState<MediaReference | null>(null)
    const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null)
    const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null)
    const [dragActive, setDragActive] = useState(false)
    const uppyFiles = useUppyState(
        controller.uppy,
        state => Object.values(state.files) as HeraldMediaUppyFile[]
    )
    const fileInputOptions = useMemo(() => ({ multiple: true }), [])
    const fileInput = useFileInput(fileInputOptions)
    const dropzoneOptions = useMemo(
        () => ({
            noClick: true,
            onDragEnter: () => setDragActive(true),
            onDragLeave: () => setDragActive(false),
            onDrop: () => setDragActive(false),
        }),
        []
    )
    const dropzone = useDropzone(dropzoneOptions)
    const uploadingFile = uppyFiles.find(
        file => file.progress.uploadStarted !== null && !file.progress.complete && !file.error
    )
    const uploading = uploadingFile?.name ?? null
    const compact = variant === 'publication-new' || variant === 'publication-new-inline'
    const inline = variant === 'publication-new-inline'
    const manageOnly = selectionMode === 'manage'
    const normalizedSearchQuery = manageOnly ? searchQuery.trim() : ''
    const populatedLibrary =
        manageOnly && !loading && (assets.length > 0 || normalizedSearchQuery !== '')
    const interactionLocked = disabled || savingEdited || uploading !== null
    const currentValueRef = useRef(value)
    const onChangeRef = useRef(onChange)
    const listRequestId = useRef(0)
    const assetsRef = useRef<MediaReference[]>([])
    const selectionHydrationRequestId = useRef(0)
    const [hydratingSelection, setHydratingSelection] = useState(false)
    const selectedAssetIds = [...new Set(value.map(selection => selection.assetId))]
        .sort()
        .join('\u0000')

    useEffect(() => {
        currentValueRef.current = value
        onChangeRef.current = onChange
    }, [onChange, value])

    useEffect(() => {
        assetsRef.current = assets
    }, [assets])

    useEffect(() => {
        onAssetsChange?.(assets)
    }, [assets, onAssetsChange])

    useEffect(() => {
        let active = true
        const requestId = ++listRequestId.current
        const delay = normalizedSearchQuery === '' ? 0 : 180
        const timer = window.setTimeout(() => {
            setLoading(true)
            setLoadingMore(false)
            setError(null)
            setAssets([])
            setNextCursor(null)

            void api
                .listMedia(projectId, {
                    limit: MEDIA_PAGE_SIZE,
                    search: normalizedSearchQuery || undefined,
                })
                .then(response => {
                    if (active && requestId === listRequestId.current) {
                        setAssets(response.media)
                        setNextCursor(response.nextCursor)
                    }
                })
                .catch(caughtError => {
                    if (active && requestId === listRequestId.current) {
                        setError(errorMessage(caughtError))
                    }
                })
                .finally(() => {
                    if (active && requestId === listRequestId.current) setLoading(false)
                })
        }, delay)

        return () => {
            active = false
            window.clearTimeout(timer)
        }
    }, [listRefreshKey, normalizedSearchQuery, projectId])

    useEffect(() => {
        if (manageOnly || selectedAssetIds === '') {
            setHydratingSelection(false)
            return
        }

        const missingAssetIds = selectedAssetIds
            .split('\u0000')
            .filter(assetId => !assetsRef.current.some(asset => asset.asset.id === assetId))
        if (missingAssetIds.length === 0) {
            setHydratingSelection(false)
            return
        }

        let active = true
        const requestId = ++selectionHydrationRequestId.current
        setHydratingSelection(true)
        void Promise.all(
            missingAssetIds.map(assetId => api.getMedia(projectId, assetId).catch(() => null))
        ).then(loadedAssets => {
            if (!active || requestId !== selectionHydrationRequestId.current) return
            const availableAssets = loadedAssets.filter(
                (asset): asset is MediaReference => asset !== null
            )
            if (availableAssets.length > 0) {
                setAssets(current => upsertAssets(current, availableAssets))
            }
            setHydratingSelection(false)
        })

        return () => {
            active = false
        }
    }, [manageOnly, projectId, selectedAssetIds])

    useEffect(() => {
        const handleFilesAdded = (files: HeraldMediaUppyFile[]) => {
            if (disabled || savingEdited) {
                controller.uppy.removeFiles(files.map(file => file.id))
                return
            }

            setError(null)
            void controller.uppy
                .upload()
                .then(result => {
                    if (result === undefined) return

                    const uploaded = (result.successful ?? [])
                        .map(file => controller.mediaByFileId.get(file.id))
                        .filter((asset): asset is MediaReference => asset !== undefined)
                    if (uploaded.length > 0) {
                        const visibleUploaded = uploaded.filter(asset =>
                            matchesMediaSearch(asset, normalizedSearchQuery)
                        )
                        if (manageOnly) {
                            setListRefreshKey(current => current + 1)
                        } else {
                            setAssets(current =>
                                upsertAssets(current, visibleUploaded).slice(0, MEDIA_PAGE_SIZE)
                            )
                        }
                        const selected = [...currentValueRef.current]
                        for (const asset of uploaded) {
                            if (!selected.some(item => item.assetId === asset.asset.id)) {
                                selected.push(mediaSelectionFor(asset))
                            }
                        }
                        onChangeRef.current(selected)
                    }

                    const failures = (result.failed ?? []).map(file => {
                        const cause =
                            controller.errorsByFileId.get(file.id) ??
                            new Error(file.error ?? 'media_upload_failed')
                        return `${file.name}: ${errorMessage(cause)}`
                    })
                    if (failures.length > 0) setError(failures.join(' '))
                })
                .catch(caughtError => setError(errorMessage(caughtError)))
                .finally(() => controller.uppy.removeFiles(files.map(file => file.id)))
        }

        controller.uppy.on('files-added', handleFilesAdded)
        return () => {
            controller.uppy.off('files-added', handleFilesAdded)
        }
    }, [controller, disabled, manageOnly, normalizedSearchQuery, savingEdited])

    function toggleAsset(asset: MediaReference) {
        if (interactionLocked || asset.asset.state !== 'ready') return
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
        setSavingEdited(true)
        try {
            const editedAsset = await uploadHeraldMediaFile(api, projectId, {
                data: file,
                filename: file.name,
                expectedSize: file.size,
                contentType: file.type || undefined,
            })
            if (manageOnly) {
                setListRefreshKey(current => current + 1)
            } else if (matchesMediaSearch(editedAsset, normalizedSearchQuery)) {
                setAssets(current => upsertAssets(current, [editedAsset]).slice(0, MEDIA_PAGE_SIZE))
            }

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
            setSavingEdited(false)
        }
    }

    function startReorder(event: DragEvent<HTMLDivElement>, assetId: string) {
        if (interactionLocked) return
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

    async function loadMoreAssets() {
        if (nextCursor === null || loading || loadingMore) return

        const requestId = listRequestId.current
        setLoadingMore(true)
        setError(null)
        try {
            const response = await api.listMedia(projectId, {
                cursor: nextCursor,
                limit: MEDIA_PAGE_SIZE,
                search: normalizedSearchQuery || undefined,
            })
            if (requestId !== listRequestId.current) return
            setAssets(current => upsertAssets(current, response.media))
            setNextCursor(response.nextCursor)
        } catch (caughtError) {
            if (requestId === listRequestId.current) setError(errorMessage(caughtError))
        } finally {
            if (requestId === listRequestId.current) setLoadingMore(false)
        }
    }

    const selectedAssets = value.map(selection => ({
        selection,
        asset: assets.find(candidate => candidate.asset.id === selection.assetId),
    }))
    const dropzoneRootProps = interactionLocked ? {} : dropzone.getRootProps()
    const containerDropzoneProps = manageOnly ? {} : dropzoneRootProps
    const fileInputProps = fileInput.getInputProps()
    const fileButtonProps = fileInput.getButtonProps()

    return (
        <>
            <div
                {...containerDropzoneProps}
                data-media-picker="true"
                data-media-dropzone={!manageOnly ? 'true' : undefined}
                className={`${
                    inline
                        ? 'border-t border-border/70 bg-muted/25 px-3 py-2'
                        : compact
                          ? 'pt-1'
                          : manageOnly
                            ? 'space-y-4'
                            : 'rounded-lg bg-muted p-4 sm:p-5'
                }`}>
                {manageOnly ? (
                    <div
                        role="search"
                        aria-label={m.media_search_label()}
                        data-media-library-toolbar="true"
                        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative min-w-0 sm:w-80">
                            <label className="sr-only" htmlFor={`media-search-${projectId}`}>
                                {m.media_search_label()}
                            </label>
                            <MagnifierIcon
                                aria-hidden="true"
                                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                id={`media-search-${projectId}`}
                                type="search"
                                data-media-search="true"
                                value={searchQuery}
                                onChange={event => setSearchQuery(event.target.value)}
                                placeholder={m.media_search_placeholder()}
                                className="h-8 pl-9 text-sm"
                            />
                        </div>
                        {assets.length > 0 ? (
                            <p
                                aria-live="polite"
                                className="text-xs text-muted-foreground sm:shrink-0">
                                {m.media_visible_count({ count: assets.length })}
                            </p>
                        ) : null}
                    </div>
                ) : null}
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
                {manageOnly ? (
                    <div
                        {...dropzoneRootProps}
                        data-media-import-zone="true"
                        data-media-dropzone="true"
                        className={`group flex rounded-md border border-dashed px-4 text-center transition-colors ${
                            populatedLibrary
                                ? 'min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2'
                                : 'min-h-32 flex-col items-center justify-center gap-2 px-6 py-6'
                        } ${
                            dragActive
                                ? 'border-primary bg-primary/5'
                                : 'border-border/80 bg-transparent hover:border-primary/60'
                        }`}>
                        <div
                            className={`flex min-w-0 items-center ${populatedLibrary ? 'gap-2' : 'flex-col gap-2'}`}>
                            <UploadIcon
                                aria-hidden="true"
                                className={`shrink-0 ${
                                    dragActive
                                        ? 'text-primary'
                                        : 'text-muted-foreground group-hover:text-primary'
                                } ${populatedLibrary ? 'size-5' : 'size-7'}`}
                            />
                            <div
                                className={
                                    populatedLibrary
                                        ? 'flex min-w-0 flex-wrap items-center gap-x-2'
                                        : 'space-y-1'
                                }>
                                <p className="text-sm font-medium">
                                    {dragActive
                                        ? m.media_drop_files_active()
                                        : m.media_drop_files()}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {m.media_drop_files_hint()}{' '}
                                    <Button
                                        type="button"
                                        variant="link"
                                        size="sm"
                                        disabled={interactionLocked}
                                        className="h-auto p-0 align-baseline text-sm font-medium"
                                        onClick={() => fileButtonProps.onClick()}>
                                        {uploading === null
                                            ? m.media_browse_files()
                                            : m.media_uploading({ filename: uploading })}
                                    </Button>
                                </p>
                            </div>
                        </div>
                        <p className="shrink-0 text-xs text-muted-foreground">
                            {m.media_supported_types()}
                        </p>
                    </div>
                ) : (
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
                            disabled={interactionLocked}
                            onClick={() =>
                                compact ? setLibraryOpen(true) : fileButtonProps.onClick()
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
                )}

                <input
                    {...fileInputProps}
                    className="sr-only"
                    disabled={interactionLocked}
                    tabIndex={-1}
                    aria-hidden="true"
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
                    normalizedSearchQuery !== '' ? (
                        <p className="mt-4 text-sm text-muted-foreground">{m.media_no_results()}</p>
                    ) : (
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
                    )
                ) : (
                    <div
                        className={`${manageOnly ? '' : 'mt-4 '}grid gap-3 ${
                            manageOnly
                                ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))]'
                                : 'sm:grid-cols-2'
                        }`}>
                        {assets.map(asset => {
                            const selected = value.find(item => item.assetId === asset.asset.id)
                            return (
                                <MediaAssetCard
                                    key={asset.asset.id}
                                    asset={asset}
                                    interactionDisabled={interactionLocked}
                                    projectId={projectId}
                                    selected={selected}
                                    selectable={!manageOnly}
                                    onAccessibilityTextChange={updateAccessibilityText}
                                    onToggle={toggleAsset}
                                    onPreview={openViewer}
                                />
                            )
                        })}
                    </div>
                )}

                {!compact && !loading && assets.length > 0 && nextCursor !== null ? (
                    <div className="mt-4 flex justify-center">
                        <Button
                            type="button"
                            className="shadow-none"
                            variant="outline"
                            disabled={interactionLocked || loadingMore}
                            data-media-load-more="true"
                            onClick={() => void loadMoreAssets()}>
                            {loadingMore ? m.media_loading_more() : m.media_load_more()}
                        </Button>
                    </div>
                ) : null}

                {!hydratingSelection &&
                value.some(item => !assets.some(asset => asset.asset.id === item.assetId)) ? (
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
                                    disabled={interactionLocked}
                                    onClick={() => fileButtonProps.onClick()}>
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
                                    disabled={interactionLocked}
                                    onClick={() => fileButtonProps.onClick()}>
                                    <UploadIcon aria-hidden="true" />
                                    {m.media_upload_image()}
                                </Button>
                            </Empty>
                        ) : (
                            <>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {assets.map(asset => (
                                        <MediaAssetCard
                                            key={asset.asset.id}
                                            asset={asset}
                                            interactionDisabled={interactionLocked}
                                            projectId={projectId}
                                            selected={value.find(
                                                item => item.assetId === asset.asset.id
                                            )}
                                            selectable={!manageOnly}
                                            onAccessibilityTextChange={updateAccessibilityText}
                                            onToggle={toggleAsset}
                                            onPreview={openViewer}
                                        />
                                    ))}
                                </div>
                                {nextCursor !== null ? (
                                    <div className="mt-4 flex justify-center">
                                        <Button
                                            type="button"
                                            className="shadow-none"
                                            variant="outline"
                                            disabled={interactionLocked || loadingMore}
                                            data-media-load-more="true"
                                            onClick={() => void loadMoreAssets()}>
                                            {loadingMore
                                                ? m.media_loading_more()
                                                : m.media_load_more()}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
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
                    saving={savingEdited}
                    onOpenChange={open => {
                        if (!open && !savingEdited) setEditorAsset(null)
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

function upsertAssets(current: readonly MediaReference[], additions: readonly MediaReference[]) {
    const byId = new Map(current.map(asset => [asset.asset.id, asset]))
    for (const asset of additions) byId.set(asset.asset.id, asset)
    return [...byId.values()].sort(
        (left, right) =>
            right.asset.createdAt - left.asset.createdAt ||
            right.asset.id.localeCompare(left.asset.id)
    )
}

function matchesMediaSearch(asset: MediaReference, search: string): boolean {
    return (
        search === '' ||
        asset.asset.originalFilename.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    )
}

function mediaSelectionFor(asset: MediaReference): MediaSelection {
    return asset.asset.defaultAccessibilityText === null
        ? { assetId: asset.asset.id }
        : {
              assetId: asset.asset.id,
              accessibilityText: asset.asset.defaultAccessibilityText,
          }
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
