import type { MediaAssetStore } from '@postbot/db'
import { createLocalMediaStore, createS3MediaStore, type MediaStore } from '@postbot/media'

import type { PostbotConfig } from '../../config'

const defaultMediaReconciliationIntervalMs = 60_000

export function createConfiguredMediaStore(config: PostbotConfig['media']): MediaStore {
    if (config.driver === 'local') {
        return createLocalMediaStore({
            storeId: config.storeId,
            rootDirectory: config.directory,
            maxObjectBytes: config.maxObjectBytes,
        })
    }

    if (config.s3 === undefined) {
        throw new Error('S3 media storage configuration is missing')
    }

    const client = new Bun.S3Client({
        bucket: config.s3.bucket,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
        ...(config.s3.region === undefined ? {} : { region: config.s3.region }),
        ...(config.s3.endpoint === undefined ? {} : { endpoint: config.s3.endpoint }),
        ...(config.s3.sessionToken === undefined ? {} : { sessionToken: config.s3.sessionToken }),
    })

    return createS3MediaStore({
        storeId: config.storeId,
        maxObjectBytes: config.maxObjectBytes,
        client,
        prefix: config.s3.prefix,
    })
}

export type MediaReconciliationRuntimeState =
    | 'idle'
    | 'started'
    | 'running'
    | 'recovering'
    | 'stopped'
    | 'failed'

export interface MediaReconciliationRuntime {
    readonly state: MediaReconciliationRuntimeState
    start(): void
    stop(): Promise<void>
}

export interface MediaReconciliationRuntimeOptions {
    readonly intervalMs?: number
    readonly onError?: (error: unknown) => void
}

export function createMediaReconciliationRuntime(
    media: Pick<MediaAssetStore, 'reconcile'>,
    options: MediaReconciliationRuntimeOptions = {}
): MediaReconciliationRuntime {
    const intervalMs = options.intervalMs ?? defaultMediaReconciliationIntervalMs
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
        throw new Error('Media reconciliation interval must be a positive safe integer')
    }

    let timer: ReturnType<typeof setInterval> | undefined
    let running = false
    let activeReconciliation: Promise<void> | null = null
    let recoveryRequired = false
    let state: MediaReconciliationRuntimeState = 'idle'
    const handleError = options.onError ?? defaultMediaReconciliationErrorHandler

    const reconcile = (): Promise<void> => {
        if (running) return activeReconciliation ?? Promise.resolve()
        running = true
        state = recoveryRequired ? 'recovering' : 'running'
        const run = (async () => {
            try {
                await media.reconcile()
                recoveryRequired = false
                if (timer !== undefined) state = 'started'
            } catch (error) {
                recoveryRequired = true
                state = timer === undefined ? 'stopped' : 'failed'
                handleError(error)
            } finally {
                running = false
            }
        })()
        activeReconciliation = run
        return run
    }

    return {
        get state() {
            return state
        },
        start() {
            if (timer !== undefined) return
            timer = setInterval(() => void reconcile(), intervalMs)
            state = recoveryRequired ? 'recovering' : 'started'
        },
        stop() {
            if (timer === undefined) return activeReconciliation ?? Promise.resolve()
            clearInterval(timer)
            timer = undefined
            state = 'stopped'
            return activeReconciliation ?? Promise.resolve()
        },
    }
}

function defaultMediaReconciliationErrorHandler(error: unknown): void {
    console.error('[postbot-media] reconciliation failed', error)
}
