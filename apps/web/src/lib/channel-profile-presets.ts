import type { RuntimeChannelProfile } from '@/lib/api'

export interface ChannelProfileTemplate {
    readonly id: string
    readonly label: string
    readonly description: string
    readonly profile: RuntimeChannelProfile
}

const sharedContentSchema = {
    type: 'object',
    properties: {
        body: { type: 'string', minLength: 1, maxLength: 1_000_000 },
        headline: { type: 'string', minLength: 1, maxLength: 10_000 },
        language: { type: 'string', minLength: 2, maxLength: 35 },
        media: {
            type: 'array',
            maxItems: 256,
            items: {
                type: 'object',
                properties: {
                    assetId: { type: 'string', minLength: 1, maxLength: 255 },
                    accessibilityText: { type: 'string', minLength: 1, maxLength: 10_000 },
                },
                required: ['assetId'],
                additionalProperties: false,
            },
        },
    },
    required: ['body'],
    additionalProperties: false,
}

const sharedFieldBindings = [
    { id: 'body', semantic: 'primary_text', path: '/body' },
    { id: 'headline', semantic: 'headline', path: '/headline' },
    { id: 'language', semantic: 'language', path: '/language' },
    {
        id: 'media',
        semantic: 'ordered_media',
        path: '/media',
        item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
    },
]

const sharedCapabilities = {
    revision: 'herald-custom-v1',
    textFields: [
        {
            bindingId: 'body',
            acceptedSourceFormats: ['plain_text', 'markdown'],
            maxLength: 1_000_000,
        },
        {
            bindingId: 'headline',
            acceptedSourceFormats: ['plain_text', 'markdown'],
            maxLength: 10_000,
        },
        {
            bindingId: 'language',
            acceptedSourceFormats: ['plain_text', 'markdown'],
            maxLength: 35,
        },
    ],
    mediaFields: [
        {
            bindingId: 'media',
            families: ['image', 'video', 'audio', 'document'],
            mimeTypes: ['image/*', 'video/*', 'audio/*', 'application/*'],
            maxItems: 256,
        },
    ],
    relations: [],
}

function createCustomProfile(
    id: string,
    execution: Record<string, unknown>
): RuntimeChannelProfile {
    return {
        id,
        version: 1,
        profileHash: `sha256:herald-${id}-v1`,
        schemaHash: 'sha256:herald-custom-content-v1',
        origin: 'custom',
        contentSchema: sharedContentSchema,
        fieldBindings: sharedFieldBindings,
        capabilities: sharedCapabilities,
        execution,
    }
}

export const channelProfileTemplates: readonly ChannelProfileTemplate[] = [
    {
        id: 'custom-manual',
        label: 'Custom manual channel',
        description: 'A custom schema for work completed manually from the queue.',
        profile: createCustomProfile('custom-manual', { kind: 'manual' }),
    },
    {
        id: 'custom-webhook',
        label: 'Custom webhook channel',
        description: 'A custom schema delivered through Herald’s declarative webhook contract.',
        profile: createCustomProfile('custom-webhook', {
            kind: 'declarative_http',
            contractId: 'custom-webhook',
            revision: 'v1',
            mode: 'herald_webhook',
        }),
    },
]

export function profileForTemplate(templateId: string): RuntimeChannelProfile | undefined {
    return channelProfileTemplates.find(template => template.id === templateId)?.profile
}
