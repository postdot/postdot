import { CheckCircleIcon } from '@solar-icons/react/linear/check-circle'
import { CloseCircleIcon } from '@solar-icons/react/linear/close-circle'
import { CloudUploadIcon } from '@solar-icons/react/linear/cloud-upload'
import { GalleryAddIcon } from '@solar-icons/react/linear/gallery-add'
import { useEffect, useId, useState, type ChangeEvent } from 'react'

import { ApiError, api, type MediaReference } from '@/lib/api'
import type { MediaSelection } from '@/lib/target-media'

export type { MediaSelection } from '@/lib/target-media'

interface MediaAttachmentPickerProps {
    readonly projectId: string
    readonly value: readonly MediaSelection[]
    readonly onChange: (value: MediaSelection[]) => void
    readonly disabled?: boolean
}

export function MediaAttachmentPicker({
    projectId,
    value,
    onChange,
    disabled = false,
}: MediaAttachmentPickerProps) {
    const inputId = useId()
    const [assets, setAssets] = useState<MediaReference[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const interactionDisabled = disabled || uploading !== null

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

    return (
        <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <GalleryAddIcon aria-hidden="true" />
                        Media attachments
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Upload once, then reuse a verified asset across publication targets.
                    </p>
                </div>
                <label
                    htmlFor={inputId}
                    className={`inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-muted ${
                        interactionDisabled
                            ? 'pointer-events-none opacity-50'
                            : 'focus-within:ring-3 focus-within:ring-ring/20'
                    }`}>
                    <CloudUploadIcon aria-hidden="true" />
                    {uploading === null ? 'Upload media' : `Uploading ${uploading}…`}
                </label>
                <input
                    id={inputId}
                    className="sr-only"
                    type="file"
                    multiple
                    disabled={interactionDisabled}
                    onChange={event => void handleFilesSelected(event)}
                />
            </div>

            {error !== null ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                    {error}
                </p>
            ) : null}

            {loading ? (
                <p className="mt-4 text-sm text-muted-foreground">Loading media library…</p>
            ) : assets.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    No verified media assets yet.
                </p>
            ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {assets.map(asset => {
                        const selected = value.find(item => item.assetId === asset.asset.id)
                        const representation = readyRepresentation(asset)
                        return (
                            <article
                                key={asset.asset.id}
                                className={`rounded-lg border bg-background p-3 ${
                                    selected === undefined
                                        ? ''
                                        : 'border-primary/60 ring-1 ring-primary/20'
                                }`}>
                                <button
                                    type="button"
                                    aria-pressed={selected !== undefined}
                                    disabled={interactionDisabled || asset.asset.state !== 'ready'}
                                    onClick={() => toggleAsset(asset)}
                                    className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50">
                                    <MediaPreview
                                        projectId={projectId}
                                        asset={asset}
                                        representation={representation}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">
                                            {asset.asset.originalFilename}
                                        </span>
                                        <span className="mt-1 block text-xs text-muted-foreground">
                                            {mediaSummary(asset, representation)}
                                        </span>
                                    </span>
                                    {selected === undefined ? (
                                        <span className="text-xs text-muted-foreground">Add</span>
                                    ) : (
                                        <CheckCircleIcon
                                            aria-label="Attached"
                                            className="shrink-0 text-primary"
                                        />
                                    )}
                                </button>
                                {selected !== undefined ? (
                                    <label className="mt-3 grid gap-1 text-xs font-medium">
                                        Accessibility text
                                        <input
                                            value={selected.accessibilityText ?? ''}
                                            disabled={interactionDisabled}
                                            onChange={event =>
                                                updateAccessibilityText(
                                                    asset.asset.id,
                                                    event.target.value
                                                )
                                            }
                                            placeholder="Describe this media when needed"
                                            className="h-8 rounded-md border bg-background px-2 text-xs font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                                        />
                                    </label>
                                ) : null}
                            </article>
                        )
                    })}
                </div>
            )}

            {value.some(item => !assets.some(asset => asset.asset.id === item.assetId)) ? (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                    <CloseCircleIcon aria-hidden="true" className="mt-0.5 shrink-0" />
                    <p>Some selected assets are no longer in the current media library.</p>
                </div>
            ) : null}
        </div>
    )
}

function readyRepresentation(asset: MediaReference) {
    return (
        asset.representations.find(
            representation => representation.state === 'ready' && representation.kind === 'original'
        ) ?? asset.representations.find(representation => representation.state === 'ready')
    )
}

function mediaSummary(
    asset: MediaReference,
    representation: ReturnType<typeof readyRepresentation>
) {
    const details = [representation?.detectedContentType ?? representation?.declaredContentType]
    if (representation?.byteSize !== null && representation?.byteSize !== undefined) {
        details.push(formatBytes(representation.byteSize))
    }
    if (
        representation !== undefined &&
        representation.width !== null &&
        representation.height !== null
    ) {
        details.push(`${representation.width}×${representation.height}`)
    }
    if (asset.asset.state !== 'ready') details.push(asset.asset.state)
    return details
        .filter((detail): detail is string => detail !== null && detail !== undefined)
        .join(' · ')
}

function MediaPreview({
    projectId,
    asset,
    representation,
}: {
    readonly projectId: string
    readonly asset: MediaReference
    readonly representation: ReturnType<typeof readyRepresentation>
}) {
    if (representation?.family === 'image') {
        return (
            <img
                src={api.mediaContentUrl(projectId, asset.asset.id)}
                alt=""
                loading="lazy"
                className="size-12 rounded-md border object-cover"
            />
        )
    }
    return (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted text-xs font-semibold uppercase text-muted-foreground">
            {representation?.family?.slice(0, 3) ?? 'file'}
        </span>
    )
}

async function completeMediaUpload(projectId: string, intentId: string): Promise<MediaReference> {
    const finalized = await api.finalizeMediaUpload(projectId, intentId)
    if (finalized.status === 'ready') return finalized.media
    if (finalized.status === 'failed') {
        throw new Error(finalized.media.asset.failureMessage ?? 'Media verification failed')
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(250)
        const media = await api.getMedia(projectId, finalized.media.asset.id)
        if (media.asset.state === 'ready') return media
        if (media.asset.state === 'failed') {
            throw new Error(media.asset.failureMessage ?? 'Media verification failed')
        }
    }

    throw new Error('Media verification is taking longer than expected; refresh the library later')
}

function upsertAssets(current: readonly MediaReference[], additions: readonly MediaReference[]) {
    const byId = new Map(current.map(asset => [asset.asset.id, asset]))
    for (const asset of additions) byId.set(asset.asset.id, asset)
    return [...byId.values()].sort((left, right) => right.asset.createdAt - left.asset.createdAt)
}

function formatBytes(bytes: number) {
    if (bytes < 1_024) return `${bytes} B`
    if (bytes < 1_024 * 1_024) return `${Math.round(bytes / 1_024)} KiB`
    return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`
}

function delay(milliseconds: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The media action could not be completed'
}
