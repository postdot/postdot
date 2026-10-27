import type { PostdotDatabase } from './client'

// The server owns one SQLite connection. Separate store facades share its queue;
// independent credentials never wait for each other's network operation.
const queues = new WeakMap<PostdotDatabase['$client'], Map<string, Promise<void>>>()

export async function coordinatePublisherCredentialRefresh<T>(
    database: PostdotDatabase,
    credentialId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
): Promise<T> {
    signal?.throwIfAborted()
    let queue = queues.get(database.$client)
    if (!queue) {
        queue = new Map()
        queues.set(database.$client, queue)
    }
    const previous = queue.get(credentialId) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>(resolve => {
        release = resolve
    })
    const tail = previous.then(() => turn)
    queue.set(credentialId, tail)
    let onAbort: (() => void) | undefined
    try {
        if (signal) {
            await Promise.race([
                previous,
                new Promise<never>((_resolve, reject) => {
                    onAbort = () => reject(signal.reason)
                    signal.addEventListener('abort', onAbort, { once: true })
                    if (signal.aborted) onAbort()
                }),
            ])
        } else await previous
        signal?.throwIfAborted()
        return await operation()
    } finally {
        if (onAbort) signal?.removeEventListener('abort', onAbort)
        release()
        void tail.then(() => {
            if (queue.get(credentialId) === tail) queue.delete(credentialId)
        })
    }
}
