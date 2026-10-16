import type { ChannelProfileDefinition, ChannelProfileValidationAdapter } from '@postbot/core'

import {
    TELEGRAM_MAX_TEXT_LENGTH,
    TELEGRAM_MAX_CAPTION_LENGTH,
    TELEGRAM_MAX_PHOTO_BYTES,
    TELEGRAM_MAX_VIDEO_BYTES,
} from './publisher'

export const TELEGRAM_EXECUTION_REVISION = 'message-v1'
export const telegramChannelProfile: ChannelProfileDefinition = {
    id: 'telegram',
    version: 1,
    profileHash: 'sha256:postbot-telegram-message-v1',
    schemaHash: 'sha256:postbot-telegram-message-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            text: { type: 'string', maxLength: TELEGRAM_MAX_TEXT_LENGTH },
            media: {
                type: 'array',
                maxItems: 1,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: { type: 'string' },
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
        revision: 'telegram-message-v1',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text'],
                maxLength: TELEGRAM_MAX_TEXT_LENGTH,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image', 'video'],
                mimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
                maxItems: 1,
                accessibilityTextRequired: false,
                allowMixedFamilies: false,
                familyConstraints: [
                    { family: 'image', maxBytesPerItem: TELEGRAM_MAX_PHOTO_BYTES },
                    { family: 'video', maxBytesPerItem: TELEGRAM_MAX_VIDEO_BYTES },
                ],
            },
        ],
        relations: [],
    },
    execution: { kind: 'built_in', contractId: 'telegram', revision: TELEGRAM_EXECUTION_REVISION },
}

export const telegramChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'telegram',
    validate(profile, content) {
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.revision !== TELEGRAM_EXECUTION_REVISION
        )
            return []
        const text = content.text
        if (typeof text !== 'string' || !Array.isArray(content.media)) return []
        const media = content.media.length > 0
        if (!media && !text.trim())
            return [
                {
                    path: '/text',
                    severity: 'error',
                    source: 'capability',
                    code: 'telegram.text_required',
                    message: 'Enter text or attach one media file',
                },
            ]
        if (text.length > (media ? TELEGRAM_MAX_CAPTION_LENGTH : TELEGRAM_MAX_TEXT_LENGTH))
            return [
                {
                    path: '/text',
                    severity: 'error',
                    source: 'capability',
                    code: media ? 'telegram.caption_limit' : 'telegram.text_limit',
                    message: media
                        ? 'The Telegram caption exceeds the 1024 UTF-16 code-unit budget'
                        : 'The Telegram text exceeds the 4096 UTF-16 code-unit budget',
                },
            ]
        return []
    },
}
