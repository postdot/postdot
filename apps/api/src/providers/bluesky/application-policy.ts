import { requireNonBlank, type ProviderApplicationPolicy } from '@postdot/core'
export const blueskyApplicationPolicy = {
    id: 'bluesky',
    normalize(input, _options) {
        if (input.clientId !== undefined && input.clientId !== null)
            throw new Error('Bluesky application configuration does not accept clientId')
        if (input.clientSecret !== undefined && input.clientSecret !== null)
            throw new Error('Bluesky application configuration does not accept clientSecret')
        return {
            clientId: null,
            clientSecret: null,
            clientMetadataUrl:
                input.clientMetadataUrl == null
                    ? null
                    : httpsUrl(input.clientMetadataUrl, 'clientMetadataUrl'),
            handleResolver: httpsUrl(
                input.handleResolver ?? 'https://bsky.social',
                'handleResolver'
            ),
        }
    },
    oauthMode: input => (input.clientMetadataUrl === null ? 'loopback' : 'web'),
} as const satisfies ProviderApplicationPolicy<'bluesky'>
function httpsUrl(value: string, field: string): string {
    const normalized = requireNonBlank(value, field)
    let parsed: URL
    try {
        parsed = new URL(normalized)
    } catch {
        throw new Error(`${field} must be a valid HTTPS URL`)
    }
    if (parsed.protocol !== 'https:') throw new Error(`${field} must use HTTPS`)
    return parsed.toString()
}
