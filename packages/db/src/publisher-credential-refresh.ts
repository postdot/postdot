import type { DatabaseHandle } from './client'

/**
 * Serializes network refreshes of one publisher credential across every
 * Postdot process on the database (ADR-097 §7): providers that rotate refresh
 * tokens invalidate the loser of two concurrent refreshes. Independent
 * credentials never wait for each other. An aborted caller stops waiting at
 * once; its operation never runs.
 */
export async function coordinatePublisherCredentialRefresh<T>(
    database: DatabaseHandle,
    credentialId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
): Promise<T> {
    signal?.throwIfAborted()
    const turn = database.sql.exclusive(`publisher-credential:${credentialId}`, async () => {
        signal?.throwIfAborted()
        return operation()
    })
    if (signal === undefined) return turn
    // The section still ends on its own; an aborted caller does not wait for it.
    turn.catch(() => {})
    let onAbort: (() => void) | undefined
    try {
        return await Promise.race([
            turn,
            new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(signal.reason)
                signal.addEventListener('abort', onAbort, { once: true })
                if (signal.aborted) onAbort()
            }),
        ])
    } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort)
    }
}
