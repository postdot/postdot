import type { MediaStore } from '@herald/media'

export const imagePreviewProcessor = 'herald-image-preview'
export const imagePreviewVersion = '1'
export const imagePreviewPresets = { thumbnail: 256, preview: 768 } as const
export type ImagePreviewVariant = keyof typeof imagePreviewPresets

// Serialize decoding, not upload streams: only one full image is decoded at a time.
let processing = Promise.resolve()
export async function generateImagePreviews(
    store: MediaStore,
    objectKey: string,
    consume: (
        variant: ImagePreviewVariant,
        blob: Blob,
        width: number,
        height: number,
        placeholder: string
    ) => Promise<void>,
    variants: readonly ImagePreviewVariant[] = Object.keys(
        imagePreviewPresets
    ) as ImagePreviewVariant[]
): Promise<void> {
    const previous = processing
    let release!: () => void
    processing = new Promise<void>(resolve => {
        release = resolve
    })
    await previous
    try {
        const opened = await store.open(objectKey, { maxBytes: store.maxObjectBytes })
        if (opened === null) throw new Error('Image source unavailable')
        const source = await new Response(opened.stream).blob()
        const placeholder = await new Bun.Image(source).placeholder()
        for (const variant of variants) {
            const dimension = imagePreviewPresets[variant]
            const blob = await new Bun.Image(source)
                .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .blob()
            const metadata = await new Bun.Image(blob).metadata()
            await consume(variant, blob, metadata.width, metadata.height, placeholder)
        }
    } finally {
        release()
    }
}
