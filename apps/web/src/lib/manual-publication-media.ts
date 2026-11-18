/**
 * Helpers for carrying a manual publication's media out of Postdot: the person recreates the
 * post by hand on the platform, so each file must be copyable or downloadable as prepared.
 */

/**
 * Browsers only put PNG images on the clipboard reliably, so other still images are converted.
 * Animated GIFs would lose their animation and videos cannot be copied: both are downloaded.
 */
export function isCopyableImage(contentType: string | null | undefined): boolean {
    if (!contentType) return false
    const type = contentType.toLowerCase()
    return type.startsWith('image/') && type !== 'image/gif' && type !== 'image/svg+xml'
}

export function canCopyImages(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.ClipboardItem === 'function' &&
        typeof navigator.clipboard?.write === 'function'
    )
}

/** The image at `url` as a PNG blob, converting through a canvas when it is another format. */
export async function fetchAsPng(url: string): Promise<Blob> {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`media_fetch_failed_${response.status}`)
    const blob = await response.blob()
    if (blob.type === 'image/png') return blob
    const bitmap = await createImageBitmap(blob)
    try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('canvas_unavailable')
        context.drawImage(bitmap, 0, 0)
        return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
                result => (result ? resolve(result) : reject(new Error('png_encoding_failed'))),
                'image/png'
            )
        )
    } finally {
        bitmap.close()
    }
}

/**
 * Put the image on the clipboard. The blob is handed over as a promise so Safari still sees the
 * write as part of the click that started it.
 */
export async function copyImageToClipboard(url: string): Promise<void> {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetchAsPng(url) })])
}

export function downloadFile(url: string, filename: string): void {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noreferrer'
    document.body.append(link)
    link.click()
    link.remove()
}

/** Whether the device can hand files to another app (the share sheet of a phone). */
export function canShareFiles(): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
    try {
        return navigator.canShare({
            files: [new File([''], 'probe.png', { type: 'image/png' })],
        })
    } catch {
        return false
    }
}

export async function fetchAsFile(url: string, filename: string): Promise<File> {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`media_fetch_failed_${response.status}`)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type })
}
