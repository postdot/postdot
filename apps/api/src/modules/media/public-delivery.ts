import { createHmac, timingSafeEqual } from 'node:crypto'

const mediaDeliveryTokenVersion = 1
const mediaDeliveryAudience = 'postdot-media'
const maximumTokenLength = 2_048
const maximumIdentifierLength = 255

export const mediaPublicDeliveryLimits = {
    defaultLifetimeMs: 15 * 60_000,
    maximumLifetimeMs: 24 * 60 * 60_000,
} as const

export interface MediaDeliveryUrlInput {
    readonly projectId: string
    readonly assetId: string
    readonly representationId: string
}

export interface MediaDeliveryTokenClaims extends MediaDeliveryUrlInput {
    readonly expiresAt: number
}

export interface MediaPublicDeliveryOptions {
    readonly baseURL: string
    readonly signingSecret: string
    readonly lifetimeMs?: number
    readonly now?: () => number
}

interface EncodedMediaDeliveryClaims extends MediaDeliveryUrlInput {
    readonly expiresAtSeconds: number
}

export interface MediaPublicDelivery {
    createUrl(input: MediaDeliveryUrlInput): string
    resolve(token: string, at?: number): MediaDeliveryTokenClaims | null
}

export function createMediaPublicDelivery(
    options: MediaPublicDeliveryOptions
): MediaPublicDelivery {
    const baseURL = normalizeBaseURL(options.baseURL)
    const signingSecret = normalizeSigningSecret(options.signingSecret)
    const lifetimeMs = normalizeLifetime(
        options.lifetimeMs ?? mediaPublicDeliveryLimits.defaultLifetimeMs
    )
    const now = options.now ?? Date.now

    return {
        createUrl(input) {
            const normalizedInput = normalizeInput(input)
            const expiresAtSeconds = Math.floor((now() + lifetimeMs) / 1_000)
            const payload = encodePayload({ ...normalizedInput, expiresAtSeconds })
            const token = `${payload}.${signPayload(payload, signingSecret)}`
            const url = new URL('/api/media/public/', baseURL)
            url.pathname += token
            return url.toString()
        },

        resolve(token, at = now()) {
            const claims = decodeAndVerifyToken(token, signingSecret)
            if (claims === null || Math.floor(at / 1_000) >= claims.expiresAt) return null

            return {
                projectId: claims.projectId,
                assetId: claims.assetId,
                representationId: claims.representationId,
                expiresAt: claims.expiresAt * 1_000,
            }
        },
    }
}

function normalizeBaseURL(value: string): URL {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new TypeError('Media public delivery base URL must be an absolute URL')
    }

    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username.length > 0 ||
        url.password.length > 0
    ) {
        throw new TypeError('Media public delivery base URL must use HTTP or HTTPS')
    }

    return new URL(url.origin)
}

function normalizeSigningSecret(value: string): string {
    if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength < 32) {
        throw new TypeError('Media public delivery signing secret must contain at least 32 bytes')
    }
    return value
}

function normalizeLifetime(value: number): number {
    if (
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        value > mediaPublicDeliveryLimits.maximumLifetimeMs
    ) {
        throw new TypeError('Media public delivery lifetime is outside the supported range')
    }
    return value
}

function normalizeInput(input: MediaDeliveryUrlInput): MediaDeliveryUrlInput {
    return {
        projectId: normalizeIdentifier(input.projectId, 'projectId'),
        assetId: normalizeIdentifier(input.assetId, 'assetId'),
        representationId: normalizeIdentifier(input.representationId, 'representationId'),
    }
}

function normalizeIdentifier(value: string, name: string): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumIdentifierLength ||
        value !== value.trim() ||
        containsControlCharacter(value)
    ) {
        throw new TypeError(`Media public delivery ${name} is not valid`)
    }
    return value
}

function containsControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        if (code <= 0x1f || code === 0x7f) return true
    }
    return false
}

function encodePayload(input: EncodedMediaDeliveryClaims): string {
    return Buffer.from(
        JSON.stringify({
            v: mediaDeliveryTokenVersion,
            a: mediaDeliveryAudience,
            p: input.projectId,
            m: input.assetId,
            r: input.representationId,
            e: input.expiresAtSeconds,
        })
    ).toString('base64url')
}

function signPayload(payload: string, signingSecret: string): string {
    return createHmac('sha256', signingSecret).update(payload).digest('base64url')
}

function decodeAndVerifyToken(
    token: string,
    signingSecret: string
): {
    readonly projectId: string
    readonly assetId: string
    readonly representationId: string
    readonly expiresAt: number
} | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > maximumTokenLength) {
        return null
    }

    const parts = token.split('.')
    const [payload, signature] = parts
    if (
        parts.length !== 2 ||
        payload === undefined ||
        signature === undefined ||
        !isBase64Url(payload) ||
        !isBase64Url(signature)
    ) {
        return null
    }

    const payloadBytes = decodeCanonicalBase64Url(payload)
    const receivedSignature = decodeCanonicalBase64Url(signature)
    if (payloadBytes === null || receivedSignature === null) return null

    const expectedSignature = signPayload(payload, signingSecret)
    const computedSignature = decodeCanonicalBase64Url(expectedSignature)
    if (computedSignature === null) return null
    if (
        receivedSignature.byteLength !== computedSignature.byteLength ||
        !timingSafeEqual(receivedSignature, computedSignature)
    ) {
        return null
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(payloadBytes.toString('utf8'))
    } catch {
        return null
    }

    if (!isRecord(parsed)) return null
    if (parsed.v !== mediaDeliveryTokenVersion || parsed.a !== mediaDeliveryAudience) return null
    const expiresAt = parsed.e
    if (
        typeof parsed.p !== 'string' ||
        typeof parsed.m !== 'string' ||
        typeof parsed.r !== 'string' ||
        typeof expiresAt !== 'number' ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= 0
    ) {
        return null
    }

    try {
        return {
            projectId: normalizeIdentifier(parsed.p, 'projectId'),
            assetId: normalizeIdentifier(parsed.m, 'assetId'),
            representationId: normalizeIdentifier(parsed.r, 'representationId'),
            expiresAt,
        }
    } catch {
        return null
    }
}

function isBase64Url(value: string): boolean {
    return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value)
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
    if (!isBase64Url(value)) return null

    const decoded = Buffer.from(value, 'base64url')
    return decoded.toString('base64url') === value ? decoded : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
