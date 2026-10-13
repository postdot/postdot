import type { NetworkControlledBinaryFetcher } from '@postbot/custom-http'
import type { MediaAssetStore, MediaUploadReservation } from '@postbot/db'

const MAX_MEDIA_URL_LENGTH = 2_048
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export const mediaUrlImportErrorCodes = [
    'media_url_invalid',
    'media_url_unavailable',
    'media_url_redirect',
    'media_url_http_error',
    'media_url_missing_type',
    'media_url_unsupported_type',
    'media_url_too_large',
    'media_url_empty',
    'media_url_upload_failed',
] as const

export type MediaUrlImportErrorCode = (typeof mediaUrlImportErrorCodes)[number]

export class MediaUrlImportError extends Error {
    readonly code: MediaUrlImportErrorCode
    readonly status: 400 | 409 | 413 | 415 | 422 | 502
    readonly cause: unknown

    constructor(
        code: MediaUrlImportErrorCode,
        status: 400 | 409 | 413 | 415 | 422 | 502,
        message: string,
        cause?: unknown
    ) {
        super(message)
        this.name = 'MediaUrlImportError'
        this.code = code
        this.status = status
        this.cause = cause
    }
}

export interface MediaUrlImportInput {
    readonly projectId: string
    readonly subjectId: string
    readonly url: string
}

export type MediaUrlImportResult =
    | { readonly kind: 'ready'; readonly reservation: MediaUploadReservation }
    | { readonly kind: 'pending'; readonly reservation: MediaUploadReservation }
    | { readonly kind: 'failed'; readonly reservation: MediaUploadReservation }

export interface MediaUrlImporter {
    importUrl(input: MediaUrlImportInput): Promise<MediaUrlImportResult>
}

export interface MediaUrlImporterOptions {
    readonly media: Pick<
        MediaAssetStore,
        'getUploadPolicy' | 'reserveUpload' | 'upload' | 'finalizeUpload'
    >
    readonly fetcher: NetworkControlledBinaryFetcher
    readonly maxRedirects?: number
    readonly requestTimeoutMs?: number
}

export function createMediaUrlImporter(options: MediaUrlImporterOptions): MediaUrlImporter {
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    validatePositiveInteger(maxRedirects, 'maxRedirects')
    validatePositiveInteger(requestTimeoutMs, 'requestTimeoutMs')

    return {
        importUrl(input) {
            return importMediaUrl(input, options, maxRedirects, requestTimeoutMs)
        },
    }
}

async function importMediaUrl(
    input: MediaUrlImportInput,
    options: MediaUrlImporterOptions,
    maxRedirects: number,
    requestTimeoutMs: number
): Promise<MediaUrlImportResult> {
    const policy = options.media.getUploadPolicy(input.projectId, input.subjectId)
    if (policy === null) {
        throw new MediaUrlImportError(
            'media_url_unavailable',
            502,
            'Media URL import is not available for this project'
        )
    }

    let currentUrl = normalizeMediaUrl(input.url)
    for (let redirectCount = 0; ; redirectCount += 1) {
        const response = await fetchMediaUrl(
            options.fetcher,
            currentUrl,
            policy.allowedContentTypes,
            requestTimeoutMs
        )

        if (isRedirect(response.status)) {
            if (redirectCount >= maxRedirects) {
                throw new MediaUrlImportError(
                    'media_url_redirect',
                    422,
                    'The media URL redirected too many times'
                )
            }
            const location = readHeader(response.headers, 'location')
            if (location === null) {
                throw new MediaUrlImportError(
                    'media_url_redirect',
                    422,
                    'The media URL returned an invalid redirect'
                )
            }
            currentUrl = resolveRedirect(currentUrl, location)
            continue
        }

        if (response.status < 200 || response.status >= 300) {
            throw new MediaUrlImportError(
                'media_url_http_error',
                422,
                'The media URL could not be downloaded'
            )
        }

        const contentType = readContentType(response.headers)
        if (contentType === null) {
            throw new MediaUrlImportError(
                'media_url_missing_type',
                422,
                'The media URL did not describe its file type'
            )
        }
        if (!policy.allowedContentTypes.includes(contentType)) {
            throw new MediaUrlImportError(
                'media_url_unsupported_type',
                415,
                'The media URL points to an unsupported file type'
            )
        }

        const contentLength = readContentLength(response.headers)
        if (
            response.bodyTruncated ||
            (contentLength !== null && contentLength > policy.maxFileSize) ||
            response.body.byteLength > policy.maxFileSize
        ) {
            throw new MediaUrlImportError(
                'media_url_too_large',
                413,
                'The media URL points to a file that is too large'
            )
        }
        if (response.body.byteLength === 0) {
            throw new MediaUrlImportError(
                'media_url_empty',
                422,
                'The media URL returned an empty file'
            )
        }

        return storeImportedBytes(options.media, input, currentUrl, contentType, response.body)
    }
}

