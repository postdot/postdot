import type { ChannelProfileDefinition } from '@postdot/core'

import {
    BLUESKY_EXECUTION_CONTRACT_REVISION,
    BLUESKY_IMAGE_EXECUTION_CONTRACT_REVISION,
    BLUESKY_MAX_VIDEO_BYTES,
    BLUESKY_MAX_VIDEO_DURATION_MS,
    BLUESKY_MAX_ALT_TEXT_LENGTH,
    BLUESKY_MAX_GRAPHEMES,
    BLUESKY_MAX_IMAGES,
    BLUESKY_MAX_IMAGE_BYTES,
    BLUESKY_MAX_TEXT_LENGTH,
    BLUESKY_PROVIDER,
} from './contract'

export const blueskyImageChannelProfile: ChannelProfileDefinition = {
    id: BLUESKY_PROVIDER,
    version: 1,
    profileHash: 'sha256:postbot-bluesky-post-v1',
    schemaHash: 'sha256:postbot-bluesky-post-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            text: { type: 'string', minLength: 1, maxLength: BLUESKY_MAX_TEXT_LENGTH },
            media: {
                type: 'array',
                maxItems: BLUESKY_MAX_IMAGES,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: {
                            type: 'string',
                            minLength: 1,
                            maxLength: BLUESKY_MAX_ALT_TEXT_LENGTH,
                        },
                    },
                    required: ['assetId', 'accessibilityText'],
                    additionalProperties: false,
                },
            },
        },
        required: ['text', 'media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'text', semantic: 'primary_text', path: '/text' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'bluesky-post-v1',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text'],
                maxLength: BLUESKY_MAX_TEXT_LENGTH,
                maxGraphemes: BLUESKY_MAX_GRAPHEMES,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: BLUESKY_MAX_IMAGES,
                maxBytesPerItem: BLUESKY_MAX_IMAGE_BYTES,
                accessibilityTextRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: BLUESKY_PROVIDER,
        revision: BLUESKY_IMAGE_EXECUTION_CONTRACT_REVISION,
    },
}

export const blueskyChannelProfile: ChannelProfileDefinition = {
    ...blueskyImageChannelProfile,
    version: 2,
    profileHash: 'sha256:postbot-bluesky-post-v2',
    schemaHash: 'sha256:postbot-bluesky-post-schema-v2',
    capabilities: {
        ...blueskyImageChannelProfile.capabilities,
        revision: 'bluesky-post-v2',
        mediaFields: blueskyImageChannelProfile.capabilities.mediaFields.map(field => ({
            ...field,
            families: ['image', 'video'],
            mimeTypes: [...field.mimeTypes, 'video/mp4'],
            allowMixedFamilies: false,
            familyConstraints: [
                { family: 'image', maxBytesPerItem: BLUESKY_MAX_IMAGE_BYTES },
                {
                    family: 'video',
                    maxItems: 1,
                    maxBytesPerItem: BLUESKY_MAX_VIDEO_BYTES,
                    duration: {
                        minMilliseconds: 3000,
                        maxMilliseconds: BLUESKY_MAX_VIDEO_DURATION_MS,
                    },
                },
            ],
            maxBytesPerItem: BLUESKY_MAX_VIDEO_BYTES,
        })),
    },
    execution: {
        kind: 'built_in',
        contractId: BLUESKY_PROVIDER,
        revision: BLUESKY_EXECUTION_CONTRACT_REVISION,
    },
}

export function readBlueskyTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const text = content.text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
}
