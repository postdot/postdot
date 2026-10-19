export interface RealtimeHub {
    waitForChange(projectId: string, signal: AbortSignal): Promise<void>
    /**
     * Registers a listener that runs when the runtime stops.
     *
     * The listener runs at once when the runtime has already stopped, so a
     * stream opened after the shutdown never waits for a wakeup that cannot
     * come. The returned function removes the listener.
     */
    subscribeShutdown?(listener: () => void): () => void
}

export interface DraftChangeSignal {
    readonly projectId: string
    readonly postId: string
    readonly publicationId: string
    readonly sourceChanged: boolean
}

export interface ProjectRealtimeHub extends RealtimeHub {
    subscribeDraftChanges?(
        projectId: string,
        listener: (change: DraftChangeSignal) => void
    ): () => void
    publishDraftChange?(change: DraftChangeSignal): void
}
export interface UserRealtimeHub extends RealtimeHub {}

export interface ProjectRealtimeRuntime {
    readonly hub: ProjectRealtimeHub
    readonly userHub: UserRealtimeHub
    publish(projectIds: readonly string[]): void
    publishUsers(userIds: readonly string[]): void
    stop(): void
}

export interface ProjectRealtimeRuntimeOptions {
    readonly onProjectsChanged?: (projectIds: readonly string[]) => void
    readonly resolveUserIdsForProjects?: (projectIds: readonly string[]) => readonly string[]
    readonly onError?: (error: unknown) => void
}

interface Waiter {
    readonly resolve: () => void
}

/**
 * Process-local wakeup hub for the durable project event stream.
 *
 * The database layer calls publish only after an audit-event transaction has
 * committed. The hub carries no facts and is never the source of truth: an
 * SSE stream always rereads its project's durable journal after this signal.
 */
export function createProjectRealtimeRuntime(
    options: ProjectRealtimeRuntimeOptions = {}
): ProjectRealtimeRuntime {
    const draftListeners = new Map<string, Set<(change: DraftChangeSignal) => void>>()
    const projectWaiters = new Map<string, Set<Waiter>>()
    const userWaiters = new Map<string, Set<Waiter>>()
    const shutdownListeners = new Set<() => void>()
    let stopped = false

    function removeWaiter(
        waiterMap: Map<string, Set<Waiter>>,
        scopeId: string,
        waiter: Waiter
    ): void {
        const scopedWaiters = waiterMap.get(scopeId)
        if (scopedWaiters === undefined) return
        scopedWaiters.delete(waiter)
        if (scopedWaiters.size === 0) waiterMap.delete(scopeId)
    }

    function waitForChange(
        waiterMap: Map<string, Set<Waiter>>,
        scopeId: string,
        signal: AbortSignal
    ): Promise<void> {
        if (stopped || signal.aborted) return Promise.resolve()

        return new Promise(resolve => {
            const waiter: Waiter = {
                resolve: () => {
                    signal.removeEventListener('abort', onAbort)
                    removeWaiter(waiterMap, scopeId, waiter)
                    resolve()
                },
            }
            const onAbort = () => waiter.resolve()
            const scopedWaiters = waiterMap.get(scopeId) ?? new Set<Waiter>()
            scopedWaiters.add(waiter)
            waiterMap.set(scopeId, scopedWaiters)
            signal.addEventListener('abort', onAbort, { once: true })
        })
    }

    function notify(waiterMap: Map<string, Set<Waiter>>, scopeIds: readonly string[]): void {
        for (const scopeId of scopeIds) {
            const scopedWaiters = waiterMap.get(scopeId)
            if (scopedWaiters === undefined) continue
            for (const waiter of scopedWaiters) waiter.resolve()
        }
    }

    function resolveUserIds(projectIds: readonly string[]): readonly string[] {
        if (options.resolveUserIdsForProjects === undefined) return []
        try {
            return [
                ...new Set(
                    options
                        .resolveUserIdsForProjects(projectIds)
                        .filter(userId => userId.length > 0)
                ),
            ]
        } catch (error) {
            reportError(error)
            return []
        }
    }

    function reportError(error: unknown): void {
        try {
            options.onError?.(error)
        } catch (reportingError) {
            console.error('[postbot-realtime] error handler failed', reportingError)
        }
    }

    function subscribeShutdown(listener: () => void): () => void {
        if (stopped) {
            listener()
            return () => {}
        }
        shutdownListeners.add(listener)
        return () => {
            shutdownListeners.delete(listener)
        }
    }

    function notifyShutdown(): void {
        const listeners = [...shutdownListeners]
        shutdownListeners.clear()
        for (const listener of listeners) {
            try {
                listener()
            } catch (error) {
                reportError(error)
            }
        }
    }

    function publish(projectIds: readonly string[]): void {
        if (stopped) return
        const uniqueProjectIds = [...new Set(projectIds.filter(projectId => projectId.length > 0))]
        if (uniqueProjectIds.length === 0) return

        try {
            options.onProjectsChanged?.(uniqueProjectIds)
        } catch (error) {
            reportError(error)
        }
        notify(projectWaiters, uniqueProjectIds)
        notify(userWaiters, resolveUserIds(uniqueProjectIds))
    }

    function publishUsers(userIds: readonly string[]): void {
        if (stopped) return
        const uniqueUserIds = [...new Set(userIds.filter(userId => userId.length > 0))]
        if (uniqueUserIds.length === 0) return
        notify(userWaiters, uniqueUserIds)
    }

    function stop(): void {
        if (stopped) return
        stopped = true
        // The served streams are told first. A stream that waits for a wakeup
        // must end before its waiter is resolved, or it would read the journal
        // again and wait for a change that is never published.
        notifyShutdown()
        draftListeners.clear()
        for (const [projectId, waiters] of projectWaiters) {
            for (const waiter of waiters) waiter.resolve()
            projectWaiters.delete(projectId)
        }
        for (const [userId, waiters] of userWaiters) {
            for (const waiter of waiters) waiter.resolve()
            userWaiters.delete(userId)
        }
    }

    return {
        hub: {
            subscribeDraftChanges: (projectId, listener) => {
                const listeners = draftListeners.get(projectId) ?? new Set()
                listeners.add(listener)
                draftListeners.set(projectId, listeners)
                return () => {
                    listeners.delete(listener)
                    if (listeners.size === 0) draftListeners.delete(projectId)
                }
            },
            publishDraftChange: change => {
                if (stopped) return
                for (const listener of draftListeners.get(change.projectId) ?? []) {
                    try {
                        listener(change)
                    } catch (error) {
                        reportError(error)
                    }
                }
                notify(projectWaiters, [change.projectId])
            },
            waitForChange: (projectId, signal) => waitForChange(projectWaiters, projectId, signal),
            subscribeShutdown,
        },
        userHub: {
            waitForChange: (userId, signal) => waitForChange(userWaiters, userId, signal),
            subscribeShutdown,
        },
        publish,
        publishUsers,
        stop,
    }
}
