import type { ChannelProfileDefinition } from '@herald/core'

import {
    BLUESKY_EXECUTION_CONTRACT_REVISION,
    BLUESKY_MAX_ALT_TEXT_LENGTH,
    BLUESKY_MAX_GRAPHEMES,
    BLUESKY_MAX_IMAGES,
    BLUESKY_MAX_IMAGE_BYTES,
    BLUESKY_MAX_TEXT_LENGTH,
    BLUESKY_PROVIDER,
} from './contract'

export const blueskyChannelProfile: ChannelProfileDefinition = {
    id: BLUESKY_PROVIDER,
    version: 1,
    profileHash: 'sha256:herald-bluesky-post-v1',
    schemaHash: 'sha256:herald-bluesky-post-schema-v1',
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
        revision: BLUESKY_EXECUTION_CONTRACT_REVISION,
    },
}

export function readBlueskyTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const text = content.text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
}
