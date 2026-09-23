export const publisherCallbackResults = [
    'connected',
    'already_used',
    'authorization_denied',
    'invalid_callback',
    'invalid_destination',
    'provider_unavailable',
    'publisher_exists',
    'incompatible_profile',
] as const

export type PublisherCallbackResult = (typeof publisherCallbackResults)[number]

export function parsePublisherCallbackResult(value: unknown): PublisherCallbackResult | undefined {
    return typeof value === 'string' && isPublisherCallbackResult(value) ? value : undefined
}

export function isPublisherCallbackResult(value: string): value is PublisherCallbackResult {
    return publisherCallbackResults.includes(value as PublisherCallbackResult)
}
