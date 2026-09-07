import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { CloseIcon } from '@solar-icons/react/bold/close'
import { GalleryAddIcon } from '@solar-icons/react/bold/gallery-add'
import { UploadIcon } from '@solar-icons/react/bold/upload'
import { useEffect, useId, useState, type ChangeEvent } from 'react'

import { MediaAssetCard } from '@/components/media-asset-card'
import { api, formatApiError, type MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { MediaVerificationError } from '@/lib/media-errors'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

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
    useLanguage()
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
        <div data-media-picker="true" className="rounded-lg bg-muted p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <GalleryAddIcon aria-hidden="true" />
                        {m.media_attachments_title()}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {m.media_picker_description()}
                    </p>
                </div>
                <Button
                    render={<label htmlFor={inputId} />}
                    nativeButton={false}
                    variant="secondary"
                    size="default"
                    className={interactionDisabled ? 'pointer-events-none opacity-50' : ''}>
                    <UploadIcon aria-hidden="true" />
                    {uploading === null
                        ? m.media_upload()
                        : m.media_uploading({ filename: uploading })}
                </Button>
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
                <Alert variant="destructive" className="mt-4 rounded-md">
                    <AlertTitle>{m.media_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            {loading ? (
                <p className="mt-4 text-sm text-muted-foreground">{m.media_loading()}</p>
            ) : assets.length === 0 ? (
                <Empty className="mt-4 min-h-28 bg-surface-field px-4 py-5">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <GalleryAddIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>{m.media_empty_title()}</EmptyTitle>
                        <EmptyDescription>{m.media_empty_here()}</EmptyDescription>
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
    return formatApiError(error)
}
