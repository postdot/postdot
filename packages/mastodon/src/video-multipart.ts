import type { MastodonMediaInput } from './contract'

/** Stream the bounded video instead of materializing a complete multipart Blob. */
export function createVideoMultipart(input: MastodonMediaInput) {
    const boundary = `herald-${crypto.randomUUID()}`
    const filename = input.filename.replace(/["\r\n\\]/g, '_')
    const encoder = new TextEncoder()
    const prefix = encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${input.accessibilityText}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`
    )
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`)
    const openReader = () => input.stream.getReader()
    let reader: ReturnType<typeof openReader> | null = null
    let sent = 0
    let started = false
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                if (!started) {
                    started = true
                    controller.enqueue(prefix)
                    return
                }
                reader ??= openReader()
                const chunk = await reader.read()
                if (chunk.done) {
                    if (sent !== input.size) throw new Error('Video size changed')
                    controller.enqueue(suffix)
                    controller.close()
                    reader.releaseLock()
                    reader = null
                    return
                }
                sent += chunk.value.length
                if (sent > input.size) throw new Error('Video size changed')
                controller.enqueue(chunk.value)
            } catch (error) {
                if (reader !== null) {
                    await reader.cancel().catch(() => undefined)
                    reader.releaseLock()
                    reader = null
                }
                controller.error(error)
            }
        },
        async cancel() {
            if (reader === null) await input.stream.cancel()
            else {
                await reader.cancel()
                reader.releaseLock()
                reader = null
            }
        },
    })
    return {
        contentType: `multipart/form-data; boundary=${boundary}`,
        size: prefix.length + input.size + suffix.length,
        stream,
    }
}
