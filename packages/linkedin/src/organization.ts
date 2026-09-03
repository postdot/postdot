import {
    LINKEDIN_API_BASE_URL,
    LINKEDIN_DEFAULT_API_VERSION,
    LINKEDIN_DEFAULT_TIMEOUT_MS,
    LINKEDIN_ORGANIZATIONS_PATH,
    LINKEDIN_RESTLI_PROTOCOL_VERSION,
    type LinkedInFetcher,
    type LinkedInOrganizationClient,
    type LinkedInOrganizationProfile,
} from './contract'

export interface LinkedInOrganizationClientOptions {
    readonly apiVersion?: string
    readonly baseUrl?: string
    readonly fetcher?: LinkedInFetcher
    readonly timeoutMs?: number
}

export class LinkedInOrganizationError extends Error {
    readonly status: number | null

    constructor(message: string, status: number | null = null) {
        super(message)
        this.name = 'LinkedInOrganizationError'
        this.status = status
    }
}

export function createLinkedInOrganizationClient(
    options: LinkedInOrganizationClientOptions = {}
): LinkedInOrganizationClient {
    const apiVersion = normalizeApiVersion(options.apiVersion ?? LINKEDIN_DEFAULT_API_VERSION)
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? LINKEDIN_API_BASE_URL)
    const fetcher = options.fetcher ?? globalThis.fetch
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? LINKEDIN_DEFAULT_TIMEOUT_MS)

    return {
        async getOrganization(accessToken, organizationId) {
            if (accessToken.trim().length === 0) {
                throw new LinkedInOrganizationError('LinkedIn access token is unavailable')
            }
            const normalizedOrganizationId = normalizeOrganizationId(organizationId)
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)

            try {
                let response: Response
                try {
                    response = await fetcher(
                        new URL(
                            `${LINKEDIN_ORGANIZATIONS_PATH}/${encodeURIComponent(normalizedOrganizationId)}`,
                            baseUrl
                        ),
                        {
                            method: 'GET',
                            headers: {
                                authorization: `Bearer ${accessToken}`,
                                accept: 'application/json',
                                'linkedin-version': apiVersion,
                                'x-restli-protocol-version': LINKEDIN_RESTLI_PROTOCOL_VERSION,
                            },
                            redirect: 'error',
                            signal: controller.signal,
                        }
                    )
                } catch {
                    throw new LinkedInOrganizationError(
                        controller.signal.aborted
                            ? 'LinkedIn organization request timed out'
                            : 'LinkedIn organization request failed'
                    )
                }

                if (!response.ok) {
                    throw new LinkedInOrganizationError(
                        `LinkedIn organization request was rejected (HTTP ${response.status})`,
                        response.status
                    )
                }

                let body: unknown
                try {
                    body = await response.json()
                } catch {
                    throw new LinkedInOrganizationError(
                        'LinkedIn organization response was invalid',
                        response.status
                    )
                }

                return parseOrganization(body, normalizedOrganizationId)
            } finally {
                clearTimeout(timeout)
            }
        },
    }
}

function parseOrganization(value: unknown, requestedId: string): LinkedInOrganizationProfile {
    if (!isRecord(value)) {
        throw new LinkedInOrganizationError('LinkedIn organization response was invalid')
    }

    const id =
        typeof value.id === 'number' && Number.isSafeInteger(value.id)
            ? String(value.id)
            : typeof value.id === 'string'
              ? value.id.trim()
              : ''
    if (id !== requestedId) {
        throw new LinkedInOrganizationError('LinkedIn organization response had an invalid id')
    }

    const name =
        typeof value.localizedName === 'string' && value.localizedName.trim().length > 0
            ? value.localizedName
            : typeof value.name === 'string' && value.name.trim().length > 0
              ? value.name
              : null
    return { id, name }
}

function normalizeOrganizationId(value: string): string {
    const id = value.trim()
    if (!/^[1-9]\d*$/.test(id)) {
        throw new LinkedInOrganizationError(
            'LinkedIn organization id must be a positive numeric identifier'
        )
    }
    return id
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

function normalizeApiVersion(value: string): string {
    if (!/^\d{6}$/.test(value)) {
        throw new TypeError('LinkedIn API version must use the YYYYMM format')
    }
    const month = Number(value.slice(4))
    if (month < 1 || month > 12) {
        throw new TypeError('LinkedIn API version must contain a valid month')
    }
    return value
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
