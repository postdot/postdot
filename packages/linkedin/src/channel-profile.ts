import type { ChannelProfileDefinition } from '@herald/core'

export const linkedinChannelProfile: ChannelProfileDefinition = {
    id: 'linkedin',
    version: 2,
    profileHash: 'sha256:herald-linkedin-member-post-v2',
    schemaHash: 'sha256:herald-linkedin-member-post-schema-v2',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            commentary: { type: 'string', minLength: 1, maxLength: 3000 },
            media: {
                type: 'array',
                maxItems: 1,
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
        revision: 'linkedin-member-post-v2',
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
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: 1,
            },
        ],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'linkedin', revision: 'member-post-v2' },
}

export function readLinkedInTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const commentary = content.commentary
    return typeof commentary === 'string' && commentary.trim().length > 0 ? commentary : null
}
