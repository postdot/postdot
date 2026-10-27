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

    let intervalTimer: ReturnType<typeof setInterval> | undefined
    let continuationTimer: ReturnType<typeof setTimeout> | undefined
    let continuationProjectIds: Set<string> | null | undefined
    let started = false
    let running = false
    let recoveryRequired = false
    let state: NotificationProjectionRuntimeState = 'idle'
    const handleError = options.onError ?? defaultNotificationProjectionErrorHandler

    const project = (projectIds?: readonly string[]) => {
        if (running) return
        running = true
        state = recoveryRequired ? 'recovering' : 'running'
        let needsContinuation = false
        try {
            for (const projectId of projectIds ?? notifications.listProjectIds()) {
                let batches = 0
                let hasMore = false
                do {
                    hasMore = notifications.project(projectId).hasMore
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
            project(
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
            if (intervalMs !== undefined) intervalTimer = setInterval(project, intervalMs)
            state = recoveryRequired ? 'recovering' : 'started'
            queueMicrotask(() => {
                if (started) project()
            })
        },
        stop() {
            if (intervalTimer !== undefined) clearInterval(intervalTimer)
            intervalTimer = undefined
            cancelContinuation()
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
    console.error('[postdot-notifications] projection failed', error)
}
