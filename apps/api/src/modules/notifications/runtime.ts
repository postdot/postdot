import type { NotificationStore } from '@herald/db'

const defaultIntervalMs = 5_000
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
}

export interface NotificationProjectionRuntimeOptions {
    readonly intervalMs?: number
    readonly onError?: (error: unknown) => void
}

export function createNotificationProjectionRuntime(
    notifications: Pick<NotificationStore, 'listProjectIds' | 'project'>,
    options: NotificationProjectionRuntimeOptions = {}
): NotificationProjectionRuntime {
    const intervalMs = options.intervalMs ?? defaultIntervalMs
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
        throw new Error('Notification projection interval must be a positive safe integer')
    }

    let timer: ReturnType<typeof setInterval> | undefined
    let running = false
    let recoveryRequired = false
    let state: NotificationProjectionRuntimeState = 'idle'
    const handleError = options.onError ?? defaultNotificationProjectionErrorHandler

    const project = () => {
        if (running) return
        running = true
        state = recoveryRequired ? 'recovering' : 'running'
        try {
            for (const projectId of notifications.listProjectIds()) {
                let batches = 0
                let hasMore = false
                do {
                    hasMore = notifications.project(projectId).hasMore
                    batches += 1
                } while (hasMore && batches < maximumBatchesPerProject)
            }
            recoveryRequired = false
            state = timer === undefined ? 'idle' : 'started'
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
            if (timer !== undefined) return
            timer = setInterval(project, intervalMs)
            state = recoveryRequired ? 'recovering' : 'started'
            queueMicrotask(() => {
                if (timer !== undefined) project()
            })
        },
        stop() {
            if (timer !== undefined) clearInterval(timer)
            timer = undefined
            state = 'stopped'
        },
        runNow: project,
    }
}

function defaultNotificationProjectionErrorHandler(error: unknown): void {
    console.error('[herald-notifications] projection failed', error)
}
