import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
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
import { FolderOpenIcon } from '@solar-icons/react/bold/folder-open'
import { GalleryAddIcon } from '@solar-icons/react/bold/gallery-add'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { UploadIcon } from '@solar-icons/react/bold/upload'
import type { Meta, UploadResult } from '@uppy/core'
import { UppyContextProvider, useDropzone, useFileInput, useUppyState } from '@uppy/react'
import {
    lazy,
    Suspense,
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent,
    type ReactNode,
} from 'react'

import { BulkActionBar } from '@/components/bulk-action-bar'
import {
    MediaAssetCollection,
    MediaAttachmentLibraryDialog,
    MediaLibraryToolbar,
    mediaLibraryGridClass,
} from '@/components/media'
import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { MediaBulkDeletionDialog } from '@/components/media-bulk-deletion-dialog'
import { MediaDeletionDialog } from '@/components/media-deletion-dialog'
import { MediaInformationDialog } from '@/components/media-information-dialog'
import { MediaSourcePickerDialog } from '@/components/media-source-picker-dialog'
import { MediaUploadRecoveryNotice } from '@/components/media-upload-recovery-notice'
import { MediaWebcamDialog } from '@/components/media-webcam-dialog'
import {
    api,
    formatApiError,
    type MediaImportSource,
    type MediaListDateFilter,
    type MediaListFamilyFilter,
    type MediaListSort,
    type MediaReference,
} from '@/lib/api'
import { formatBytes } from '@/lib/format'
import {
    completeHeraldMediaUpload,
    createHeraldMediaUploadController,
    uploadHeraldMediaFile,
    type HeraldMediaUploadController,
    type HeraldMediaUppyFile,
} from '@/lib/herald-media-upload'
import { useLanguage } from '@/lib/i18n'
import { MediaVerificationError } from '@/lib/media-errors'
import {
    readMediaLibraryViewMode,
    type MediaLibraryViewMode,
    writeMediaLibraryViewMode,
} from '@/lib/media-library-view'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

const MediaImageEditorDialog = lazy(async () => {
    const module = await import('@/components/media-image-editor-dialog')
    return { default: module.MediaImageEditorDialog }
})
const MediaViewer = lazy(async () => {
    const module = await import('@/components/media-viewer')
    return { default: module.MediaViewer }
})

export type { MediaSelection } from '@/lib/target-media'

const MEDIA_PAGE_SIZE = 24

const DEFAULT_MEDIA_IMPORT_SOURCES: readonly MediaImportSource[] = [
    {
        id: 'device',
        transfer: 'browser',
        requiresAuthentication: false,
    },
    {
        id: 'webcam',
        transfer: 'browser',
        requiresAuthentication: false,
    },
]

interface MediaAttachmentPickerProps {
    readonly projectId: string
    readonly value: readonly MediaSelection[]
    readonly onChange: (value: MediaSelection[]) => void
    readonly onAssetsChange?: (assets: MediaReference[]) => void
    readonly renderHeader?: (actions: {
        readonly disabled: boolean
        readonly onImport: () => void
        readonly uploading: string | null
    }) => ReactNode
    readonly disabled?: boolean
    readonly emptyDescription?: string
    readonly variant?: 'library' | 'publication-new' | 'publication-new-inline'
    readonly selectionMode?: 'attach' | 'manage'
}

export function MediaAttachmentPicker(props: MediaAttachmentPickerProps) {
    const pickerKey = `${props.projectId}:${props.variant ?? 'library'}:${props.selectionMode ?? 'attach'}`
    return <MediaAttachmentPickerInstance key={pickerKey} {...props} />
}

