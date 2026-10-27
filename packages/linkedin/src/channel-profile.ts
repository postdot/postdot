import type { ChannelProfileDefinition } from '@postdot/core'

import { LINKEDIN_MAX_IMAGES, LINKEDIN_PROVIDER } from './contract'

export const LINKEDIN_LEGACY_EXECUTION_CONTRACT_REVISION = 'member-post-v2'

export const LINKEDIN_IMAGE_EXECUTION_CONTRACT_REVISION = 'member-post-v3'
export const LINKEDIN_EXECUTION_CONTRACT_REVISION = 'member-post-v4'

export const linkedinChannelProfile: ChannelProfileDefinition = {
    id: LINKEDIN_PROVIDER,
    version: 4,
    profileHash: 'sha256:postdot-linkedin-member-post-v4',
    schemaHash: 'sha256:postdot-linkedin-member-post-schema-v3',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            commentary: { type: 'string', minLength: 1, maxLength: 3000 },
            media: {
                type: 'array',
                maxItems: LINKEDIN_MAX_IMAGES,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: { type: 'string', minLength: 1, maxLength: 4086 },
                    },
                    required: ['assetId'],
                    additionalProperties: false,
                },
            },
        },
        required: ['commentary', 'media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'commentary', semantic: 'primary_text', path: '/commentary' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'linkedin-member-post-v4',
        textFields: [
            {
                bindingId: 'commentary',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: 3000,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image', 'video'],
                allowMixedFamilies: false,
                familyConstraints: [
                    {
                        family: 'video',
                        maxItems: 1,
                        minBytesPerItem: 75_000,
                        maxBytesPerItem: 500_000_000,
                        duration: { minMilliseconds: 3000, maxMilliseconds: 1_800_000 },
                    },
                ],
                mimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
                maxItems: LINKEDIN_MAX_IMAGES,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: LINKEDIN_PROVIDER,
        revision: LINKEDIN_EXECUTION_CONTRACT_REVISION,
    },
}

export function readLinkedInTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const commentary = content.commentary
    return typeof commentary === 'string' && commentary.trim().length > 0 ? commentary : null
}
