import {
    createNetworkControlledBinaryFetcher,
    CustomHttpPolicyError,
    CustomHttpResolutionError,
    type NetworkControlledBinaryFetcher,
    type PrivateDestinationRule,
} from '@postdot/custom-http'
import {
    IdentityImageValidationError,
    identityImageMaxBytes,
    normalizeIdentityWebsiteUrl,
    processIdentityImage,
    type ProcessedIdentityImage,
} from '@postdot/db'
import { decodeHTMLAttribute } from 'entities'

const MAX_HTML_BYTES = 512 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000
const MAX_ICON_CANDIDATES = 5

export type IdentityImageRemoteErrorCode =
    | 'identity_website_invalid'
    | 'identity_image_url_invalid'
    | 'identity_network_policy_denied'
    | 'identity_remote_unavailable'
    | 'identity_remote_redirect'
    | 'identity_remote_http_error'
    | 'identity_image_size'
    | 'identity_image_format'
    | 'identity_favicon_not_found'

export class IdentityImageRemoteError extends Error {
    readonly code: IdentityImageRemoteErrorCode
    readonly status: 400 | 413 | 415 | 422 | 502
    override readonly cause?: unknown

    constructor(
        code: IdentityImageRemoteErrorCode,
        status: 400 | 413 | 415 | 422 | 502,
        message: string,
        cause?: unknown
    ) {
        super(message)
        this.name = 'IdentityImageRemoteError'
        this.code = code
        this.status = status
        this.cause = cause
    }
}

export interface HtmlIconCandidate {
    readonly href: string
    readonly rel: string
    readonly type: string | null
    readonly maxDimension: number | null
}

function isSupportedIconRel(relValue: string): boolean {
    const normalized = relValue.trim().toLowerCase()
    if (normalized.length === 0) return false
    const tokens = normalized.split(/\s+/).filter(Boolean)
    if (tokens.includes('mask-icon') || tokens.includes('preload')) return false
    if (tokens.includes('icon')) return true
    if (tokens.includes('apple-touch-icon')) return true
    // cspell:disable-next-line
    if (tokens.includes('apple-touch-icon-precomposed')) return true
    return false
}

function parseMaxIconDimension(sizesValue: string | undefined): number | null {
    if (!sizesValue) return null
    let best: number | null = null
    for (const token of sizesValue.trim().toLowerCase().split(/\s+/)) {
        const match = /^(\d+)x(\d+)$/.exec(token)
        if (!match) continue
        const width = Number(match[1])
        const height = Number(match[2])
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) continue
        if (width <= 0 || height <= 0) continue
        const dimension = Math.min(width, height)
        if (best === null || dimension > best) {
            best = dimension
        }
    }
    return best
}

function isLikelySvgCandidate(href: string, type: string | null): boolean {
    if (type && type.toLowerCase().includes('svg')) return true
    try {
        const parsed = new URL(href, 'https://example.invalid')
        return parsed.pathname.toLowerCase().endsWith('.svg')
    } catch {
        return href.toLowerCase().endsWith('.svg')
    }
}

function candidatePriorityScore(candidate: HtmlIconCandidate): number {
    const size = candidate.maxDimension
    // Prefer raster icons with known dimension >= 32 px, ordered by largest size first.
    if (size !== null && size >= 32) {
        return 10_000 + Math.min(size, 2_048)
    }
    // Next, apple-touch-icon without explicit sizes (typically 180x180 raster PNG).
    if (size === null && candidate.rel.includes('apple-touch-icon')) {
        return 5_000
    }
    // Next, standard icon links without explicit sizes.
    if (size === null) {
        return 3_000
    }
    // Finally, small icons (< 32 px), preferring larger ones (e.g. 24 > 16).
    return 1_000 + size
}

/**
 * Extracts and orders `<link>` icon candidates from an HTML document,
 * preferring the largest raster icon >= 32 px and skipping SVG icons.
 */
