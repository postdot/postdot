import { type Agent, type AppBskyEmbedImages } from '@atproto/api'

import {
    BLUESKY_MAX_ALT_TEXT_LENGTH,
    BLUESKY_MAX_VIDEO_BYTES,
    BLUESKY_MAX_GRAPHEMES,
    BLUESKY_MAX_IMAGE_BYTES,
    BLUESKY_MAX_IMAGES,
    BLUESKY_MAX_TEXT_LENGTH,
    type BlueskyPostContent,
    type BlueskyMediaUploadedHandler,
    type BlueskyPublishOutcome,
} from './contract'

export type BlueskyPublisherAgent = Pick<Agent, 'did' | 'post' | 'uploadBlob'>

export interface BlueskyPublisher {
    publish(input: BlueskyPostContent): Promise<BlueskyPublishOutcome>
}

export function createBlueskyPublisher(options: {
    readonly agent: BlueskyPublisherAgent
    readonly onMediaUploaded?: BlueskyMediaUploadedHandler
}): BlueskyPublisher {
    return {
        async publish(input) {
            const validationError = validateInput(input)
            if (validationError !== null) return validationError

            try {
                const images: AppBskyEmbedImages.Image[] = []

                for (const [index, media] of input.media.entries()) {
                    let blob = media.remoteBlob
                    if (blob === undefined) {
                        if (media.stream === undefined) {
                            return permanentFailure(
                                'The Bluesky media stream is required for a new image upload'
                            )
                        }
                        const bytes = new Uint8Array(await new Response(media.stream).arrayBuffer())
                        if (bytes.byteLength !== media.size) {
                            return permanentFailure(
                                'The Bluesky media stream size does not match its declared size'
                            )
                        }

                        const uploaded = await options.agent.uploadBlob(bytes, {
                            encoding: media.contentType,
                        })
                        blob = uploaded.data.blob
                        await options.onMediaUploaded?.({ index, blob })
                    }
                    images.push({ image: blob, alt: media.accessibilityText })
                }

                const record: Parameters<Agent['post']>[0] = {
                    text: input.text,
                    createdAt: new Date().toISOString(),
                    ...(input.video !== undefined
                        ? {
                              embed: {
                                  $type: 'app.bsky.embed.video' as const,
                                  video: input.video.blob,
                                  alt: input.video.accessibilityText,
                                  aspectRatio: {
                                      width: input.video.width,
                                      height: input.video.height,
                                  },
                              },
                          }
                        : images.length === 0
                          ? {}
                          : {
                                embed: {
                                    $type: 'app.bsky.embed.images' as const,
                                    images,
                                },
                            }),
                }
                const posted = await options.agent.post(record)
                const externalUrl = createBlueskyPostUrl(options.agent.did, posted.uri)
                return {
                    type: 'published',
                    externalId: posted.uri,
                    ...(externalUrl === null ? {} : { externalUrl }),
                }
            } catch (error) {
                return classifyError(error)
            }
        },
    }
}

function validateInput(input: BlueskyPostContent): BlueskyPublishOutcome | null {
    if (input.text.trim().length === 0) {
        return permanentFailure('Bluesky post text must not be blank')
    }
    if (input.text.length > BLUESKY_MAX_TEXT_LENGTH) {
        return permanentFailure('Bluesky post text exceeds the UTF-16 length limit')
    }
    if (graphemeCount(input.text) > BLUESKY_MAX_GRAPHEMES) {
        return permanentFailure('Bluesky post text exceeds the grapheme limit')
    }
    if (input.video !== undefined) {
        const video = input.video
        if (
            input.media.length !== 0 ||
            video.blob.mimeType !== 'video/mp4' ||
            !Number.isSafeInteger(video.blob.size) ||
            video.blob.size <= 0 ||
            video.blob.size > BLUESKY_MAX_VIDEO_BYTES ||
            !Number.isSafeInteger(video.width) ||
            video.width <= 0 ||
            !Number.isSafeInteger(video.height) ||
            video.height <= 0 ||
            video.accessibilityText.trim().length === 0 ||
            video.accessibilityText.length > BLUESKY_MAX_ALT_TEXT_LENGTH
        ) {
            return permanentFailure(
                'Bluesky requires one processed MP4 with dimensions and description, without images'
            )
        }
    }
    if (input.media.length > BLUESKY_MAX_IMAGES) {
        return permanentFailure(`Bluesky posts support at most ${BLUESKY_MAX_IMAGES} images`)
    }
    for (const media of input.media) {
        if (media.contentType !== 'image/jpeg' && media.contentType !== 'image/png') {
            return permanentFailure('Bluesky posts support JPEG and PNG images only')
        }
        if (!Number.isSafeInteger(media.size) || media.size <= 0) {
            return permanentFailure('Bluesky image sizes must be positive safe integers')
        }
        if (media.size > BLUESKY_MAX_IMAGE_BYTES) {
            return permanentFailure('A Bluesky image exceeds the 2 MB image limit')
        }
        if (
            media.accessibilityText.trim().length === 0 ||
            media.accessibilityText.length > BLUESKY_MAX_ALT_TEXT_LENGTH
        ) {
            return permanentFailure(
                'Bluesky images require non-empty alt text of at most 1,000 characters'
            )
        }
    }
    return null
}

function graphemeCount(value: string): number {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length
}

function createBlueskyPostUrl(did: string | undefined, uri: string): string | null {
    if (did === undefined || !uri.startsWith('at://')) return null
    const rkey = uri.slice(uri.lastIndexOf('/') + 1)
    return rkey.length === 0 ? null : `https://bsky.app/profile/${did}/post/${rkey}`
}

function statusFromError(error: unknown): number | null {
    if (error === null || typeof error !== 'object') return null
    const record = error as Record<string, unknown>
    if (typeof record.status === 'number') return record.status
    if (record.response !== null && typeof record.response === 'object') {
        const response = record.response as Record<string, unknown>
        return typeof response.status === 'number' ? response.status : null
    }
    return null
}

function classifyError(error: unknown): BlueskyPublishOutcome {
    const status = statusFromError(error)
    if (status === 429) {
        return {
            type: 'retryable_failure',
            effectOccurred: false,
            code: 'rate_limited',
            errorMessage: 'Bluesky rate limited the publication',
        }
    }
    if (status === 409) {
        return {
            type: 'retryable_failure',
            effectOccurred: false,
            code: 'conflict',
            errorMessage: 'Bluesky reported a publication conflict',
        }
    }
    if (status === 401) {
        return {
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'authentication_required',
            errorMessage: 'Bluesky rejected the publisher session',
        }
    }
    if (status === 403) {
        return {
            type: 'permanent_failure',
            effectOccurred: false,
            code: 'forbidden',
            errorMessage: 'Bluesky rejected the publishing permission',
        }
    }
    if (status !== null && status >= 400 && status < 500) {
        return permanentFailure('Bluesky rejected the publication request')
    }
    return {
        type: 'ambiguous',
        code: 'provider_failure',
        errorMessage: 'Bluesky did not provide a definitive publication outcome',
    }
}

function permanentFailure(
    errorMessage: string
): Extract<BlueskyPublishOutcome, { type: 'permanent_failure' }> {
    return {
        type: 'permanent_failure',
        effectOccurred: false,
        code: 'invalid_input',
        errorMessage,
    }
}
