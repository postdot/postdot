import type { ChannelProfileDefinition } from '@herald/core'

export const linkedinTextChannelProfile: ChannelProfileDefinition = {
    id: 'linkedin',
    version: 1,
    profileHash: 'sha256:herald-linkedin-text-v1',
    schemaHash: 'sha256:herald-linkedin-text-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            commentary: { type: 'string', minLength: 1, maxLength: 3000 },
        },
        required: ['commentary'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'commentary', semantic: 'primary_text', path: '/commentary' }],
    capabilities: {
        revision: 'linkedin-text-v1',
        textFields: [
            {
                bindingId: 'commentary',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: 3000,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'linkedin', revision: 'text-v1' },
}

export function readLinkedInTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const commentary = content.commentary
    return typeof commentary === 'string' && commentary.trim().length > 0 ? commentary : null
}