export function selectHtmlIconCandidates(
    html: string,
    baseUrl: URL
): readonly { readonly url: URL; readonly candidate: HtmlIconCandidate }[] {
    const links: Map<string, string>[] = []
    let documentBase = baseUrl
    let hasBase = false
    new HTMLRewriter()
        .on('base[href]', {
            element(element) {
                if (hasBase) return
                hasBase = true
                try {
                    documentBase = new URL(
                        decodeHTMLAttribute(element.getAttribute('href')!),
                        baseUrl
                    )
                } catch {
                    /* Keep the final page URL. */
                }
            },
        })
        .on('link', {
            element(element) {
                links.push(
                    new Map(
                        Array.from(element.attributes, ([name, value]) => [
                            name,
                            decodeHTMLAttribute(value),
                        ])
                    )
                )
            },
        })
        .transform(html)
    const indexedCandidates: {
        readonly index: number
        readonly url: URL
        readonly candidate: HtmlIconCandidate
        readonly score: number
    }[] = []

    let matchIndex = 0
    for (const attrs of links) {
        const rel = attrs.get('rel') ?? ''
        const href = attrs.get('href') ?? ''
        if (!isSupportedIconRel(rel) || href.length === 0) continue
        if (href.startsWith('data:') || href.startsWith('javascript:')) continue
        const type = attrs.get('type') ?? null
        if (isLikelySvgCandidate(href, type)) continue

        let resolvedUrl: URL
        try {
            resolvedUrl = new URL(href, documentBase)
        } catch {
            continue
        }
        if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') continue
        if (resolvedUrl.username !== '' || resolvedUrl.password !== '') continue

        const candidate: HtmlIconCandidate = {
            href,
            rel: rel.trim().toLowerCase(),
            type,
            maxDimension: parseMaxIconDimension(attrs.get('sizes')),
        }
        indexedCandidates.push({
            index: matchIndex,
            url: resolvedUrl,
            candidate,
            score: candidatePriorityScore(candidate),
        })
        matchIndex += 1
    }

    indexedCandidates.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.index - right.index
    })

    const deduplicated: { readonly url: URL; readonly candidate: HtmlIconCandidate }[] = []
    const seenUrls = new Set<string>()
    for (const entry of indexedCandidates) {
        const key = entry.url.toString()
        if (seenUrls.has(key)) continue
        seenUrls.add(key)
        deduplicated.push({ url: entry.url, candidate: entry.candidate })
    }
    return deduplicated
}

function isRedirectStatus(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function readHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
    const target = name.toLowerCase()
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) {
            const trimmed = value.trim()
            return trimmed.length > 0 ? trimmed : null
        }
    }
    return null
}

function readContentLength(headers: Readonly<Record<string, string>>): number | null {
    const raw = readHeader(headers, 'content-length')
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseExplicitHttpUrl(
    rawUrl: string,
    invalidCode: 'identity_image_url_invalid' | 'identity_website_invalid',
    label: string
): URL {
    const trimmed = rawUrl.trim()
    if (trimmed.length === 0 || trimmed.length > 2_048) {
        throw new IdentityImageRemoteError(
            invalidCode,
            400,
            `${label} must be a valid HTTP or HTTPS URL`
        )
    }
    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        throw new IdentityImageRemoteError(
            invalidCode,
            400,
            `${label} must be a valid HTTP or HTTPS URL`
        )
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new IdentityImageRemoteError(invalidCode, 400, `${label} must use HTTP or HTTPS`)
    }
    if (parsed.username !== '' || parsed.password !== '') {
        throw new IdentityImageRemoteError(
            invalidCode,
            400,
            `${label} must not contain credentials`
        )
    }
    if (parsed.hostname.trim().length === 0) {
        throw new IdentityImageRemoteError(invalidCode, 400, `${label} must include a hostname`)
    }
    return parsed
}

export interface IdentityImageResolver {
    fetchImageFromUrl(url: string): Promise<ProcessedIdentityImage>
    resolveWebsiteFavicon(websiteUrl: string): Promise<ProcessedIdentityImage>
    tryResolveWebsiteFavicon(websiteUrl: string): Promise<{
        readonly normalizedWebsiteUrl: string
        readonly favicon: ProcessedIdentityImage | null
        readonly warning: string | null
    }>
}

export interface IdentityImageResolverOptions {
    readonly fetcher?: NetworkControlledBinaryFetcher
    readonly privateDestinations?: readonly PrivateDestinationRule[]
    readonly maxRedirects?: number
    readonly requestTimeoutMs?: number
}

