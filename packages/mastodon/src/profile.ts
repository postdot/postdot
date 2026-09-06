import type { ChannelProfileDefinition } from '@herald/core'

import {
    MASTODON_DEFAULT_MAX_CHARACTERS,
    MASTODON_DEFAULT_MAX_MEDIA_ATTACHMENTS,
    MASTODON_EXECUTION_CONTRACT_REVISION,
    MASTODON_MAX_ALT_TEXT_LENGTH,
    MASTODON_MAX_LANGUAGE_LENGTH,
    MASTODON_MAX_SPOILER_TEXT_LENGTH,
    MASTODON_PROVIDER,
    mastodonVisibilityValues,
} from './contract'

export const mastodonChannelProfile: ChannelProfileDefinition = {
    id: MASTODON_PROVIDER,
    version: 1,
    profileHash: 'sha256:herald-mastodon-status-v1',
    schemaHash: 'sha256:herald-mastodon-status-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                minLength: 1,
                maxLength: MASTODON_DEFAULT_MAX_CHARACTERS,
            },
            media: {
                type: 'array',
                maxItems: MASTODON_DEFAULT_MAX_MEDIA_ATTACHMENTS,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: {
                            type: 'string',
                            minLength: 1,
                            maxLength: MASTODON_MAX_ALT_TEXT_LENGTH,
                        },
                    },
                    required: ['assetId', 'accessibilityText'],
                    additionalProperties: false,
                },
            },
            visibility: { enum: [...mastodonVisibilityValues] },
            sensitive: { type: 'boolean' },
            spoilerText: {
                type: 'string',
                minLength: 1,
                maxLength: MASTODON_MAX_SPOILER_TEXT_LENGTH,
            },
            language: { type: 'string', minLength: 2, maxLength: MASTODON_MAX_LANGUAGE_LENGTH },
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
        revision: 'mastodon-status-v1',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text'],
                maxLength: MASTODON_DEFAULT_MAX_CHARACTERS,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: MASTODON_DEFAULT_MAX_MEDIA_ATTACHMENTS,
                accessibilityTextRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: MASTODON_PROVIDER,
        revision: MASTODON_EXECUTION_CONTRACT_REVISION,
    },
}

export function readMastodonTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const text = content.text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
}

export function readMastodonStatusOptions(content: Readonly<Record<string, unknown>>): {
    readonly visibility?: (typeof mastodonVisibilityValues)[number]
    readonly sensitive?: boolean
    readonly spoilerText?: string
    readonly language?: string
} {
    const visibility = content.visibility
    const sensitive = content.sensitive
    const spoilerText = content.spoilerText
    const language = content.language

    return {
        ...(typeof visibility === 'string' &&
        (mastodonVisibilityValues as readonly string[]).includes(visibility)
            ? { visibility: visibility as (typeof mastodonVisibilityValues)[number] }
            : {}),
        ...(typeof sensitive === 'boolean' ? { sensitive } : {}),
        ...(typeof spoilerText === 'string' && spoilerText.trim().length > 0
            ? { spoilerText: spoilerText.trim() }
            : {}),
        ...(typeof language === 'string' && language.trim().length > 0
            ? { language: language.trim() }
            : {}),
    }
}
