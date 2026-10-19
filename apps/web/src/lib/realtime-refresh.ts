export interface RefreshScope {
    readonly full: boolean
    readonly includePublicationEditors: boolean
}

/** Merge overlapping signals, then replay if state changed during an in-flight read. */
export function createRealtimeRefreshQueue(
    run: (key: string, scope: RefreshScope) => Promise<void>
) {
    const pending = new Map<
        string,
        { scope: RefreshScope; revision: number; operation: Promise<void> }
    >()

    return (key: string, full = false, includePublicationEditors = false): Promise<void> => {
        const existing = pending.get(key)
        if (existing) {
            existing.scope = {
                full: existing.scope.full || full,
                includePublicationEditors:
                    existing.scope.includePublicationEditors || includePublicationEditors,
            }
            existing.revision++
            return existing.operation
        }

        const entry = {
            scope: { full, includePublicationEditors },
            revision: 0,
            operation: Promise.resolve(),
        }
        pending.set(key, entry)
        entry.operation = Promise.resolve()
            .then(async () => {
                let revision: number
                do {
                    revision = entry.revision
                    await run(key, entry.scope)
                } while (revision !== entry.revision)
            })
            .finally(() => pending.delete(key))
        return entry.operation
    }
}
