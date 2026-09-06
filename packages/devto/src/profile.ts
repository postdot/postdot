import type { ChannelProfileDefinition } from '@herald/core'

import {
    DEVTO_EXECUTION_CONTRACT_REVISION,
    DEVTO_MAX_BODY_LENGTH,
    DEVTO_MAX_IMAGES,
    DEVTO_MAX_TITLE_LENGTH,
    DEVTO_PROVIDER,
} from './contract'

export const devtoChannelProfile: ChannelProfileDefinition = {
    id: DEVTO_PROVIDER,
    version: 1,
    profileHash: 'sha256:herald-devto-article-v1',
    schemaHash: 'sha256:herald-devto-article-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                minLength: 1,
                maxLength: DEVTO_MAX_TITLE_LENGTH,
            },
            body_markdown: {
                type: 'string',
                minLength: 1,
                maxLength: DEVTO_MAX_BODY_LENGTH,
            },
            media: {
                type: 'array',
                maxItems: DEVTO_MAX_IMAGES,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: { type: 'string', minLength: 1 },
                    },
                    required: ['assetId'],
                    additionalProperties: false,
                },
            },
        },
        required: ['title', 'body_markdown', 'media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'title', semantic: 'headline', path: '/title' },
        { id: 'body_markdown', semantic: 'primary_text', path: '/body_markdown' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'devto-article-v1',
        textFields: [
            {
                bindingId: 'title',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: DEVTO_MAX_TITLE_LENGTH,
            },
            {
                bindingId: 'body_markdown',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: DEVTO_MAX_BODY_LENGTH,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: DEVTO_MAX_IMAGES,
                publicUrlRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: DEVTO_PROVIDER,
        revision: DEVTO_EXECUTION_CONTRACT_REVISION,
    },
}

export function readDevtoTitleContent(content: Readonly<Record<string, unknown>>): string | null {
    const title = content.title
    return typeof title === 'string' && title.trim().length > 0 ? title : null
}

export function readDevtoBodyContent(content: Readonly<Record<string, unknown>>): string | null {
    const body = content.body_markdown
    return typeof body === 'string' && body.trim().length > 0 ? body : null
}
