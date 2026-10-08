// cspell:words licdn
import type { ExternalEffectOutcome } from '@herald/core'

import {
    LINKEDIN_API_BASE_URL,
    LINKEDIN_DEFAULT_API_VERSION,
    LINKEDIN_DEFAULT_TIMEOUT_MS,
    type LinkedInDestination,
    type LinkedInFetcher,
    type LinkedInTextPublisherOptions,
    type PublishLinkedInTextInput,
} from './contract'
import { createLinkedInDestinationUrn, createLinkedInImagePostPayload } from './payload'
import {
    classifyResponse,
    classifyImageResponse,
    linkedInJsonHeaders,
    normalizeApiVersion,
    normalizeBaseUrl,
    normalizeTimeout,
    readProviderMessage,
    validateCommonInput,
} from './publisher'

type Failure = Exclude<ExternalEffectOutcome, { type: 'published' } | { type: 'deferred' }>
export interface LinkedInVideoPublisher {
    uploadVideo(input: {
        accessToken: string
        destination: LinkedInDestination
        media: { size: number; stream: ReadableStream<Uint8Array> }
        onInitialized: (videoId: string) => boolean | Promise<boolean>
    }): Promise<{ type: 'uploaded'; remoteMediaId: string } | Failure>
    getVideo(input: {
        accessToken: string
        videoId: string
    }): Promise<{ type: 'available' } | { type: 'processing' } | { type: 'waiting' } | Failure>
    publishVideo(
        input: PublishLinkedInTextInput & { videoId: string }
    ): Promise<ExternalEffectOutcome>
}

