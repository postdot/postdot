import { expect, type Page } from '@playwright/test'

export const file = {
    name: 'interrupted-pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    ),
}

export async function waitForStoredUpload(page: Page, ownerId: string) {
    await expect
        .poll(() =>
            page.evaluate(async owner => {
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const request = indexedDB.open('uppy-blobs')
                    request.onsuccess = () => resolve(request.result)
                    request.onerror = () => reject(request.error)
                })
                try {
                    return await new Promise<boolean>((resolve, reject) => {
                        const request = db.transaction('metadata').objectStore('metadata').getAll()
                        request.onsuccess = () =>
                            resolve(
                                request.result.some(
                                    record =>
                                        String(record.id).includes(owner) &&
                                        String(record.metadata).includes('interrupted-pixel.png')
                                )
                            )
                        request.onerror = () => reject(request.error)
                    })
                } finally {
                    db.close()
                }
            }, ownerId)
        )
        .toBe(true)
}