function MediaAttachmentPickerInstance(props: MediaAttachmentPickerProps) {
    const recoveryId = `herald-media-${props.projectId}-${props.variant ?? 'library'}-${props.selectionMode ?? 'attach'}`
    const [controller] = useState(() =>
        createHeraldMediaUploadController(props.projectId, api, undefined, undefined, {
            id: recoveryId,
        })
    )

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
    renderHeader,
    disabled = false,
    emptyDescription,
    variant = 'library',
    selectionMode = 'attach',
    controller,
}: MediaAttachmentPickerProps & { readonly controller: HeraldMediaUploadController }) {
    const { locale } = useLanguage()
    const [assets, setAssets] = useState<MediaReference[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [savingEdited, setSavingEdited] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchPending, setSearchPending] = useState(false)
    const [mediaSort, setMediaSort] = useState<MediaListSort>('newest')
    const [mediaFamilyFilter, setMediaFamilyFilter] = useState<MediaListFamilyFilter>('all')
    const [mediaDateFilter, setMediaDateFilter] = useState<MediaListDateFilter>('all')
    const [mediaViewMode, setMediaViewMode] = useState<MediaLibraryViewMode>(() =>
        readMediaLibraryViewMode()
    )
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [pendingLibrarySelection, setPendingLibrarySelection] = useState<MediaSelection[] | null>(
        null
    )
    const pendingLibrarySelectionRef = useRef<MediaSelection[] | null>(null)
    const [listRefreshKey, setListRefreshKey] = useState(0)
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [totalAssets, setTotalAssets] = useState(0)
    const attachmentScrollRef = useRef<HTMLDivElement | null>(null)
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadMoreAssetsRef = useRef<() => Promise<void>>(async () => {})
    const loadMoreInFlightRef = useRef(false)
    const [viewerAsset, setViewerAsset] = useState<MediaReference | null>(null)
    const [viewerAssets, setViewerAssets] = useState<MediaReference[]>([])
    const [viewerAllowsFileActions, setViewerAllowsFileActions] = useState(false)
    const [editorAsset, setEditorAsset] = useState<MediaReference | null>(null)
    const [informationAsset, setInformationAsset] = useState<MediaReference | null>(null)
    const [deletionAsset, setDeletionAsset] = useState<MediaReference | null>(null)
    const [deletionPending, setDeletionPending] = useState(false)
    const [deletionError, setDeletionError] = useState<string | null>(null)
    const [bulkSelectedAssetIds, setBulkSelectedAssetIds] = useState<Set<string>>(() => new Set())
    const [bulkDeletionAssets, setBulkDeletionAssets] = useState<MediaReference[]>([])
    const [bulkDeletionPending, setBulkDeletionPending] = useState(false)
    const [bulkSelectionResolutionPending, setBulkSelectionResolutionPending] = useState(false)
    const [bulkDeletionError, setBulkDeletionError] = useState<string | null>(null)
    const [bulkSelectionMode, setBulkSelectionMode] = useState(false)
    const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null)
    const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null)
    const [dragActive, setDragActive] = useState(false)
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
    const [webcamOpen, setWebcamOpen] = useState(false)
    const [mediaSources, setMediaSources] = useState<MediaImportSource[]>([
        ...DEFAULT_MEDIA_IMPORT_SOURCES,
    ])
    const [mediaSourcesLoading, setMediaSourcesLoading] = useState(false)
    const [urlImportPending, setUrlImportPending] = useState(false)
    const [urlImportError, setUrlImportError] = useState<string | null>(null)
    const [recoveryActionPending, setRecoveryActionPending] = useState(false)
    const uppyFiles = useUppyState(
        controller.uppy,
        state => Object.values(state.files) as HeraldMediaUppyFile[]
    )
    const recoveredState = useUppyState(controller.uppy, state => state.recoveredState)
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
    const libraryControlsEnabled = manageOnly || compact
    const normalizedSearchQuery = libraryControlsEnabled ? searchQuery.trim() : ''
    const interactionLocked =
        disabled ||
        savingEdited ||
        uploading !== null ||
        deletionPending ||
        bulkDeletionPending ||
        bulkSelectionResolutionPending ||
        recoveryActionPending
    const currentValueRef = useRef(value)
    const onChangeRef = useRef(onChange)
    const listRequestId = useRef(0)
    const assetsRef = useRef<MediaReference[]>([])
    const selectedMediaByIdRef = useRef(new Map<string, MediaReference>())
    const selectionHydrationRequestId = useRef(0)
    const [hydratingSelection, setHydratingSelection] = useState(false)
    const selectedAssetIds = [...new Set(value.map(selection => selection.assetId))]
        .sort()
        .join('\u0000')
    const pendingRestrictionErrorRef = useRef<string[] | null>(null)
    const recoveryUploadPendingRef = useRef(false)

    const recoveredFileIds = useMemo(
        () => new Set(Object.keys(recoveredState?.files ?? {})),
        [recoveredState]
    )
    const recoveredFiles = uppyFiles.filter(file => recoveredFileIds.has(file.id))
    const recoverableFiles = recoveredFiles.filter(
        file => !file.isGhost && file.data instanceof Blob
    )
    const ghostFiles = recoveredFiles.filter(file => file.isGhost || !(file.data instanceof Blob))

    useEffect(() => {
        currentValueRef.current = value
        onChangeRef.current = onChange
    }, [onChange, value])

    useEffect(() => {
        pendingLibrarySelectionRef.current = pendingLibrarySelection
    }, [pendingLibrarySelection])

    useEffect(() => {
        assetsRef.current = assets
        for (const asset of assets) {
            selectedMediaByIdRef.current.set(asset.asset.id, asset)
        }
    }, [assets])

    useEffect(() => {
        onAssetsChange?.(assets)
    }, [assets, onAssetsChange])

    useEffect(() => {
        if (libraryControlsEnabled) writeMediaLibraryViewMode(mediaViewMode)
    }, [libraryControlsEnabled, mediaViewMode])

    useEffect(() => {
        let active = true
        void api
            .getMediaUploadPolicy(projectId)
            .then(policy => {
                if (active) controller.setUploadPolicy(policy)
            })
            .catch(() => {
                // Keep the conservative local policy when capabilities cannot be read.
                // The server remains authoritative during reserve and finalization.
            })

        return () => {
            active = false
        }
    }, [controller, projectId])

    useEffect(() => {
        if (!sourcePickerOpen) return

        let active = true
        setMediaSourcesLoading(true)
        void api
            .getMediaImportSources(projectId)
            .then(response => {
                if (active) setMediaSources(response.sources)
            })
            .catch(() => {
                if (active) setMediaSources([...DEFAULT_MEDIA_IMPORT_SOURCES])
            })
            .finally(() => {
                if (active) setMediaSourcesLoading(false)
            })

        return () => {
            active = false
        }
    }, [projectId, sourcePickerOpen])

    useEffect(() => {
        const handleRestrictionFailed = (file: HeraldMediaUppyFile | undefined) => {
            const message = mediaRestrictionMessage(file, controller.policy, locale)
            const nextMessages = [...(pendingRestrictionErrorRef.current ?? []), message]
            pendingRestrictionErrorRef.current = nextMessages
            setError(nextMessages.join(' '))

            window.setTimeout(() => {
                if (pendingRestrictionErrorRef.current === nextMessages) {
                    pendingRestrictionErrorRef.current = null
                }
            }, 0)
        }

        controller.uppy.on('restriction-failed', handleRestrictionFailed)
        return () => {
            controller.uppy.off('restriction-failed', handleRestrictionFailed)
        }
    }, [controller, locale])

    useEffect(() => {
        if (!manageOnly) {
            setBulkSelectionMode(false)
            setBulkSelectedAssetIds(new Set())
        }
    }, [manageOnly])

    useEffect(() => {
        let active = true
        const requestId = ++listRequestId.current
        const delay = normalizedSearchQuery === '' ? 0 : 180
        const timer = window.setTimeout(() => {
            setLoading(true)
            setLoadingMore(false)
            setError(null)
            setNextCursor(null)
            setTotalAssets(0)

            void api
                .listMedia(projectId, {
                    limit: MEDIA_PAGE_SIZE,
                    search: normalizedSearchQuery || undefined,
                    sort: libraryControlsEnabled ? mediaSort : undefined,
                    family:
                        libraryControlsEnabled && mediaFamilyFilter !== 'all'
                            ? mediaFamilyFilter
                            : undefined,
                    date:
                        libraryControlsEnabled && mediaDateFilter !== 'all'
                            ? mediaDateFilter
                            : undefined,
                })
                .then(response => {
                    if (active && requestId === listRequestId.current) {
                        setAssets(response.media)
                        setNextCursor(response.nextCursor)
                        setTotalAssets(response.total)
                    }
                })
                .catch(caughtError => {
                    if (active && requestId === listRequestId.current) {
                        setError(errorMessage(caughtError))
                    }
                })
                .finally(() => {
                    if (active && requestId === listRequestId.current) {
                        setLoading(false)
                        setSearchPending(false)
                    }
                })
        }, delay)

        return () => {
            active = false
            window.clearTimeout(timer)
        }
    }, [
        listRefreshKey,
        mediaDateFilter,
        mediaFamilyFilter,
        mediaSort,
        libraryControlsEnabled,
        normalizedSearchQuery,
        projectId,
    ])

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

    function processUploadResult(
        result: UploadResult<Meta, Record<string, never>>,
        restrictionMessages: readonly string[] = []
    ) {
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
                if (compact && pendingLibrarySelectionRef.current !== null) {
                    stageAssetsForLibrary(uploaded)
                } else {
                    const selected = [...currentValueRef.current]
                    for (const asset of uploaded) {
                        if (!selected.some(item => item.assetId === asset.asset.id)) {
                            selected.push(mediaSelectionFor(asset))
                        }
                    }
                    currentValueRef.current = selected
                    onChangeRef.current(selected)
                }
            }
        }

        const failures = (result.failed ?? []).map(file => {
            const cause =
                controller.errorsByFileId.get(file.id) ??
                new Error(file.error ?? 'media_upload_failed')
            return `${file.name}: ${errorMessage(cause)}`
        })
        const uploadErrors = [...restrictionMessages, ...failures]
        setError(uploadErrors.length > 0 ? uploadErrors.join(' ') : null)

        return [...(result.successful ?? []), ...(result.failed ?? [])].map(file => file.id)
    }

    useEffect(() => {
        const handleFilesAdded = (files: HeraldMediaUppyFile[]) => {
            if (disabled || savingEdited) {
                controller.uppy.removeFiles(files.map(file => file.id))
                return
            }

            const restrictionMessages = pendingRestrictionErrorRef.current ?? []
            pendingRestrictionErrorRef.current = null
            void controller.uppy
                .upload()
                .then(result => {
                    if (result !== undefined) processUploadResult(result, restrictionMessages)
                })
                .catch(caughtError => setError(errorMessage(caughtError)))
                .finally(() => controller.uppy.removeFiles(files.map(file => file.id)))
        }

        const handleRecoveryComplete = (result: UploadResult<Meta, Record<string, never>>) => {
            if (!recoveryUploadPendingRef.current) return
            recoveryUploadPendingRef.current = false
            setRecoveryActionPending(false)
            const fileIds = processUploadResult(result)
            if (fileIds.length > 0) controller.uppy.removeFiles(fileIds)
        }

        const handleRecoveryError = (error: { message: string }) => {
            if (!recoveryUploadPendingRef.current) return
            recoveryUploadPendingRef.current = false
            setRecoveryActionPending(false)
            setError(errorMessage(error))
        }

        controller.uppy.on('files-added', handleFilesAdded)
        controller.uppy.on('complete', handleRecoveryComplete)
        controller.uppy.on('error', handleRecoveryError)
        return () => {
            controller.uppy.off('files-added', handleFilesAdded)
            controller.uppy.off('complete', handleRecoveryComplete)
            controller.uppy.off('error', handleRecoveryError)
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

    function openAttachmentLibrary() {
        if (interactionLocked) return
        setPendingLibrarySelection(current => current ?? [...value])
        setLibraryOpen(true)
    }

    function handleAttachmentLibraryOpenChange(open: boolean) {
        setLibraryOpen(open)
        if (!open) setPendingLibrarySelection(null)
    }

    function confirmAttachmentSelection() {
        const nextSelection = pendingLibrarySelection ?? value
        const committedSelection = [...nextSelection]
        currentValueRef.current = committedSelection
        onChange(committedSelection)
        setPendingLibrarySelection(null)
        setLibraryOpen(false)
    }

    function toggleLibraryAsset(asset: MediaReference) {
        if (interactionLocked || asset.asset.state !== 'ready') return

        setPendingLibrarySelection(current => {
            const next = [...(current ?? value)]
            const selectedIndex = next.findIndex(item => item.assetId === asset.asset.id)
            if (selectedIndex >= 0) {
                next.splice(selectedIndex, 1)
                return next
            }

            next.push(mediaSelectionFor(asset))
            return next
        })
    }

    function stageAssetsForLibrary(importedAssets: readonly MediaReference[]) {
        if (importedAssets.length === 0) return

        setPendingLibrarySelection(current => {
            const next = [...(current ?? currentValueRef.current)]
            for (const asset of importedAssets) {
                if (!next.some(item => item.assetId === asset.asset.id)) {
                    next.push(mediaSelectionFor(asset))
                }
            }
            return next
        })
        setLibraryOpen(true)
    }

    function toggleBulkAsset(asset: MediaReference) {
        if (interactionLocked || asset.asset.state !== 'ready') return

        setBulkSelectedAssetIds(current => {
            const next = new Set(current)
            if (next.has(asset.asset.id)) {
                next.delete(asset.asset.id)
            } else {
                next.add(asset.asset.id)
            }
            return next
        })
    }

    function toggleVisibleBulkSelection() {
        if (interactionLocked) return
        const visibleReadyAssets = assets.filter(asset => asset.asset.state === 'ready')
        const allVisibleSelected =
            visibleReadyAssets.length > 0 &&
            visibleReadyAssets.every(asset => bulkSelectedAssetIds.has(asset.asset.id))

        setBulkSelectedAssetIds(current => {
            const next = new Set(current)
            for (const asset of visibleReadyAssets) {
                if (allVisibleSelected) {
                    next.delete(asset.asset.id)
                } else {
                    next.add(asset.asset.id)
                }
            }
            return next
        })
    }

    function clearBulkSelection() {
        setBulkSelectedAssetIds(new Set())
    }

    function toggleBulkSelectionMode() {
        if (interactionLocked) return
        if (bulkSelectionMode) setBulkSelectedAssetIds(new Set())
        setBulkSelectionMode(current => !current)
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

    async function resolveBulkSelectedAssets(): Promise<MediaReference[] | null> {
        const selectedIds = [...bulkSelectedAssetIds]
        if (selectedIds.length === 0) return []

        const knownAssets = new Map(selectedMediaByIdRef.current)
        for (const asset of assets) knownAssets.set(asset.asset.id, asset)
        const missingAssetIds = selectedIds.filter(assetId => !knownAssets.has(assetId))

        if (missingAssetIds.length > 0) {
            setBulkSelectionResolutionPending(true)
            try {
                const loadedAssets = await Promise.all(
                    missingAssetIds.map(assetId =>
                        api.getMedia(projectId, assetId).catch(() => null)
                    )
                )
                for (const asset of loadedAssets) {
                    if (asset !== null) {
                        knownAssets.set(asset.asset.id, asset)
                        selectedMediaByIdRef.current.set(asset.asset.id, asset)
                    }
                }
            } finally {
                setBulkSelectionResolutionPending(false)
            }
        }

        const unavailableAssetIds = selectedIds.filter(assetId => !knownAssets.has(assetId))
        if (unavailableAssetIds.length > 0) {
            setBulkSelectedAssetIds(current => {
                const next = new Set(current)
                for (const assetId of unavailableAssetIds) next.delete(assetId)
                return next
            })
            setError(m.media_bulk_missing_assets())
            return null
        }

        return selectedIds.map(assetId => knownAssets.get(assetId)!).filter(Boolean)
    }

    async function openViewer(asset: MediaReference) {
        const previewOnly = compact && libraryOpen && pendingLibrarySelectionRef.current !== null

        if (bulkSelectionMode && bulkSelectedAssetIds.has(asset.asset.id)) {
            const collection = await resolveBulkSelectedAssets()
            if (collection === null || collection.length === 0) return
            setViewerAllowsFileActions(true)
            setViewerAssets(collection)
            setViewerAsset(
                collection.find(candidate => candidate.asset.id === asset.asset.id) ??
                    collection[0]!
            )
            return
        }

        setViewerAllowsFileActions(!previewOnly)
        setViewerAssets(assets.length > 0 ? assets : [asset])
        setViewerAsset(asset)
    }

    async function openSelectedViewer() {
        const collection = await resolveBulkSelectedAssets()
        if (collection === null || collection.length === 0) return
        setViewerAllowsFileActions(true)
        setViewerAssets(collection)
        setViewerAsset(collection[0]!)
    }

    function closeViewer() {
        setViewerAsset(null)
        setViewerAssets([])
        setViewerAllowsFileActions(false)
    }

    function openDeletion(asset: MediaReference) {
        if (!manageOnly) return
        closeViewer()
        setDeletionAsset(asset)
        setDeletionError(null)
    }

    async function confirmDeletion() {
        if (deletionAsset === null) return

        const asset = deletionAsset
        setDeletionPending(true)
        setDeletionError(null)
        try {
            await api.deleteMedia(projectId, asset.asset.id)
            setAssets(current => current.filter(candidate => candidate.asset.id !== asset.asset.id))
            selectedMediaByIdRef.current.delete(asset.asset.id)
            setBulkSelectedAssetIds(current => {
                if (!current.has(asset.asset.id)) return current
                const next = new Set(current)
                next.delete(asset.asset.id)
                return next
            })
            setListRefreshKey(current => current + 1)
            const nextValue = currentValueRef.current.filter(
                selection => selection.assetId !== asset.asset.id
            )
            if (nextValue.length !== currentValueRef.current.length) {
                currentValueRef.current = nextValue
                onChangeRef.current(nextValue)
            }
            setDeletionAsset(null)
        } catch (caughtError) {
            setDeletionError(errorMessage(caughtError))
        } finally {
            setDeletionPending(false)
        }
    }

    async function openBulkDeletion() {
        if (!manageOnly || bulkSelectedAssetIds.size === 0) return
        const selectedAssets = await resolveBulkSelectedAssets()
        if (selectedAssets === null || selectedAssets.length === 0) return
        setBulkDeletionError(null)
        setBulkDeletionAssets(selectedAssets)
    }

    async function confirmBulkDeletion() {
        if (bulkDeletionAssets.length === 0) return

        const assetsToDelete = bulkDeletionAssets
        setBulkDeletionPending(true)
        setBulkDeletionError(null)
        try {
            const response = await api.deleteMediaBatch(
                projectId,
                assetsToDelete.map(asset => asset.asset.id)
            )
            const deletionsByAssetId = new Map(
                response.deletions.map(deletion => [deletion.assetId, deletion.status])
            )
            const completedStatuses = new Set([
                'deletion_requested',
                'already_requested',
                'not_found',
            ])
            const completedAssetIds = new Set(
                assetsToDelete
                    .map(asset => asset.asset.id)
                    .filter(assetId => completedStatuses.has(deletionsByAssetId.get(assetId) ?? ''))
            )
            const failedAssets = assetsToDelete.filter(
                asset => !completedAssetIds.has(asset.asset.id)
            )

            if (completedAssetIds.size > 0) {
                setAssets(current =>
                    current.filter(asset => !completedAssetIds.has(asset.asset.id))
                )
                setBulkSelectedAssetIds(current => {
                    const next = new Set(current)
                    for (const assetId of completedAssetIds) next.delete(assetId)
                    return next
                })
                for (const assetId of completedAssetIds) {
                    selectedMediaByIdRef.current.delete(assetId)
                }
                setListRefreshKey(current => current + 1)
            }

            if (failedAssets.length === 0) {
                setBulkDeletionAssets([])
            } else {
                setBulkDeletionAssets(failedAssets)
                setBulkDeletionError(
                    m.media_bulk_delete_partial_error({ count: failedAssets.length })
                )
            }
        } catch (caughtError) {
            setBulkDeletionError(errorMessage(caughtError))
        } finally {
            setBulkDeletionPending(false)
        }
    }

    function openEditor(asset: MediaReference) {
        closeViewer()
        setEditorAsset(asset)
    }

    function openInformation(asset: MediaReference) {
        setInformationAsset(asset)
    }

    function downloadAsset(asset: MediaReference) {
        const link = document.createElement('a')
        link.href = api.mediaContentUrl(projectId, asset.asset.id)
        link.download = asset.asset.originalFilename
        link.rel = 'noreferrer'
        document.body.append(link)
        link.click()
        link.remove()
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
            const draftSelection = pendingLibrarySelectionRef.current?.find(
                item => item.assetId === sourceAssetId
            )
            if (sourceSelection !== undefined) {
                const defaultAccessibilityText = editedAsset.asset.defaultAccessibilityText
                const nextValue = value.map(item => {
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
                currentValueRef.current = nextValue
                onChange(nextValue)
            } else if (draftSelection !== undefined) {
                const defaultAccessibilityText = editedAsset.asset.defaultAccessibilityText
                const nextDraft = (pendingLibrarySelectionRef.current ?? []).map(item => {
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
                pendingLibrarySelectionRef.current = nextDraft
                setPendingLibrarySelection(nextDraft)
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

    async function importMediaFromUrl(url: string) {
        setUrlImportPending(true)
        setUrlImportError(null)
        try {
            const imported = await api.importMediaFromUrl(projectId, url)
            const importedAsset =
                imported.status === 'ready'
                    ? imported.media
                    : imported.status === 'pending'
                      ? await completeHeraldMediaUpload(api, projectId, imported.media.intent.id)
                      : (() => {
                            throw new MediaVerificationError(imported.media)
                        })()

            if (manageOnly) {
                setListRefreshKey(current => current + 1)
            } else if (matchesMediaSearch(importedAsset, normalizedSearchQuery)) {
                setAssets(current =>
                    upsertAssets(current, [importedAsset]).slice(0, MEDIA_PAGE_SIZE)
                )
            }

            if (!manageOnly) {
                if (compact) {
                    stageAssetsForLibrary([importedAsset])
                } else {
                    const selected = [...currentValueRef.current]
                    if (!selected.some(item => item.assetId === importedAsset.asset.id)) {
                        selected.push(mediaSelectionFor(importedAsset))
                        currentValueRef.current = selected
                        onChangeRef.current(selected)
                    }
                }
            }

            setSourcePickerOpen(false)
        } catch (caughtError) {
            setUrlImportError(errorMessage(caughtError))
        } finally {
            setUrlImportPending(false)
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
        if (
            nextCursor === null ||
            loading ||
            loadingMore ||
            searchPending ||
            loadMoreInFlightRef.current
        )
            return

        const requestId = listRequestId.current
        loadMoreInFlightRef.current = true
        setLoadingMore(true)
        setError(null)
        try {
            const response = await api.listMedia(projectId, {
                cursor: nextCursor,
                limit: MEDIA_PAGE_SIZE,
                search: normalizedSearchQuery || undefined,
                sort: libraryControlsEnabled ? mediaSort : undefined,
                family:
                    libraryControlsEnabled && mediaFamilyFilter !== 'all'
                        ? mediaFamilyFilter
                        : undefined,
                date:
                    libraryControlsEnabled && mediaDateFilter !== 'all'
                        ? mediaDateFilter
                        : undefined,
            })
            if (requestId !== listRequestId.current) return
            setAssets(current => mergeMediaAssets(current, response.media))
            setNextCursor(response.nextCursor)
            setTotalAssets(response.total)
        } catch (caughtError) {
            if (requestId === listRequestId.current) setError(errorMessage(caughtError))
        } finally {
            loadMoreInFlightRef.current = false
            if (requestId === listRequestId.current) setLoadingMore(false)
        }
    }

    loadMoreAssetsRef.current = loadMoreAssets

    useEffect(() => {
        if (
            !libraryControlsEnabled ||
            nextCursor === null ||
            loading ||
            loadingMore ||
            searchPending ||
            interactionLocked
        ) {
            return
        }

        const scrollRoot = compact ? attachmentScrollRef.current : null
        const sentinel = loadMoreSentinelRef.current
        if (
            sentinel === null ||
            (compact && scrollRoot === null) ||
            typeof IntersectionObserver === 'undefined'
        )
            return

        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    void loadMoreAssetsRef.current()
                }
            },
            { root: scrollRoot, rootMargin: '480px 0px' }
        )
        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [
        attachmentScrollRef,
        compact,
        interactionLocked,
        libraryControlsEnabled,
        libraryOpen,
        loading,
        loadingMore,
        nextCursor,
        searchPending,
    ])

    const selectedAssetById = useMemo(
        () => new Map(value.map(selection => [selection.assetId, selection])),
        [value]
    )
    const attachmentSelection = pendingLibrarySelection ?? value
    const attachmentSelectedAssetById = useMemo(
        () => new Map(attachmentSelection.map(selection => [selection.assetId, selection])),
        [attachmentSelection]
    )
    const assetsById = useMemo(
        () => new Map(assets.map(asset => [asset.asset.id, asset])),
        [assets]
    )
    const selectedAssets = useMemo(
        () =>
            value.map(selection => ({
                selection,
                asset: assetsById.get(selection.assetId),
            })),
        [assetsById, value]
    )
    const bulkSelectedCount = bulkSelectedAssetIds.size
    const visibleReadyAssets = assets.filter(asset => asset.asset.state === 'ready')
    const allVisibleBulkSelected =
        visibleReadyAssets.length > 0 &&
        visibleReadyAssets.every(asset => bulkSelectedAssetIds.has(asset.asset.id))
    const dropzoneRootProps = interactionLocked ? {} : dropzone.getRootProps()
    const containerDropzoneProps = dropzoneRootProps
    const fileInputProps = fileInput.getInputProps()
    const fileButtonProps = fileInput.getButtonProps()
    const hasRecoveredFiles = recoveredFiles.length > 0
    const dismissRecoveredFiles = () => {
        recoveryUploadPendingRef.current = false
        setRecoveryActionPending(false)
        controller.uppy.removeFiles(recoveredFiles.map(file => file.id))
    }
    const reselectMissingRecoveredFiles = () => {
        controller.uppy.removeFiles(ghostFiles.map(file => file.id))
        fileButtonProps.onClick()
    }
    const resumeRecoveredFiles = () => {
        if (recoveryActionPending || recoverableFiles.length === 0) return
        setRecoveryActionPending(true)
        controller.uppy.removeFiles(ghostFiles.map(file => file.id))
        recoveryUploadPendingRef.current = true
        controller.uppy.emit('restore-confirmed')
    }
    const openSourcePicker = () => {
        if (interactionLocked) return
        setUrlImportError(null)
        setLibraryOpen(false)
        setSourcePickerOpen(true)
    }
    const handleSearchQueryChange = (query: string) => {
        setSearchPending(true)
        setSearchQuery(query)
    }
    const openDevicePicker = () => {
        if (interactionLocked) return
        fileButtonProps.onClick()
        setSourcePickerOpen(false)
    }
    const openWebcamPicker = () => {
        if (interactionLocked) return
        setUrlImportError(null)
        setSourcePickerOpen(false)
        setWebcamOpen(true)
    }
    const captureWebcamFile = async (file: File) => {
        if (interactionLocked) return
        setError(null)
        try {
            controller.uppy.addFile({
                data: file,
                name: file.name,
                source: 'webcam',
                type: file.type,
            })
        } catch (caughtError) {
            setError(errorMessage(caughtError))
            throw caughtError
        }
    }
    const header = renderHeader?.({
        disabled: interactionLocked,
        onImport: openSourcePicker,
        uploading,
    })

    return (
        <>
            {header}
            <div
                {...containerDropzoneProps}
                data-media-picker="true"
                data-media-picker-mode={manageOnly ? 'manage' : 'attach'}
                data-media-dropzone={!interactionLocked ? 'true' : undefined}
                data-media-import-zone={manageOnly && !interactionLocked ? 'true' : undefined}
                className={`${
                    inline
                        ? 'border-t border-border/70 bg-muted/25 px-3 py-2'
                        : compact
                          ? 'pt-1'
                          : manageOnly
                            ? 'flex min-h-[calc(100vh-12rem)] flex-col gap-4'
                            : 'rounded-lg bg-muted p-4 sm:p-5'
                }`}>
                {hasRecoveredFiles ? (
                    <MediaUploadRecoveryNotice
                        files={recoveredFiles}
                        missingFileCount={ghostFiles.length}
                        onDismiss={dismissRecoveredFiles}
                        onReselectMissing={reselectMissingRecoveredFiles}
                        onResume={resumeRecoveredFiles}
                        pending={recoveryActionPending}
                    />
                ) : null}
                {manageOnly ? (
                    <MediaLibraryToolbar
                        assetCount={assets.length}
                        bulkSelectionMode={bulkSelectionMode}
                        interactionDisabled={interactionLocked}
                        mediaDateFilter={mediaDateFilter}
                        mediaFamilyFilter={mediaFamilyFilter}
                        mediaSort={mediaSort}
                        mediaViewMode={mediaViewMode}
                        onDateChange={setMediaDateFilter}
                        onFamilyChange={setMediaFamilyFilter}
                        onSearchQueryChange={handleSearchQueryChange}
                        onSortChange={setMediaSort}
                        onToggleSelectionMode={toggleBulkSelectionMode}
                        onViewModeChange={setMediaViewMode}
                        projectId={projectId}
                        searchPending={searchPending}
                        searchQuery={searchQuery}
                        totalAssets={totalAssets}
                    />
                ) : null}
                {manageOnly && bulkSelectionMode ? (
                    <div className="sticky top-0 z-20 mt-3">
                        <BulkActionBar
                            actions={[
                                {
                                    id: 'open',
                                    label: m.media_bulk_open_action({
                                        count: bulkSelectedCount,
                                    }),
                                    icon: <FolderOpenIcon aria-hidden="true" />,
                                    variant: 'secondary',
                                    disabled: bulkSelectionResolutionPending,
                                    onSelect: openSelectedViewer,
                                },
                                {
                                    id: 'delete',
                                    label: m.media_bulk_delete_action({
                                        count: bulkSelectedCount,
                                    }),
                                    icon: <TrashBinMinimalisticIcon aria-hidden="true" />,
                                    variant: 'destructive',
                                    disabled: bulkSelectionResolutionPending,
                                    onSelect: openBulkDeletion,
                                },
                            ]}
                            allSelected={allVisibleBulkSelected}
                            ariaLabel={m.media_bulk_actions()}
                            clearLabel={m.media_bulk_clear_selection()}
                            onClear={clearBulkSelection}
                            onToggleAll={
                                visibleReadyAssets.length > 0
                                    ? toggleVisibleBulkSelection
                                    : undefined
                            }
                            selectedCount={bulkSelectedCount}
                            selectionSummary={m.media_bulk_selected({
                                count: bulkSelectedCount,
                            })}
                            toggleAllLabel={
                                visibleReadyAssets.length > 0
                                    ? allVisibleBulkSelected
                                        ? m.media_bulk_clear_visible()
                                        : m.media_bulk_select_visible()
                                    : undefined
                            }
                        />
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
                {!manageOnly ? (
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
                                compact ? openAttachmentLibrary() : openSourcePicker()
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
                ) : null}

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

                {loading && assets.length === 0 ? (
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
                    ) : manageOnly ? null : (
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
                    <MediaAssetCollection
                        assets={assets}
                        className={`${manageOnly ? '' : 'mt-4 '}${
                            manageOnly ? mediaLibraryGridClass(mediaViewMode) : 'sm:grid-cols-2'
                        }`}
                        interactionDisabled={interactionLocked}
                        layout={manageOnly ? mediaViewMode : 'list'}
                        onAccessibilityTextChange={updateAccessibilityText}
                        onActionSelectionToggle={toggleBulkAsset}
                        onDownload={manageOnly ? downloadAsset : undefined}
                        onEdit={manageOnly ? openEditor : undefined}
                        onInfo={manageOnly ? openInformation : undefined}
                        onOpen={manageOnly ? openViewer : undefined}
                        onPreview={openViewer}
                        onRequestDelete={manageOnly ? openDeletion : undefined}
                        onToggle={toggleAsset}
                        projectId={projectId}
                        selectable={!manageOnly}
                        selectedAssetById={selectedAssetById}
                        actionSelectedAssetIds={bulkSelectedAssetIds}
                        actionSelectionEnabled={manageOnly && bulkSelectionMode}
                        showActions={manageOnly}
                        viewMode={manageOnly ? mediaViewMode : undefined}
                    />
                )}

                {!compact && !loading && assets.length > 0 && nextCursor !== null ? (
                    <div ref={loadMoreSentinelRef} className="mt-4 flex justify-center">
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

                {manageOnly ? (
                    <div
                        data-media-drop-hint="true"
                        className={
                            dragActive
                                ? 'mt-auto flex flex-col items-center gap-2 pt-16 pb-4 text-center text-sm text-primary transition-colors'
                                : 'mt-auto flex flex-col items-center gap-2 pt-16 pb-4 text-center text-sm text-muted-foreground transition-colors'
                        }>
                        <GalleryAddIcon aria-hidden="true" className="size-8" />
                        <p>
                            {dragActive ? m.media_drop_files_active() : m.media_drop_files()}{' '}
                            {m.media_drop_files_hint()}{' '}
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                disabled={interactionLocked}
                                className="h-auto p-0 align-baseline text-sm font-medium"
                                onClick={openSourcePicker}>
                                {uploading === null
                                    ? m.media_browse_files()
                                    : m.media_uploading({ filename: uploading })}
                            </Button>
                        </p>
                        <p className="text-xs text-muted-foreground">{m.media_supported_types()}</p>
                    </div>
                ) : null}
            </div>

            {compact ? (
                <MediaAttachmentLibraryDialog
                    assets={assets}
                    emptyDescription={emptyDescription}
                    error={error}
                    interactionDisabled={interactionLocked}
                    loadMoreSentinelRef={loadMoreSentinelRef}
                    loading={loading}
                    loadingMore={loadingMore}
                    mediaDateFilter={mediaDateFilter}
                    mediaFamilyFilter={mediaFamilyFilter}
                    mediaSort={mediaSort}
                    mediaViewMode={mediaViewMode}
                    nextCursor={nextCursor}
                    onConfirm={confirmAttachmentSelection}
                    onDateChange={setMediaDateFilter}
                    onFamilyChange={setMediaFamilyFilter}
                    onLoadMore={loadMoreAssets}
                    onOpenChange={handleAttachmentLibraryOpenChange}
                    onPreview={openViewer}
                    onSearchQueryChange={handleSearchQueryChange}
                    onSortChange={setMediaSort}
                    onToggle={toggleLibraryAsset}
                    onUpload={openSourcePicker}
                    onViewModeChange={setMediaViewMode}
                    open={libraryOpen}
                    projectId={projectId}
                    scrollRef={attachmentScrollRef}
                    selectedAssetById={attachmentSelectedAssetById}
                    searchPending={searchPending}
                    searchQuery={searchQuery}
                    totalAssets={totalAssets}
                    uploading={uploading}
                />
            ) : null}
            <MediaSourcePickerDialog
                disabled={interactionLocked}
                onDevice={openDevicePicker}
                onWebcam={openWebcamPicker}
                onImportUrl={importMediaFromUrl}
                onOpenChange={open => {
                    setSourcePickerOpen(open)
                    if (!open && !urlImportPending) setUrlImportError(null)
                }}
                open={sourcePickerOpen}
                sources={mediaSources}
                sourcesLoading={mediaSourcesLoading}
                urlImportError={urlImportError}
                urlImportPending={urlImportPending}
            />
            <MediaWebcamDialog
                disabled={interactionLocked}
                onCapture={captureWebcamFile}
                onOpenChange={setWebcamOpen}
                open={webcamOpen}
            />
            <Suspense fallback={null}>
                {viewerAsset !== null ? (
                    <MediaViewer
                        assets={viewerAssets}
                        asset={viewerAsset}
                        allowDelete={manageOnly}
                        open
                        onOpenChange={open => {
                            if (!open) closeViewer()
                        }}
                        onAssetChange={setViewerAsset}
                        onEdit={viewerAllowsFileActions ? openEditor : undefined}
                        onRequestDelete={manageOnly ? openDeletion : undefined}
                    />
                ) : null}
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
            <MediaDeletionDialog
                asset={deletionAsset}
                error={deletionError}
                onConfirm={() => void confirmDeletion()}
                onOpenChange={open => {
                    if (!open && !deletionPending) {
                        setDeletionAsset(null)
                        setDeletionError(null)
                    }
                }}
                open={deletionAsset !== null}
                pending={deletionPending}
            />
            <MediaBulkDeletionDialog
                assets={bulkDeletionAssets}
                error={bulkDeletionError}
                onConfirm={() => void confirmBulkDeletion()}
                onOpenChange={open => {
                    if (!open && !bulkDeletionPending) {
                        setBulkDeletionAssets([])
                        setBulkDeletionError(null)
                    }
                }}
                open={bulkDeletionAssets.length > 0}
                pending={bulkDeletionPending}
            />
            <MediaInformationDialog
                asset={informationAsset}
                onOpenChange={open => {
                    if (!open) setInformationAsset(null)
                }}
                open={informationAsset !== null}
            />
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

function mergeMediaAssets(
    current: readonly MediaReference[],
    additions: readonly MediaReference[]
): MediaReference[] {
    const byId = new Map(current.map(asset => [asset.asset.id, asset]))
    for (const asset of additions) byId.set(asset.asset.id, asset)
    return [...byId.values()]
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

function mediaRestrictionMessage(
    file: HeraldMediaUppyFile | undefined,
    policy: HeraldMediaUploadController['policy'],
    locale: string
) {
    if (
        file !== undefined &&
        file.size !== null &&
        policy.maxFileSize !== null &&
        file.size > policy.maxFileSize
    ) {
        return m.media_upload_rejected_size({
            filename: file.name,
            size: formatBytes(policy.maxFileSize, locale),
        })
    }

    if (file !== undefined) {
        return m.media_upload_rejected_type({
            filename: file.name,
            types: policy.allowedContentTypes.map(mediaContentTypeLabel).join(' · '),
        })
    }

    return m.media_upload_rejected()
}

function mediaContentTypeLabel(contentType: string) {
    const subtype = contentType.split('/', 2)[1]
    return subtype === undefined ? contentType : subtype.toUpperCase()
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