export function createLinkedInVideoPublisher(
    options: LinkedInTextPublisherOptions = {}
): LinkedInVideoPublisher {
    const base = normalizeBaseUrl(options.baseUrl ?? LINKEDIN_API_BASE_URL)
    const version = normalizeApiVersion(options.apiVersion ?? LINKEDIN_DEFAULT_API_VERSION)
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? LINKEDIN_DEFAULT_TIMEOUT_MS)
    const fetcher: LinkedInFetcher = options.fetcher ?? fetch
    async function request(url: URL, init: RequestInit): Promise<Response | null> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            return await fetcher(url, { ...init, redirect: 'error', signal: controller.signal })
        } catch {
            return null
        } finally {
            clearTimeout(timer)
        }
    }
    return {
        async uploadVideo(input) {
            const validation = validateCommonInput(input.accessToken, input.destination)
            if (validation) return permanent(validation.errorMessage)
            if (
                !Number.isSafeInteger(input.media.size) ||
                input.media.size < 75_000 ||
                input.media.size > 500_000_000
            )
                return permanent('The LinkedIn video size must be between 75 kB and 500 MB')
            const headers = linkedInJsonHeaders(input.accessToken, version)
            const response = await request(new URL('/rest/videos?action=initializeUpload', base), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    initializeUploadRequest: {
                        owner: createLinkedInDestinationUrn(input.destination),
                        fileSizeBytes: input.media.size,
                        uploadCaptions: false,
                        uploadThumbnail: false,
                    },
                }),
            })
            if (!response) return ambiguous('LinkedIn video initialization failed after dispatch')
            if (response.status !== 200)
                return classifyImageResponse(
                    response,
                    await readProviderMessage(response, input.accessToken),
                    'video initialization'
                )
            let value: unknown
            try {
                const body = (await response.json()) as { value?: unknown }
                value = body.value
            } catch {
                return ambiguous('LinkedIn returned an unreadable video initialization')
            }
            if (
                !record(value) ||
                typeof value.video !== 'string' ||
                !videoId(value.video) ||
                typeof value.uploadToken !== 'string' ||
                !Array.isArray(value.uploadInstructions) ||
                value.uploadInstructions.length === 0 ||
                value.uploadInstructions.length > 128
            )
                return ambiguous('LinkedIn returned an invalid video upload contract')
            const id = value.video
            const token = value.uploadToken
            const parts: { firstByte: number; lastByte: number; url: URL }[] = []
            let nextByte = 0
            try {
                for (const part of value.uploadInstructions) {
                    if (
                        !record(part) ||
                        typeof part.firstByte !== 'number' ||
                        typeof part.lastByte !== 'number' ||
                        typeof part.uploadUrl !== 'string' ||
                        !Number.isSafeInteger(part.firstByte) ||
                        !Number.isSafeInteger(part.lastByte) ||
                        part.firstByte !== nextByte ||
                        part.lastByte < nextByte ||
                        part.lastByte >= input.media.size ||
                        part.lastByte - nextByte + 1 > 4_194_304
                    )
                        return ambiguous('LinkedIn returned invalid video byte ranges')
                    const url = new URL(part.uploadUrl)
                    if (
                        url.protocol !== 'https:' ||
                        url.username ||
                        url.password ||
                        !['linkedin.com', 'linkedin-ei.com', 'licdn.com'].some(
                            host => url.hostname === host || url.hostname.endsWith(`.${host}`)
                        )
                    )
                        return ambiguous('LinkedIn returned an invalid video upload destination')
                    parts.push({ firstByte: part.firstByte, lastByte: part.lastByte, url })
                    nextByte = part.lastByte + 1
                }
                if (nextByte !== input.media.size)
                    return ambiguous('LinkedIn video byte ranges do not cover the file')
                if (!(await input.onInitialized(id)))
                    return ambiguous('The LinkedIn video identifier could not be persisted')
            } catch {
                return ambiguous('The LinkedIn video upload could not be prepared safely')
            }
            const reader = input.media.stream.getReader()
            let pending: Uint8Array = new Uint8Array(0)
            const partIds: string[] = []
            try {
                for (const part of parts) {
                    const bytes = new Uint8Array(part.lastByte - part.firstByte + 1)
                    let filled = 0
                    while (filled < bytes.length) {
                        if (pending.length === 0) {
                            const next = await reader.read()
                            if (next.done)
                                return ambiguous('The LinkedIn video source ended during upload')
                            pending = next.value
                        }
                        const amount = Math.min(pending.length, bytes.length - filled)
                        bytes.set(pending.subarray(0, amount), filled)
                        pending = pending.subarray(amount)
                        filled += amount
                    }
                    const uploaded = await request(part.url, {
                        method: 'PUT',
                        headers: {
                            authorization: `Bearer ${input.accessToken}`,
                            'content-type': 'application/octet-stream',
                            'content-length': String(bytes.length),
                        },
                        body: bytes,
                    })
                    if (!uploaded || !uploaded.ok)
                        return ambiguous(
                            'LinkedIn video part transfer did not complete; reconciliation is required'
                        )
                    const etag = uploaded.headers.get('etag')?.replace(/^"|"$/g, '').trim()
                    if (!etag) return ambiguous('LinkedIn did not return a video part identifier')
                    partIds.push(etag)
                }
                if (pending.length > 0 || !(await reader.read()).done)
                    return ambiguous('The LinkedIn video source changed during upload')
                const finalized = await request(
                    new URL('/rest/videos?action=finalizeUpload', base),
                    {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            finalizeUploadRequest: {
                                video: id,
                                uploadToken: token,
                                uploadedPartIds: partIds,
                            },
                        }),
                    }
                )
                if (!finalized || !finalized.ok)
                    return ambiguous(
                        'LinkedIn video finalization was not confirmed; reconciliation is required'
                    )
                return { type: 'uploaded', remoteMediaId: id }
            } catch {
                return ambiguous(
                    'The LinkedIn video transfer was interrupted; reconciliation is required'
                )
            } finally {
                try {
                    await reader.cancel()
                } catch {
                    /* Preserve the transfer result. */
                }
                reader.releaseLock()
            }
        },
        async getVideo(input) {
            if (!videoId(input.videoId))
                return permanent('The LinkedIn video identifier is invalid')
            const response = await request(
                new URL(`/rest/videos/${encodeURIComponent(input.videoId)}`, base),
                { headers: linkedInJsonHeaders(input.accessToken, version) }
            )
            if (
                !response ||
                response.status >= 500 ||
                response.status === 429 ||
                response.status === 408
            )
                return retryable('The LinkedIn video processing status is temporarily unavailable')
            if (!response.ok)
                return classifyImageResponse(
                    response,
                    await readProviderMessage(response, input.accessToken),
                    'video status'
                )
            try {
                const body = (await response.json()) as { status?: string; id?: string }
                if (body.id !== input.videoId)
                    return permanent('LinkedIn returned a different video identifier')
                if (body.status === 'AVAILABLE') return { type: 'available' }
                if (body.status === 'PROCESSING') return { type: 'processing' }
                if (body.status === 'WAITING_UPLOAD') return { type: 'waiting' }
                if (body.status === 'PROCESSING_FAILED')
                    return permanent('LinkedIn could not process this video')
            } catch {
                return retryable('LinkedIn returned an unreadable video processing status')
            }
            return permanent('LinkedIn returned an unsupported video processing status')
        },
        async publishVideo(input) {
            if (!videoId(input.videoId) || !input.commentary.trim())
                return permanent('The LinkedIn video post is incomplete')
            const response = await request(new URL('/rest/posts', base), {
                method: 'POST',
                headers: linkedInJsonHeaders(input.accessToken, version),
                body: JSON.stringify(
                    createLinkedInImagePostPayload({ ...input, imageId: input.videoId })
                ),
            })
            if (!response)
                return ambiguous('The LinkedIn video post outcome is unknown after dispatch')
            if (response.status === 201) {
                const id = response.headers.get('x-restli-id')?.trim()
                return id
                    ? { type: 'published', externalId: id }
                    : ambiguous('LinkedIn accepted the video post without returning its identifier')
            }
            return classifyResponse(
                response,
                await readProviderMessage(response, input.accessToken)
            )
        },
    }
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function videoId(value: string) {
    return /^urn:li:video:[^\s]+$/.test(value)
}
function ambiguous(errorMessage: string): Failure {
    return { type: 'ambiguous', errorMessage }
}
function permanent(errorMessage: string): Failure {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
function retryable(errorMessage: string): Failure {
    return { type: 'retryable_failure', effectOccurred: false, errorMessage }
}
