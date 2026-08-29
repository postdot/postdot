export interface LinkedInTextPostPayload {
    readonly author: string
    readonly commentary: string
    readonly visibility: 'PUBLIC'
    readonly distribution: {
        readonly feedDistribution: 'MAIN_FEED'
        readonly targetEntities: readonly []
        readonly thirdPartyDistributionChannels: readonly []
    }
    readonly lifecycleState: 'PUBLISHED'
    readonly isReshareDisabledByAuthor: false
}

export function createLinkedInMemberTextPostPayload(input: {
    readonly memberId: string
    readonly commentary: string
}): LinkedInTextPostPayload {
    return {
        author: `urn:li:person:${input.memberId}`,
        commentary: input.commentary,
        visibility: 'PUBLIC',
        distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
    }
}
