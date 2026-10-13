import type { MediaImportSource } from '@postbot/client'
import { Alert, AlertDescription } from '@postbot/ui/components/alert'
import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Input } from '@postbot/ui/components/input'
import { CameraIcon } from '@solar-icons/react/linear/camera'
import { FolderOpenIcon } from '@solar-icons/react/linear/folder-open'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { UploadIcon } from '@solar-icons/react/linear/upload'
import { useEffect, useState } from 'react'

import * as m from '@/paraglide/messages.js'

export interface MediaSourcePickerDialogProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly sources: readonly MediaImportSource[]
    readonly sourcesLoading: boolean
    readonly disabled: boolean
    readonly urlImportPending: boolean
    readonly urlImportError: string | null
    readonly onDevice: () => void
    readonly onWebcam: () => void
    readonly onImportUrl: (url: string) => Promise<void>
}

export function MediaSourcePickerDialog({
    open,
    onOpenChange,
    sources,
    sourcesLoading,
    disabled,
    urlImportPending,
    urlImportError,
    onDevice,
    onWebcam,
    onImportUrl,
}: MediaSourcePickerDialogProps) {
    const [selectedSource, setSelectedSource] = useState<MediaImportSource['id'] | null>(null)
    const [url, setUrl] = useState('')

    useEffect(() => {
        if (!open) {
            setSelectedSource(null)
            setUrl('')
        }
    }, [open])

    const hasDeviceSource = sources.some(source => source.id === 'device')
    const hasWebcamSource = sources.some(source => source.id === 'webcam')
    const hasUrlSource = sources.some(source => source.id === 'url')

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-x-hidden overflow-y-auto sm:max-w-md"
                data-media-source-picker="true">
                <DialogHeader>
                    <DialogTitle>{m.media_source_picker_title()}</DialogTitle>
                    <DialogDescription>{m.media_source_picker_description()}</DialogDescription>
                </DialogHeader>

                <div
                    className="grid gap-1"
                    role="list"
                    aria-busy={sourcesLoading}
                    aria-label={m.media_sources_label()}>
                    {hasDeviceSource ? (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={disabled}
                            data-media-source="device"
                            className="h-auto min-w-0 w-full justify-start gap-3 px-3 py-3 text-left"
                            onClick={onDevice}>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                                <FolderOpenIcon aria-hidden="true" />
                            </span>
                            <span className="min-w-0 whitespace-normal break-words">
                                <span className="block text-sm font-medium">
                                    {m.media_source_device()}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {m.media_source_device_description()}
                                </span>
                            </span>
                        </Button>
                    ) : null}
                    {hasWebcamSource ? (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={disabled}
                            data-media-source="webcam"
                            className="h-auto min-w-0 w-full justify-start gap-3 px-3 py-3 text-left"
                            onClick={onWebcam}>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                                <CameraIcon aria-hidden="true" />
                            </span>
                            <span className="min-w-0 whitespace-normal break-words">
                                <span className="block text-sm font-medium">
                                    {m.media_source_webcam()}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {m.media_source_webcam_description()}
                                </span>
                            </span>
                        </Button>
                    ) : null}
                    {hasUrlSource ? (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={disabled || urlImportPending}
                            data-media-source="url"
                            aria-pressed={selectedSource === 'url'}
                            className="h-auto min-w-0 w-full justify-start gap-3 px-3 py-3 text-left"
                            onClick={() => setSelectedSource('url')}>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                                <LinkIcon aria-hidden="true" />
                            </span>
                            <span className="min-w-0 whitespace-normal break-words">
                                <span className="block text-sm font-medium">
                                    {m.media_source_url()}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {m.media_source_url_description()}
                                </span>
                            </span>
                        </Button>
                    ) : null}
                </div>

                {selectedSource === 'url' ? (
                    <form
                        className="grid gap-3"
                        onSubmit={event => {
                            event.preventDefault()
                            if (url.trim() === '' || urlImportPending) return
                            void onImportUrl(url)
                        }}>
                        <div className="grid gap-1.5">
                            <label className="text-sm font-medium" htmlFor="media-source-url">
                                {m.media_source_url_label()}
                            </label>
                            <Input
                                id="media-source-url"
                                type="url"
                                value={url}
                                autoFocus
                                disabled={disabled || urlImportPending}
                                placeholder={m.media_source_url_placeholder()}
                                onChange={event => setUrl(event.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                {m.media_source_url_hint()}
                            </p>
                        </div>
                        {urlImportError !== null ? (
                            <Alert variant="destructive">
                                <AlertDescription>{urlImportError}</AlertDescription>
                            </Alert>
                        ) : null}
                        <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-end">
                            <Button
                                type="submit"
                                disabled={disabled || url.trim() === '' || urlImportPending}>
                                <UploadIcon aria-hidden="true" />
                                {urlImportPending
                                    ? m.media_source_url_importing()
                                    : m.media_source_url_import()}
                            </Button>
                        </DialogFooter>
                    </form>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
