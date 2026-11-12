import type { ChannelProfileDefinition, ChannelProfileValidationAdapter } from '@postdot/core'

import {
    INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH,
    INSTAGRAM_MAX_CAPTION_LENGTH,
    INSTAGRAM_MAX_IMAGE_BYTES,
} from './publisher'

export const INSTAGRAM_IMAGE_EXECUTION_REVISION = 'image-v1'
export const INSTAGRAM_EXECUTION_REVISION = 'carousel-v2'
export const INSTAGRAM_CAPABILITIES_REVISION = 'instagram-carousel-v2'

/** One JPEG with an optional caption and optional accessibility text. */
export const instagramImageChannelProfile: ChannelProfileDefinition = {
    id: 'instagram',
    version: 1,
    profileHash: 'sha256:postdot-instagram-image-v1',
    schemaHash: 'sha256:postdot-instagram-image-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            caption: { type: 'string', maxLength: INSTAGRAM_MAX_CAPTION_LENGTH },
            media: {
                type: 'array',
                minItems: 1,
                maxItems: 1,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: {
                            type: 'string',
                            minLength: 1,
                            maxLength: INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH,
                        },
                    },
                    required: ['assetId'],
                    additionalProperties: false,
                },
            },
        },
        required: ['media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'caption', semantic: 'primary_text', path: '/caption' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'instagram-image-v1',
        textFields: [
            {
                bindingId: 'caption',
                acceptedSourceFormats: ['plain_text'],
                maxLength: INSTAGRAM_MAX_CAPTION_LENGTH,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg'],
                maxItems: 1,
                maxBytesPerItem: INSTAGRAM_MAX_IMAGE_BYTES,
                accessibilityTextRequired: false,
                allowMixedFamilies: false,
                // Instagram fetches the image itself, so the media must be reachable.
                publicUrlRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: 'instagram',
        revision: INSTAGRAM_IMAGE_EXECUTION_REVISION,
    },
}

const imageSchema = instagramImageChannelProfile.contentSchema as Readonly<
    Record<string, unknown>
> & { readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>> }

/** Ordered JPEG carousels use one caption and the same image envelope. */
export const instagramChannelProfile: ChannelProfileDefinition = {
    ...instagramImageChannelProfile,
    version: 2,
    profileHash: 'sha256:postdot-instagram-carousel-v2',
    schemaHash: 'sha256:postdot-instagram-carousel-schema-v2',
    contentSchema: {
        ...instagramImageChannelProfile.contentSchema,
        properties: {
            ...imageSchema.properties,
            media: {
                ...imageSchema.properties.media,
                maxItems: 10,
            },
        },
    },
    capabilities: {
        ...instagramImageChannelProfile.capabilities,
        revision: INSTAGRAM_CAPABILITIES_REVISION,
        mediaFields: instagramImageChannelProfile.capabilities.mediaFields.map(field => ({
            ...field,
            maxItems: 10,
        })),
    },
    execution: {
        kind: 'built_in',
        contractId: 'instagram',
        revision: INSTAGRAM_EXECUTION_REVISION,
    },
}

export const instagramChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'instagram',
    validate(profile, content) {
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.contractId !== 'instagram' ||
            ![INSTAGRAM_EXECUTION_REVISION, INSTAGRAM_IMAGE_EXECUTION_REVISION].includes(
                profile.execution.revision
            )
        )
            return []
        // Structural errors belong to the schema validator.
        if (!Array.isArray(content.media)) return []
        const issues: {
            readonly path: string
            readonly severity: 'error'
            readonly source: 'capability'
            readonly code: string
            readonly message: string
        }[] = []
        for (const [index, item] of content.media.entries()) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
            const accessibilityText = (item as { accessibilityText?: unknown }).accessibilityText
            if (typeof accessibilityText === 'string' && accessibilityText.trim().length === 0)
                issues.push({
                    path: `/media/${index}/accessibilityText`,
                    severity: 'error',
                    source: 'capability',
                    code: 'instagram.accessibility_text_blank',
                    message: 'Describe the image instead of leaving the accessibility text blank',
                })
        }
        return issues
    },
}