async function fetchMediaUrl(
    fetcher: NetworkControlledBinaryFetcher,
    url: URL,
    allowedContentTypes: readonly string[],
    timeoutMs: number
) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetcher(url, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
                accept: allowedContentTypes.join(', '),
                'user-agent': 'Postbot media importer',
            },
        })
    } catch (error) {
        throw new MediaUrlImportError(
            'media_url_unavailable',
            502,
            'The media URL could not be reached',
            error
        )
    } finally {
        clearTimeout(timeout)
    }
}

async function storeImportedBytes(
    media: MediaUrlImporterOptions['media'],
    input: MediaUrlImportInput,
    url: URL,
    contentType: string,
    bytes: Uint8Array
): Promise<MediaUrlImportResult> {
    const reservation = media.reserveUpload({
        projectId: input.projectId,
        subjectId: input.subjectId,
        originalFilename: filenameForUrl(url, contentType),
        expectedSize: bytes.byteLength,
        contentType,
    })
    if (reservation === null) {
        throw new MediaUrlImportError(
            'media_url_upload_failed',
            409,
            'The imported media could not be reserved'
        )
    }

    const uploaded = await media.upload({
        projectId: input.projectId,
        subjectId: input.subjectId,
        intentId: reservation.intent.id,
        source: readableBytes(bytes),
    })
    if (uploaded.kind !== 'uploaded' && uploaded.kind !== 'already_complete') {
        throw new MediaUrlImportError(
            'media_url_upload_failed',
            409,
            'The imported media could not be stored'
        )
    }

    const finalized = await media.finalizeUpload({
        projectId: input.projectId,
        subjectId: input.subjectId,
        intentId: reservation.intent.id,
    })
    if (finalized.kind === 'not_found') {
        throw new MediaUrlImportError(
            'media_url_upload_failed',
            409,
            'The imported media could not be finalized'
        )
    }
    return finalized
}

function normalizeMediaUrl(value: string): URL {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.trim() !== value ||
        value.length > MAX_MEDIA_URL_LENGTH
    ) {
        throw new MediaUrlImportError('media_url_invalid', 400, 'The media URL is invalid')
    }

    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new MediaUrlImportError('media_url_invalid', 400, 'The media URL is invalid')
    }
    validateMediaUrl(url)
    url.hash = ''
    return url
}

function resolveRedirect(currentUrl: URL, location: string): URL {
    let nextUrl: URL
    try {
        nextUrl = new URL(location, currentUrl)
    } catch {
        throw new MediaUrlImportError(
            'media_url_redirect',
            422,
            'The media URL returned an invalid redirect'
        )
    }
    if (nextUrl.toString().length > MAX_MEDIA_URL_LENGTH) {
        throw new MediaUrlImportError(
            'media_url_redirect',
            422,
            'The media URL redirect is too long'
        )
    }
    validateMediaUrl(nextUrl)
    nextUrl.hash = ''
    return nextUrl
}

function validateMediaUrl(url: URL): void {
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.hostname.length === 0
    ) {
        throw new MediaUrlImportError('media_url_invalid', 400, 'The media URL is invalid')
    }
}

function storeContentType(value: string): string {
    return value.trim().toLowerCase().split(';', 1)[0] ?? ''
}

function readContentType(headers: Readonly<Record<string, string>>): string | null {
    const value = readHeader(headers, 'content-type')
    if (value === null) return null
    const normalized = storeContentType(value)
    return normalized.length === 0 ? null : normalized
}

function readContentLength(headers: Readonly<Record<string, string>>): number | null {
    const value = readHeader(headers, 'content-length')
    if (value === null) return null
    const length = Number(value)
    return Number.isSafeInteger(length) && length >= 0 ? length : null
}

function readHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
    const normalizedName = name.toLowerCase()
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)
    if (entry === undefined || entry[1].trim().length === 0) return null
    return entry[1]
}

function isRedirect(status: number): boolean {
    return status >= 300 && status < 400 && status !== 304
}

function filenameForUrl(url: URL, contentType: string): string {
    const pathSegment = url.pathname.split('/').at(-1) ?? ''
    let filename = ''
    try {
        filename = decodeURIComponent(pathSegment)
    } catch {
        filename = pathSegment
    }
    filename = Array.from(filename.replaceAll(/[\\/]/g, '_'), character => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint < 32 || codePoint === 127 ? '_' : character
    })
        .join('')
        .trim()
        .slice(0, 255)

    if (filename.length === 0 || filename === '.' || filename === '..') {
        return `imported-media.${extensionForContentType(contentType)}`
    }
    if (!/\.[A-Za-z0-9]{1,8}$/.test(filename)) {
        filename = `${filename}.${extensionForContentType(contentType)}`
    }
    return filename
}

function extensionForContentType(contentType: string): string {
    switch (contentType) {
        case 'image/jpeg':
            return 'jpg'
        case 'image/webp':
            return 'webp'
        case 'image/png':
        default:
            return 'png'
    }
}

function readableBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}

function validatePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`The ${label} must be a positive safe integer`)
    }
}
