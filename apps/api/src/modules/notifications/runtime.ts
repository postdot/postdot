import type { NotificationStore } from '@postdot/db'

const maximumBatchesPerProject = 10
const continuationDelayMs = 0
const defaultRecoveryDelayMs = 1_000

export type NotificationProjectionRuntimeState =
    | 'idle'
    | 'started'
    | 'running'
    | 'recovering'
    | 'stopped'
    | 'failed'

export interface NotificationProjectionRuntime {
    readonly state: NotificationProjectionRuntimeState
    start(): void
    stop(): Promise<void>
    /** Resolves when a projection run covering this request has finished. */
    runNow(): Promise<void>
    /** Resolves when a projection run covering these projects has finished. */
    runProjects(projectIds: readonly string[]): Promise<void>
}

export interface NotificationProjectionRuntimeOptions {
    /** Optional recovery timer; normal production updates arrive post-commit. */
    readonly intervalMs?: number
    readonly onError?: (error: unknown) => void
}

export function createNotificationProjectionRuntime(
    notifications: Pick<NotificationStore, 'listProjectIds' | 'project'>,
    options: NotificationProjectionRuntimeOptions = {}
): NotificationProjectionRuntime {
    const intervalMs = options.intervalMs
    if (intervalMs !== undefined && (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)) {
        throw new Error('Notification projection interval must be a positive safe integer')
    }

    let intervalTimer: ReturnType<typeof setInterval> | undefined
    let continuationTimer: ReturnType<typeof setTimeout> | undefined
    let continuationProjectIds: Set<string> | null | undefined
    let started = false
    let running = false
    let recoveryRequired = false
    let state: NotificationProjectionRuntimeState = 'idle'
    const handleError = options.onError ?? defaultNotificationProjectionErrorHandler
    // Requests that arrive while a run is in progress (post-commit wakeups)
    // are merged and replayed once it finishes; null means every project.
    let queuedProjectIds: Set<string> | null | undefined
    let queuedRun: Promise<void> | undefined
    let releaseQueuedRun: (() => void) | undefined
    const pendingRuns = new Set<Promise<void>>()

    const enqueue = (projectIds?: readonly string[]): Promise<void> => {
        if (projectIds === undefined) queuedProjectIds = null
        else if (queuedProjectIds === undefined) queuedProjectIds = new Set(projectIds)
        else if (queuedProjectIds !== null)
            for (const projectId of projectIds) queuedProjectIds.add(projectId)
        queuedRun ??= new Promise<void>(resolve => {
            releaseQueuedRun = resolve
        })
        return queuedRun
    }

    // Never rejects: failures are reported and scheduled for recovery.
    const project = (projectIds?: readonly string[]): Promise<void> => {
        const run = performProjection(projectIds)
        pendingRuns.add(run)
        void run.finally(() => pendingRuns.delete(run))
        return run
    }

    const performProjection = async (projectIds?: readonly string[]): Promise<void> => {
        if (running) return enqueue(projectIds)
        running = true
        state = recoveryRequired ? 'recovering' : 'running'
        let needsContinuation = false
        try {
            for (const projectId of projectIds ?? (await notifications.listProjectIds())) {
                let batches = 0
                let hasMore = false
                do {
                    hasMore = (await notifications.project(projectId)).hasMore
                    batches += 1
                } while (hasMore && batches < maximumBatchesPerProject)
                if (hasMore) needsContinuation = true
            }
            recoveryRequired = needsContinuation
            if (needsContinuation) {
                state = started ? 'recovering' : 'idle'
                scheduleContinuation(projectIds, continuationDelayMs)
            } else {
                cancelContinuation()
                state = started ? 'started' : 'idle'
            }
        } catch (error) {
            recoveryRequired = true
            state = 'failed'
            handleError(error)
            scheduleContinuation(projectIds, intervalMs ?? defaultRecoveryDelayMs)
        } finally {
            running = false
        }
        if (queuedProjectIds !== undefined) {
            const next = queuedProjectIds
            const release = releaseQueuedRun
            queuedProjectIds = undefined
            queuedRun = undefined
            releaseQueuedRun = undefined
            await project(next === null ? undefined : [...next])
            release?.()
        }
    }

    function scheduleContinuation(projectIds: readonly string[] | undefined, delayMs: number) {
        if (!started) return

        if (projectIds === undefined) {
            continuationProjectIds = null
        } else if (continuationProjectIds === undefined) {
            continuationProjectIds = new Set(projectIds)
        } else if (continuationProjectIds !== null) {
            for (const projectId of projectIds) continuationProjectIds.add(projectId)
        }

        if (continuationTimer !== undefined) return
        continuationTimer = setTimeout(() => {
            continuationTimer = undefined
            const pendingProjectIds = continuationProjectIds
            continuationProjectIds = undefined
            void project(
                pendingProjectIds === null || pendingProjectIds === undefined
                    ? undefined
                    : [...pendingProjectIds]
            )
        }, delayMs)
    }

    function cancelContinuation() {
        if (continuationTimer !== undefined) clearTimeout(continuationTimer)
        continuationTimer = undefined
        continuationProjectIds = undefined
    }

    return {
        get state() {
            return state
        },
        start() {
            if (started) return
            started = true
            if (intervalMs !== undefined)
                intervalTimer = setInterval(() => void project(), intervalMs)
            state = recoveryRequired ? 'recovering' : 'started'
            queueMicrotask(() => {
                if (started) void project()
            })
        },
        async stop() {
            if (intervalTimer !== undefined) clearInterval(intervalTimer)
            intervalTimer = undefined
            cancelContinuation()
            started = false
            state = 'stopped'
            await Promise.all(pendingRuns)
            cancelContinuation()
            state = 'stopped'
        },
        runNow: () => project(),
        runProjects: (projectIds: readonly string[]) => project([...new Set(projectIds)]),
    }
}

function defaultNotificationProjectionErrorHandler(error: unknown): void {
    console.error('[postdot-notifications] projection failed', error)
}
