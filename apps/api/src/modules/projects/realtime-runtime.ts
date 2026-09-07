export interface ProjectRealtimeHub {
    waitForChange(projectId: string, signal: AbortSignal): Promise<void>
}

export interface ProjectRealtimeRuntime {
    readonly hub: ProjectRealtimeHub
    publish(projectIds: readonly string[]): void
    stop(): void
}

export interface ProjectRealtimeRuntimeOptions {
    readonly onProjectsChanged?: (projectIds: readonly string[]) => void
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
    const waiters = new Map<string, Set<Waiter>>()
    let stopped = false

    function removeWaiter(projectId: string, waiter: Waiter): void {
        const projectWaiters = waiters.get(projectId)
        if (projectWaiters === undefined) return
        projectWaiters.delete(waiter)
        if (projectWaiters.size === 0) waiters.delete(projectId)
    }

    function waitForChange(projectId: string, signal: AbortSignal): Promise<void> {
        if (stopped || signal.aborted) return Promise.resolve()

        return new Promise(resolve => {
            const waiter: Waiter = {
                resolve: () => {
                    signal.removeEventListener('abort', onAbort)
                    removeWaiter(projectId, waiter)
                    resolve()
                },
            }
            const onAbort = () => waiter.resolve()
            const projectWaiters = waiters.get(projectId) ?? new Set<Waiter>()
            projectWaiters.add(waiter)
            waiters.set(projectId, projectWaiters)
            signal.addEventListener('abort', onAbort, { once: true })
        })
    }

    function notify(projectIds: readonly string[]): void {
        for (const projectId of projectIds) {
            const projectWaiters = waiters.get(projectId)
            if (projectWaiters === undefined) continue
            for (const waiter of projectWaiters) waiter.resolve()
        }
    }

    function reportError(error: unknown): void {
        try {
            options.onError?.(error)
        } catch (reportingError) {
            console.error('[herald-realtime] error handler failed', reportingError)
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
        notify(uniqueProjectIds)
    }

    function stop(): void {
        if (stopped) return
        stopped = true
        for (const [projectId, projectWaiters] of waiters) {
            for (const waiter of projectWaiters) waiter.resolve()
            waiters.delete(projectId)
        }
    }

    return {
        hub: { waitForChange },
        publish,
        stop,
    }
}
