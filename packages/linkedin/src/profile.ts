import {
    LINKEDIN_API_BASE_URL,
    LINKEDIN_USERINFO_PATH,
    type LinkedInFetcher,
    type LinkedInMemberProfile,
    type LinkedInMemberProfileClient,
} from './contract'

export interface LinkedInMemberProfileClientOptions {
    readonly baseUrl?: string
    readonly fetcher?: LinkedInFetcher
    readonly timeoutMs?: number
}

export class LinkedInProfileError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'LinkedInProfileError'
    }
}

export function createLinkedInMemberProfileClient(
    options: LinkedInMemberProfileClientOptions = {}
): LinkedInMemberProfileClient {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? LINKEDIN_API_BASE_URL)
    const fetcher = options.fetcher ?? globalThis.fetch
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? 30_000)

    return {
        async getProfile(accessToken) {
            if (accessToken.trim().length === 0) {
                throw new LinkedInProfileError('LinkedIn access token is unavailable')
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)

            try {
                let response: Response
                try {
                    response = await fetcher(new URL(LINKEDIN_USERINFO_PATH, baseUrl), {
                        method: 'GET',
                        headers: {
                            authorization: `Bearer ${accessToken}`,
                            accept: 'application/json',
                        },
                        signal: controller.signal,
                    })
                } catch {
                    throw new LinkedInProfileError(
                        controller.signal.aborted
                            ? 'LinkedIn member profile request timed out'
                            : 'LinkedIn member profile request failed'
                    )
                }

                if (!response.ok) {
                    throw new LinkedInProfileError(
                        `LinkedIn member profile request was rejected (HTTP ${response.status})`
                    )
                }

                let body: unknown
                try {
                    body = await response.json()
                } catch {
                    throw new LinkedInProfileError('LinkedIn member profile response was invalid')
                }

                return parseProfile(body)
            } finally {
                clearTimeout(timeout)
            }
        },
    }
}

function parseProfile(value: unknown): LinkedInMemberProfile {
    if (!isRecord(value) || typeof value.sub !== 'string' || value.sub.trim().length === 0) {
        throw new LinkedInProfileError('LinkedIn member profile did not contain a member id')
    }

    if (/\s/.test(value.sub)) {
        throw new LinkedInProfileError('LinkedIn member profile contained an invalid member id')
    }

    const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : null
    return { id: value.sub, name }
}

function normalizeBaseUrl(value: string): URL {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('LinkedIn base URL must use HTTP or HTTPS')
    }
    if (url.username.length > 0 || url.password.length > 0) {
        throw new TypeError('LinkedIn base URL must not contain credentials')
    }
    return url
}

function normalizeTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('LinkedIn timeoutMs must be a positive safe integer')
    }
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
