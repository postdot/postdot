import type { EventJournalCursor, EventJournalEntry, EventJournalStore } from '@herald/db'

const defaultPollIntervalMs = 250
const defaultBatchSize = 500

export interface ProjectRealtimeHub {
    waitForChange(projectId: string, signal: AbortSignal): Promise<void>
}

export interface ProjectRealtimeRuntime {
    readonly hub: ProjectRealtimeHub
    stop(): void
}

export interface ProjectRealtimeRuntimeOptions {
    readonly pollIntervalMs?: number
    readonly batchSize?: number
    readonly onProjectsChanged?: (projectIds: readonly string[]) => void
    readonly onError?: (error: unknown) => void
}

interface Waiter {
    readonly resolve: () => void
}

export function createProjectRealtimeRuntime(
    journal: Pick<EventJournalStore, 'readAfterGlobal' | 'latestCursor'>,
    options: ProjectRealtimeRuntimeOptions = {}
): ProjectRealtimeRuntime {
    const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs
    const batchSize = options.batchSize ?? defaultBatchSize
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
        throw new Error('Project realtime poll interval must be a positive safe integer')
    }
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
        throw new Error('Project realtime batch size must be a positive safe integer')
    }

    const waiters = new Map<string, Set<Waiter>>()
    let scanCursor: EventJournalCursor | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let scanning = false

    function activeWaiterCount(): number {
        let count = 0
        for (const projectWaiters of waiters.values()) count += projectWaiters.size
        return count
    }

    function scheduleScan(delayMs: number): void {
        if (stopped || timer !== undefined || activeWaiterCount() === 0) return
        timer = setTimeout(() => {
            timer = undefined
            void scan()
        }, delayMs)
    }

    async function scan(): Promise<void> {
        if (stopped || scanning || activeWaiterCount() === 0) return
        scanning = true
        try {
            const entries = journal.readAfterGlobal({ after: scanCursor, limit: batchSize })
            if (entries.length > 0) {
                scanCursor = entries.at(-1)?.cursor ?? scanCursor
                const projectIds = uniqueProjectIds(entries)
                try {
                    options.onProjectsChanged?.(projectIds)
                } catch (error) {
                    options.onError?.(error)
                }
                notify(projectIds)
                if (entries.length >= batchSize) {
                    queueMicrotask(() => void scan())
                    return
                }
            }
        } catch (error) {
            options.onError?.(error)
        } finally {
            scanning = false
        }

        scheduleScan(pollIntervalMs)
    }

    function ensureScanning(): void {
        if (scanCursor === null) scanCursor = journal.latestCursor()
        if (timer === undefined && !scanning) void scan()
    }

    function removeWaiter(projectId: string, waiter: Waiter): void {
        const projectWaiters = waiters.get(projectId)
        if (projectWaiters === undefined) return
        projectWaiters.delete(waiter)
        if (projectWaiters.size === 0) waiters.delete(projectId)
        if (activeWaiterCount() === 0 && timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
        }
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
            const onAbort = () => resolveWaiter(projectId, waiter)
            const projectWaiters = waiters.get(projectId) ?? new Set<Waiter>()
            projectWaiters.add(waiter)
            waiters.set(projectId, projectWaiters)
            signal.addEventListener('abort', onAbort, { once: true })
            ensureScanning()
        })
    }

    function resolveWaiter(projectId: string, waiter: Waiter): void {
        waiter.resolve()
    }

    function notify(projectIds: readonly string[]): void {
        for (const projectId of projectIds) {
            const projectWaiters = waiters.get(projectId)
            if (projectWaiters === undefined) continue
            for (const waiter of projectWaiters) waiter.resolve()
        }
    }

    function stop(): void {
        if (stopped) return
        stopped = true
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        for (const [projectId, projectWaiters] of waiters) {
            for (const waiter of projectWaiters) waiter.resolve()
            waiters.delete(projectId)
        }
    }

    return {
        hub: { waitForChange },
        stop,
    }
}

function uniqueProjectIds(entries: readonly EventJournalEntry[]): readonly string[] {
    return [...new Set(entries.map(entry => entry.projectId))]
}
