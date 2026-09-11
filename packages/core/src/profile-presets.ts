import { Type } from 'typebox'

import type { ChannelProfileDefinition } from './channel-profile'

/**
 * A reusable starting point for creating a channel profile.
 *
 * Presets are copied into a channel profile draft by their consumer. They are
 * not references that remain authoritative after a channel is created.
 */
export interface ChannelProfilePreset {
    readonly id: string
    readonly version: number
    readonly profile: ChannelProfileDefinition
}

const manualTargetContentSchema = Type.Object(
    {
        body: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000_000 })),
        headline: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })),
        language: Type.Optional(Type.String({ minLength: 2, maxLength: 35 })),
        media: Type.Array(
            Type.Object(
                {
                    assetId: Type.String({ minLength: 1, maxLength: 255 }),
                    accessibilityText: Type.Optional(
                        Type.String({ minLength: 1, maxLength: 10_000 })
                    ),
                },
                { additionalProperties: false }
            ),
            { maxItems: 256 }
        ),
    },
    { additionalProperties: false }
)

/** A provider-neutral profile for destinations operated manually by a user. */
export function createManualChannelProfile(): ChannelProfileDefinition {
    return {
        id: 'manual-message',
        version: 1,
        profileHash: 'sha256:herald-manual-message-v1',
        schemaHash: 'sha256:herald-manual-message-schema-v1',
        origin: 'built_in',
        contentSchema: manualTargetContentSchema,
        fieldBindings: [
            { id: 'body', semantic: 'primary_text', path: '/body' },
            { id: 'headline', semantic: 'headline', path: '/headline' },
            { id: 'language', semantic: 'language', path: '/language' },
            {
                id: 'media',
                semantic: 'ordered_media',
                path: '/media',
                item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
            },
        ],
        capabilities: {
            revision: 'manual-message-v1',
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
        },
        execution: { kind: 'manual' },
    }
}