export function createIdentityImageResolver(
    options: IdentityImageResolverOptions = {}
): IdentityImageResolver {
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const binaryFetcher =
        options.fetcher ??
        createNetworkControlledBinaryFetcher({
            privateDestinations: options.privateDestinations,
            maxResponseBytes: identityImageMaxBytes,
        })

    async function performControlledGet(
        initialUrl: URL,
        accept: string,
        maxBytes: number,
        invalidCode: 'identity_image_url_invalid' | 'identity_website_invalid',
        deadline: number
    ): Promise<{
        readonly finalUrl: URL
        readonly status: number
        readonly headers: Readonly<Record<string, string>>
        readonly body: Uint8Array
    }> {
        let currentUrl = initialUrl
        for (let redirectCount = 0; ; redirectCount += 1) {
            const remainingMs = deadline - Date.now()
            if (remainingMs <= 0)
                throw new IdentityImageRemoteError(
                    'identity_remote_unavailable',
                    502,
                    'The remote request timed out'
                )
            const controller = new AbortController()
            let timeout: ReturnType<typeof setTimeout> | undefined
            // DNS authorization precedes the abort-aware socket request. Race the entire
            // fetch so a stalled lookup also respects the shared operation deadline.
            const timedOut = new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort()
                    reject(new Error('Identity image request timed out'))
                }, remainingMs)
            })
            let response: Awaited<ReturnType<NetworkControlledBinaryFetcher>>
            try {
                response = await Promise.race([
                    binaryFetcher(currentUrl, {
                        method: 'GET',
                        redirect: 'manual',
                        signal: controller.signal,
                        headers: {
                            accept,
                            'user-agent': 'Postdot identity image resolver',
                        },
                    }),
                    timedOut,
                ])
            } catch (error) {
                if (error instanceof CustomHttpPolicyError) {
                    throw new IdentityImageRemoteError(
                        'identity_network_policy_denied',
                        422,
                        'That address is blocked by the server outbound network policy',
                        error
                    )
                }
                if (error instanceof CustomHttpResolutionError) {
                    throw new IdentityImageRemoteError(
                        'identity_remote_unavailable',
                        422,
                        'The remote host could not be resolved',
                        error
                    )
                }
                throw new IdentityImageRemoteError(
                    'identity_remote_unavailable',
                    502,
                    'The remote server could not be reached',
                    error
                )
            } finally {
                clearTimeout(timeout)
            }

            if (isRedirectStatus(response.status)) {
                if (redirectCount >= maxRedirects) {
                    throw new IdentityImageRemoteError(
                        'identity_remote_redirect',
                        422,
                        'The remote URL redirected too many times'
                    )
                }
                const location = readHeader(response.headers, 'location')
                if (location === null) {
                    throw new IdentityImageRemoteError(
                        'identity_remote_redirect',
                        422,
                        'The remote URL returned an invalid redirect'
                    )
                }
                let nextUrl: URL
                try {
                    nextUrl = new URL(location, currentUrl)
                } catch {
                    throw new IdentityImageRemoteError(
                        invalidCode,
                        422,
                        'The remote URL redirected to an invalid address'
                    )
                }
                if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
                    throw new IdentityImageRemoteError(
                        'identity_network_policy_denied',
                        422,
                        'The remote URL redirected to a non-HTTP(S) address'
                    )
                }
                if (nextUrl.username !== '' || nextUrl.password !== '') {
                    throw new IdentityImageRemoteError(
                        invalidCode,
                        422,
                        'The remote URL redirected to an address with credentials'
                    )
                }
                currentUrl = nextUrl
                continue
            }

            const declaredLength = readContentLength(response.headers)
            if (
                response.bodyTruncated ||
                (declaredLength !== null && declaredLength > maxBytes) ||
                response.body.byteLength > maxBytes
            ) {
                throw new IdentityImageRemoteError(
                    'identity_image_size',
                    413,
                    maxBytes === identityImageMaxBytes
                        ? 'Image exceeds the 2 MB limit'
                        : 'Website page exceeds the size limit'
                )
            }

            return {
                finalUrl: currentUrl,
                status: response.status,
                headers: response.headers,
                body: response.body,
            }
        }
    }

    async function downloadAndProcessIcon(
        url: URL,
        invalidCode: 'identity_image_url_invalid' | 'identity_website_invalid',
        deadline = Date.now() + requestTimeoutMs
    ): Promise<ProcessedIdentityImage> {
        const response = await performControlledGet(
            url,
            'image/png, image/webp, image/jpeg, image/gif, image/x-icon, image/vnd.microsoft.icon;q=0.9, */*;q=0.5',
            identityImageMaxBytes,
            invalidCode,
            deadline
        )
        if (response.status < 200 || response.status >= 300) {
            throw new IdentityImageRemoteError(
                'identity_remote_http_error',
                422,
                'The image could not be downloaded'
            )
        }
        if (response.body.byteLength === 0) {
            throw new IdentityImageRemoteError(
                'identity_image_format',
                422,
                'The downloaded image is empty'
            )
        }
        try {
            return await processIdentityImage(response.body)
        } catch (error) {
            if (error instanceof IdentityImageValidationError) {
                throw new IdentityImageRemoteError(
                    error.code === 'identity_image_size'
                        ? 'identity_image_size'
                        : 'identity_image_format',
                    error.code === 'identity_image_size' ? 413 : 415,
                    error.message,
                    error
                )
            }
            throw error
        }
    }

    async function resolveWebsiteFaviconInternal(
        normalizedWebsiteUrl: string
    ): Promise<ProcessedIdentityImage> {
        const initialUrl = parseExplicitHttpUrl(
            normalizedWebsiteUrl,
            'identity_website_invalid',
            'Website URL'
        )
        const deadline = Date.now() + requestTimeoutMs
        const pageResponse = await performControlledGet(
            initialUrl,
            'text/html, application/xhtml+xml;q=0.9',
            MAX_HTML_BYTES,
            'identity_website_invalid',
            deadline
        )

        const candidateUrls: URL[] = []
        if (pageResponse.status >= 200 && pageResponse.status < 300) {
            const contentType = (readHeader(pageResponse.headers, 'content-type') ?? '')
                .split(';', 1)[0]!
                .trim()
                .toLowerCase()
            const isHtml =
                contentType === '' ||
                contentType === 'text/html' ||
                contentType === 'application/xhtml+xml'
            if (isHtml && pageResponse.body.byteLength > 0) {
                const html = new TextDecoder('utf-8', { fatal: false }).decode(pageResponse.body)
                for (const item of selectHtmlIconCandidates(html, pageResponse.finalUrl).slice(
                    0,
                    MAX_ICON_CANDIDATES
                )) {
                    candidateUrls.push(item.url)
                }
            }
        }

        const fallbackFaviconUrl = new URL('/favicon.ico', pageResponse.finalUrl.origin)
        if (
            !candidateUrls.some(candidate => candidate.toString() === fallbackFaviconUrl.toString())
        ) {
            candidateUrls.push(fallbackFaviconUrl)
        }

        let lastSpecificError: IdentityImageRemoteError | null = null
        for (const candidateUrl of candidateUrls) {
            try {
                return await downloadAndProcessIcon(
                    candidateUrl,
                    'identity_website_invalid',
                    deadline
                )
            } catch (error) {
                // Never swallow an outbound network policy refusal on an icon link or redirect.
                if (
                    error instanceof IdentityImageRemoteError &&
                    error.code === 'identity_network_policy_denied'
                ) {
                    throw error
                }
                if (
                    error instanceof IdentityImageRemoteError &&
                    (error.code === 'identity_image_size' ||
                        error.code === 'identity_image_format') &&
                    lastSpecificError === null
                ) {
                    lastSpecificError = error
                }
            }
        }

        if (lastSpecificError !== null) {
            throw lastSpecificError
        }

        throw new IdentityImageRemoteError(
            'identity_favicon_not_found',
            422,
            'No supported icon could be found for this website'
        )
    }

    return {
        async fetchImageFromUrl(rawUrl: string): Promise<ProcessedIdentityImage> {
            const url = parseExplicitHttpUrl(rawUrl, 'identity_image_url_invalid', 'Image URL')
            return await downloadAndProcessIcon(url, 'identity_image_url_invalid')
        },

        async resolveWebsiteFavicon(rawWebsiteUrl: string): Promise<ProcessedIdentityImage> {
            let normalized: string | null
            try {
                normalized = normalizeIdentityWebsiteUrl(rawWebsiteUrl)
            } catch (error) {
                if (error instanceof IdentityImageValidationError) {
                    throw new IdentityImageRemoteError(
                        'identity_website_invalid',
                        400,
                        error.message,
                        error
                    )
                }
                throw error
            }
            if (normalized === null) {
                throw new IdentityImageRemoteError(
                    'identity_website_invalid',
                    400,
                    'Set a website URL first before using its icon'
                )
            }
            return await resolveWebsiteFaviconInternal(normalized)
        },

        async tryResolveWebsiteFavicon(rawWebsiteUrl: string) {
            let normalized: string | null
            try {
                normalized = normalizeIdentityWebsiteUrl(rawWebsiteUrl)
            } catch (error) {
                if (error instanceof IdentityImageValidationError) {
                    throw new IdentityImageRemoteError(
                        'identity_website_invalid',
                        400,
                        error.message,
                        error
                    )
                }
                throw error
            }
            if (normalized === null) {
                throw new IdentityImageRemoteError(
                    'identity_website_invalid',
                    400,
                    'Website URL must be a valid HTTP or HTTPS URL'
                )
            }
            try {
                const favicon = await resolveWebsiteFaviconInternal(normalized)
                return {
                    normalizedWebsiteUrl: normalized,
                    favicon,
                    warning: null,
                }
            } catch (error) {
                if (
                    error instanceof IdentityImageRemoteError &&
                    (error.code === 'identity_network_policy_denied' ||
                        error.code === 'identity_website_invalid')
                ) {
                    throw error
                }
                const message =
                    error instanceof IdentityImageRemoteError
                        ? error.message
                        : 'Could not load an icon from this website'
                return {
                    normalizedWebsiteUrl: normalized,
                    favicon: null,
                    warning: message,
                }
            }
        },
    }
}
