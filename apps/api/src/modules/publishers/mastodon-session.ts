import { normalizeMastodonInstanceOrigin } from '@postbot/mastodon'
import type { OAuthAuthorizationServer } from '@postbot/oauth'

interface MastodonProviderSession {
    readonly version: 1
    readonly instanceUrl: string
    readonly clientId: string
    readonly clientSecret: string
}

export function parseProviderSession(value: string | null): MastodonProviderSession | null {
    if (value === null) return null
    try {
        const parsed = JSON.parse(value) as Partial<MastodonProviderSession>
        if (
            parsed.version !== 1 ||
            typeof parsed.instanceUrl !== 'string' ||
            typeof parsed.clientId !== 'string' ||
            typeof parsed.clientSecret !== 'string'
        ) {
            return null
        }
        const instanceUrl = normalizeMastodonInstanceOrigin(parsed.instanceUrl)
        if (parsed.clientId.trim().length === 0 || parsed.clientSecret.trim().length === 0) {
            return null
        }
        return {
            version: 1,
            instanceUrl,
            clientId: parsed.clientId,
            clientSecret: parsed.clientSecret,
        }
    } catch {
        return null
    }
}

export function mastodonAuthorizationServer(instanceUrl: string): OAuthAuthorizationServer {
    return {
        issuer: instanceUrl,
        authorizationEndpoint: `${instanceUrl}/oauth/authorize`,
        tokenEndpoint: `${instanceUrl}/oauth/token`,
        pkce: 'required',
    }
}

export function expiryFromSeconds(seconds: number | null, now: number): number | null {
    if (seconds === null || !Number.isSafeInteger(seconds) || seconds <= 0) return null
    const expiry = now + seconds * 1_000
    return Number.isSafeInteger(expiry) ? expiry : null
}
