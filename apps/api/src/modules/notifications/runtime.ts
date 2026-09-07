import type { NotificationStore } from '@herald/db'

const maximumBatchesPerProject = 10

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
    stop(): void
    runNow(): void
    runProjects(projectIds: readonly string[]): void
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

    let timer: ReturnType<typeof setInterval> | undefined
    let started = false
    let running = false
    let recoveryRequired = false
    let state: NotificationProjectionRuntimeState = 'idle'
    const handleError = options.onError ?? defaultNotificationProjectionErrorHandler

    const project = (projectIds?: readonly string[]) => {
        if (running) return
        running = true
        state = recoveryRequired ? 'recovering' : 'running'
        try {
            for (const projectId of projectIds ?? notifications.listProjectIds()) {
                let batches = 0
                let hasMore = false
                do {
                    hasMore = notifications.project(projectId).hasMore
                    batches += 1
                } while (hasMore && batches < maximumBatchesPerProject)
            }
            recoveryRequired = false
            state = started ? 'started' : 'idle'
        } catch (error) {
            recoveryRequired = true
            state = 'failed'
            handleError(error)
        } finally {
            running = false
        }
    }

    return {
        get state() {
            return state
        },
        start() {
            if (started) return
            started = true
            if (intervalMs !== undefined) timer = setInterval(project, intervalMs)
            state = recoveryRequired ? 'recovering' : 'started'
            queueMicrotask(() => {
                if (started) project()
            })
        },
        stop() {
            if (timer !== undefined) clearInterval(timer)
            timer = undefined
            started = false
            state = 'stopped'
        },
        runNow: project,
        runProjects(projectIds: readonly string[]) {
            project([...new Set(projectIds)])
        },
    }
}

function defaultNotificationProjectionErrorHandler(error: unknown): void {
    console.error('[herald-notifications] projection failed', error)
}
