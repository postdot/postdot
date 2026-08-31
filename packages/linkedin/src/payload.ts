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

export interface LinkedInImagePostPayload {
    readonly author: string
    readonly commentary: string
    readonly visibility: 'PUBLIC'
    readonly distribution: {
        readonly feedDistribution: 'MAIN_FEED'
        readonly targetEntities: readonly []
        readonly thirdPartyDistributionChannels: readonly []
    }
    readonly content: {
        readonly media: {
            readonly id: string
            readonly altText?: string
        }
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

export function createLinkedInMemberImagePostPayload(input: {
    readonly memberId: string
    readonly commentary: string
    readonly imageId: string
    readonly accessibilityText?: string | null
}): LinkedInImagePostPayload {
    const accessibilityText = input.accessibilityText?.trim()

    return {
        author: `urn:li:person:${input.memberId}`,
        commentary: input.commentary,
        visibility: 'PUBLIC',
        distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
        content: {
            media:
                accessibilityText === undefined || accessibilityText.length === 0
                    ? { id: input.imageId }
                    : { id: input.imageId, altText: accessibilityText },
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
    }
}
