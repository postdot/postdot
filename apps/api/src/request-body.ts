export async function readBoundedRequestBytes(
    request: Request,
    maxBytes: number
): Promise<
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly reason: 'empty' | 'too_large' }
> {
    const contentLengthHeader = request.headers.get('content-length')
    if (contentLengthHeader !== null) {
        const declared = Number(contentLengthHeader)
        if (Number.isSafeInteger(declared) && declared > maxBytes) {
            return { ok: false, reason: 'too_large' }
        }
    }
    const reader = request.body?.getReader()
    if (!reader) {
        return { ok: false, reason: 'empty' }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            total += next.value.byteLength
            if (total > maxBytes) {
                await reader.cancel()
                return { ok: false, reason: 'too_large' }
            }
            chunks.push(next.value)
        }
    } finally {
        reader.releaseLock()
    }
    if (total === 0) {
        return { ok: false, reason: 'empty' }
    }
    const combined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.byteLength
    }
    return { ok: true, bytes: combined }
}
