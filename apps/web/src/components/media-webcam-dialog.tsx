import { Alert, AlertDescription } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { CameraIcon } from '@solar-icons/react/linear/camera'
import { useEffect, useRef, useState } from 'react'

import * as m from '@/paraglide/messages.js'

export interface MediaWebcamDialogProps {
    readonly open: boolean
    readonly disabled: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onCapture: (file: File) => void | Promise<void>
}

export function MediaWebcamDialog({
    open,
    disabled,
    onOpenChange,
    onCapture,
}: MediaWebcamDialogProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const [cameraReady, setCameraReady] = useState(false)
    const [loading, setLoading] = useState(false)
    const [capturing, setCapturing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) {
            stopStream(streamRef)
            if (videoRef.current !== null) videoRef.current.srcObject = null
            setCameraReady(false)
            setLoading(false)
            setCapturing(false)
            setError(null)
            return
        }

        let active = true
        setCameraReady(false)
        setLoading(true)
        setError(null)

        if (navigator.mediaDevices?.getUserMedia === undefined) {
            setLoading(false)
            setError(m.media_webcam_unsupported())
            return () => {
                active = false
            }
        }

        void navigator.mediaDevices
            .getUserMedia({ audio: false, video: true })
            .then(stream => {
                if (!active) {
                    stopMediaStream(stream)
                    return
                }

                streamRef.current = stream
                const video = videoRef.current
                if (video === null) {
                    stopStream(streamRef)
                    setError(m.media_webcam_unavailable())
                    return
                }

                video.srcObject = stream
                void video.play().catch(() => undefined)
            })
            .catch(caughtError => {
                if (active) setError(webcamErrorMessage(caughtError))
            })
            .finally(() => {
                if (active) setLoading(false)
            })

        return () => {
            active = false
            stopStream(streamRef)
            if (videoRef.current !== null) videoRef.current.srcObject = null
        }
    }, [open])

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen) {
            stopStream(streamRef)
            if (videoRef.current !== null) videoRef.current.srcObject = null
        }
        onOpenChange(nextOpen)
    }

    async function capture() {
        const video = videoRef.current
        if (disabled || capturing || !cameraReady || video === null) return
        if (video.videoWidth <= 0 || video.videoHeight <= 0) {
            setError(m.media_webcam_capture_failed())
            return
        }

        setCapturing(true)
        setError(null)
        try {
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const context = canvas.getContext('2d')
            if (context === null) throw new Error('camera_canvas_unavailable')

            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            const blob = await canvasToJpeg(canvas)
            await onCapture(
                new File([blob], `webcam-${new Date().toISOString().replaceAll(':', '-')}.jpg`, {
                    lastModified: Date.now(),
                    type: 'image/jpeg',
                })
            )
            handleOpenChange(false)
        } catch {
            setError(m.media_webcam_capture_failed())
        } finally {
            setCapturing(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                data-media-webcam-dialog="true"
                className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-2xl">
                <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
                    <DialogTitle className="flex items-center gap-2">
                        <CameraIcon aria-hidden="true" />
                        {m.media_webcam_title()}
                    </DialogTitle>
                    <DialogDescription>{m.media_webcam_description()}</DialogDescription>
                </DialogHeader>

                <div
                    aria-busy={loading}
                    className="relative aspect-video min-h-64 w-full overflow-hidden bg-black">
                    <video
                        ref={videoRef}
                        aria-label={m.media_webcam_description()}
                        autoPlay
                        className={`size-full object-contain transition-opacity ${cameraReady ? 'opacity-100' : 'opacity-0'}`}
                        muted
                        playsInline
                        onCanPlay={() => setCameraReady(true)}
                        onLoadedMetadata={() => setCameraReady(true)}
                    />
                    {loading && error === null ? (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/75">
                            {m.media_webcam_loading()}
                        </div>
                    ) : null}
                </div>

                {error !== null ? (
                    <Alert variant="destructive" className="mx-5 mt-4 sm:mx-6">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                <DialogFooter className="mx-0 mb-0 border-0 bg-surface-inset px-5 py-4 sm:px-6 sm:justify-end">
                    <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                        {m.common_cancel()}
                    </Button>
                    <Button
                        type="button"
                        disabled={
                            disabled || capturing || loading || !cameraReady || error !== null
                        }
                        onClick={() => void capture()}>
                        <CameraIcon aria-hidden="true" />
                        {capturing ? m.media_webcam_capturing() : m.media_webcam_capture()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function stopStream(streamRef: React.MutableRefObject<MediaStream | null>) {
    const stream = streamRef.current
    if (stream === null) return
    stopMediaStream(stream)
    streamRef.current = null
}

function stopMediaStream(stream: MediaStream) {
    for (const track of stream.getTracks()) track.stop()
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => {
                if (blob === null) {
                    reject(new Error('camera_capture_failed'))
                    return
                }
                resolve(blob)
            },
            'image/jpeg',
            0.92
        )
    })
}

function webcamErrorMessage(error: unknown): string {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return m.media_webcam_permission()
    }
    if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        name === 'NotReadableError' ||
        name === 'TrackStartError'
    ) {
        return m.media_webcam_unavailable()
    }
    if (name === 'SecurityError' || name === 'TypeError') {
        return m.media_webcam_unsupported()
    }
    return m.media_webcam_unavailable()
}
