import { jsonToLex, BlobRef, type Agent } from '@atproto/api'
import type { ExternalEffectOutcome } from '@postdot/core'

import { BLUESKY_MAX_VIDEO_BYTES, type BlueskyFetcher } from './contract'

type Failure = Exclude<ExternalEffectOutcome, { type: 'published' } | { type: 'deferred' }>
export type BlueskyVideoJob =
    | { type: 'processing'; jobId: string }
    | { type: 'ready'; blob: BlobRef }
    | Failure
export interface BlueskyVideoService {
    checkLimits(size: number): Promise<{ type: 'allowed' } | Failure>
    upload(input: { stream: ReadableStream<Uint8Array>; size: number }): Promise<BlueskyVideoJob>
    getJob(jobId: string): Promise<BlueskyVideoJob>
}

const VIDEO_ORIGIN = 'https://video.bsky.app'

/** Uses separate short-lived tokens for quota inspection and delegated PDS upload. */
export function createBlueskyVideoService(options: {
    agent: Pick<Agent, 'did' | 'com'>
    pdsUrl: string
    fetcher?: BlueskyFetcher
    now?: () => number
}): BlueskyVideoService {
    const fetcher = options.fetcher ?? fetch
    const now = options.now ?? Date.now
    const token = async (aud: string, lxm: string) => {
        const response = await options.agent.com.atproto.server.getServiceAuth({
            aud,
            lxm,
            exp: Math.floor(now() / 1000) + 30 * 60,
        })
        return response.data.token
    }
    return {
        async checkLimits(size) {
            try {
                const access = await token(
                    'did:web:video.bsky.app',
                    'app.bsky.video.getUploadLimits'
                )
                const response = await fetcher(
                    `${VIDEO_ORIGIN}/xrpc/app.bsky.video.getUploadLimits`,
                    {
                        headers: { Authorization: `Bearer ${access}` },
                        signal: AbortSignal.timeout(30_000),
                    }
                )
                if (!response.ok) return responseFailure(response.status, false)
                const value: unknown = await response.json()
                if (!isRecord(value) || typeof value.canUpload !== 'boolean')
                    return retryable('Bluesky video eligibility could not be read')
                if (
                    !value.canUpload ||
                    (typeof value.remainingDailyVideos === 'number' &&
                        value.remainingDailyVideos < 1) ||
                    (typeof value.remainingDailyBytes === 'number' &&
                        value.remainingDailyBytes < size)
                ) {
                    return permanent(
                        'Bluesky video upload is unavailable; verify the account email and daily upload allowance'
                    )
                }
                return { type: 'allowed' }
            } catch {
                return retryable('Bluesky video eligibility could not be checked; retry is safe')
            }
        },
        async upload(input) {
            if (
                !Number.isSafeInteger(input.size) ||
                input.size <= 0 ||
                input.size > BLUESKY_MAX_VIDEO_BYTES ||
                !options.agent.did
            ) {
                return permanent('The Bluesky video upload input is invalid')
            }
            let access: string
            try {
                const pds = new URL(options.pdsUrl)
                if (pds.protocol !== 'https:')
                    return permanent('The Bluesky PDS URL must use HTTPS')
                access = await token(
                    `did:web:${pds.host.replaceAll(':', '%3A')}`,
                    'com.atproto.repo.uploadBlob'
                )
            } catch {
                return permanent(
                    'Bluesky video upload permission is unavailable; reconnect the account'
                )
            }
            try {
                const url = new URL(`${VIDEO_ORIGIN}/xrpc/app.bsky.video.uploadVideo`)
                url.searchParams.set('did', options.agent.did)
                url.searchParams.set('name', 'postdot-video.mp4')
                const response = await fetcher(url, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${access}`,
                        'Content-Type': 'video/mp4',
                        'Content-Length': String(input.size),
                    },
                    body: input.stream,
                    signal: AbortSignal.timeout(120_000),
                })
                const value: unknown = await response.json()
                // already_exists can carry a processed blob even on a non-success response.
                const job = readJob(value)
                if (job !== null && (response.ok || job.type === 'ready')) return job
                return responseFailure(response.status, true)
            } catch {
                return ambiguous('The Bluesky video upload has no confirmed processing identifier')
            }
        },
        async getJob(jobId) {
            try {
                const url = new URL(`${VIDEO_ORIGIN}/xrpc/app.bsky.video.getJobStatus`)
                url.searchParams.set('jobId', jobId)
                const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) })
                if (!response.ok) return responseFailure(response.status, false)
                const value: unknown = await response.json()
                const returnedJob =
                    isRecord(value) && isRecord(value.jobStatus) ? value.jobStatus : value
                if (
                    isRecord(returnedJob) &&
                    returnedJob.jobId !== undefined &&
                    returnedJob.jobId !== jobId
                )
                    return permanent('Bluesky returned a different video processing job')
                const job = readJob(value)
                if (job?.type === 'processing' && job.jobId !== jobId)
                    return permanent('Bluesky returned a different video processing job')
                return job ?? retryable('Bluesky returned an unreadable video processing status')
            } catch {
                return retryable('Bluesky video processing status is temporarily unavailable')
            }
        },
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function readJob(value: unknown): BlueskyVideoJob | null {
    if (!isRecord(value)) return null
    const job = isRecord(value.jobStatus) ? value.jobStatus : value
    if (job.blob !== undefined) {
        const blob = readBlueskyVideoBlob(job.blob)
        return blob
            ? { type: 'ready', blob }
            : permanent('Bluesky returned an invalid processed video blob')
    }
    if (job.state === 'JOB_STATE_FAILED') return permanent('Bluesky video processing failed')
    if (job.state === 'JOB_STATE_COMPLETED')
        return permanent('Bluesky completed video processing without a blob')
    if (typeof job.jobId === 'string' && job.jobId.length > 0 && typeof job.state === 'string') {
        return { type: 'processing', jobId: job.jobId }
    }
    return null
}
function responseFailure(status: number, upload: boolean): Failure {
    if (status === 429) return retryable('Bluesky rate limited the video request')
    if (status >= 400 && status < 500)
        return permanent(
            'Bluesky rejected the video request; check account eligibility and permissions'
        )
    return upload
        ? ambiguous('Bluesky did not confirm the video upload')
        : retryable('Bluesky video service is temporarily unavailable')
}
function permanent(errorMessage: string): Failure {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
function retryable(errorMessage: string): Failure {
    return { type: 'retryable_failure', effectOccurred: false, errorMessage }
}
function ambiguous(errorMessage: string): Failure {
    return { type: 'ambiguous', errorMessage }
}

export function readBlueskyVideoBlob(value: unknown): BlobRef | null {
    try {
        const blob = value instanceof BlobRef ? value : jsonToLex(value)
        return blob instanceof BlobRef &&
            blob.mimeType === 'video/mp4' &&
            Number.isSafeInteger(blob.size) &&
            blob.size > 0 &&
            blob.size <= BLUESKY_MAX_VIDEO_BYTES
            ? blob
            : null
    } catch {
        return null
    }
}
