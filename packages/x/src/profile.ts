import type { ChannelProfileDefinition } from '@postdot/core'

import {
    X_EXECUTION_CONTRACT_REVISION,
    X_MAX_ALT_TEXT_LENGTH,
    X_MAX_IMAGE_BYTES,
    X_MAX_IMAGES,
    X_PROVIDER,
} from './contract'
import {
    X_MAX_RAW_POST_TEXT_LENGTH,
    X_MAX_WEIGHTED_POST_LENGTH,
    X_TEXT_COUNTING_ALGORITHM,
} from './text'

export const xChannelProfile: ChannelProfileDefinition = {
    id: X_PROVIDER,
    version: 2,
    profileHash: 'sha256:postbot-x-post-v2',
    schemaHash: 'sha256:postbot-x-post-schema-v2',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                minLength: 1,
                maxLength: X_MAX_RAW_POST_TEXT_LENGTH,
            },
            media: {
                type: 'array',
                maxItems: X_MAX_IMAGES,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: {
                            type: 'string',
                            minLength: 1,
                            maxLength: X_MAX_ALT_TEXT_LENGTH,
                        },
                    },
                    required: ['assetId'],
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
        revision: 'x-post-v2',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text'],
                maxLength: X_MAX_RAW_POST_TEXT_LENGTH,
                maxWeightedLength: X_MAX_WEIGHTED_POST_LENGTH,
                weightedLengthAlgorithm: X_TEXT_COUNTING_ALGORITHM,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: X_MAX_IMAGES,
                maxBytesPerItem: X_MAX_IMAGE_BYTES,
                accessibilityTextRequired: false,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: X_PROVIDER,
        revision: X_EXECUTION_CONTRACT_REVISION,
    },
}

export function readXTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const text = content.text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
}
