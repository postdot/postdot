export const providerAnalyticsContractVersion = 1 as const

export const providerAnalyticsSubjectTypes = ['account', 'content'] as const
export type ProviderAnalyticsSubjectType = (typeof providerAnalyticsSubjectTypes)[number]

export const providerAnalyticsPostdotEntityTypes = ['channel', 'publication'] as const
export type ProviderAnalyticsPostdotEntityType =
    (typeof providerAnalyticsPostdotEntityTypes)[number]

export const providerAnalyticsAvailabilityStates = [
    'measured',
    'not_reported',
    'not_found',
    'blocked',
    'disabled',
    'temporarily_unavailable',
    'rate_limited',
    'invalid_response',
    'partial_response',
    'not_configured',
    'not_authorized',
    'not_supported',
] as const
export type ProviderAnalyticsAvailability = (typeof providerAnalyticsAvailabilityStates)[number]

export const providerAnalyticsFreshnessStates = ['fresh', 'stale', 'unknown'] as const
export type ProviderAnalyticsFreshness = (typeof providerAnalyticsFreshnessStates)[number]

export interface ProviderAnalyticsObservation {
    readonly id: string
    readonly projectId: string
    readonly provider: string
    readonly subjectType: ProviderAnalyticsSubjectType
    readonly providerSubjectId: string
    readonly providerSubjectLabel: string | null
    readonly providerContentRevisionId: string | null
    readonly postdotEntityType: ProviderAnalyticsPostdotEntityType | null
    readonly postdotEntityId: string | null
    readonly metricName: string
    readonly value: number | null
    readonly unit: string
    readonly aggregation: string
    readonly reportingPeriodStart: number | null
    readonly reportingPeriodEnd: number | null
    readonly observedAt: number | null
    readonly fetchedAt: number
    readonly availability: ProviderAnalyticsAvailability
    readonly freshness: ProviderAnalyticsFreshness
    readonly provenance: string
}

export type ProviderAnalyticsObservationInput = Omit<ProviderAnalyticsObservation, 'id'>
