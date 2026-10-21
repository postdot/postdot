import type { ChannelProfileDefinition } from '@postdot/core'

import {
    DISCORD_EXECUTION_CONTRACT_REVISION,
    DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION,
    DISCORD_MAX_VIDEO_BYTES,
    DISCORD_MAX_ATTACHMENTS,
    DISCORD_MAX_CONTENT_LENGTH,
    DISCORD_MAX_DESCRIPTION_LENGTH,
    DISCORD_PROVIDER,
} from './contract'

export const discordImageChannelProfile: ChannelProfileDefinition = {
    id: DISCORD_PROVIDER,
    version: 1,
    profileHash: 'sha256:postbot-discord-message-v1',
    schemaHash: 'sha256:postbot-discord-message-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                minLength: 1,
                maxLength: DISCORD_MAX_CONTENT_LENGTH,
            },
            media: {
                type: 'array',
                maxItems: DISCORD_MAX_ATTACHMENTS,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: {
                            type: 'string',
                            minLength: 1,
                            maxLength: DISCORD_MAX_DESCRIPTION_LENGTH,
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
        revision: 'discord-message-v1',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text'],
                maxLength: DISCORD_MAX_CONTENT_LENGTH,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: DISCORD_MAX_ATTACHMENTS,
                accessibilityTextRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: DISCORD_PROVIDER,
        revision: DISCORD_IMAGE_EXECUTION_CONTRACT_REVISION,
    },
}

export const discordChannelProfile: ChannelProfileDefinition = {
    ...discordImageChannelProfile,
    version: 2,
    profileHash: 'sha256:postbot-discord-message-v2',
    schemaHash: 'sha256:postbot-discord-message-schema-v2',
    capabilities: {
        ...discordImageChannelProfile.capabilities,
        revision: 'discord-message-v2',
        mediaFields: discordImageChannelProfile.capabilities.mediaFields.map(field => ({
            ...field,
            families: ['image', 'video'],
            mimeTypes: [...field.mimeTypes, 'video/mp4'],
            allowMixedFamilies: false,
            familyConstraints: [
                {
                    family: 'video',
                    maxItems: 1,
                    maxBytesPerItem: DISCORD_MAX_VIDEO_BYTES,
                    duration: { minMilliseconds: 3000, maxMilliseconds: 1_800_000 },
                },
            ],
        })),
    },
    execution: {
        kind: 'built_in',
        contractId: DISCORD_PROVIDER,
        revision: DISCORD_EXECUTION_CONTRACT_REVISION,
    },
}

export function readDiscordTextContent(content: Readonly<Record<string, unknown>>): string | null {
    const text = content.text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
}

export function normalizeDiscordChannelId(value: string): string {
    const id = value.trim()
    if (!/^\d{17,20}$/.test(id)) {
        throw new Error('Discord channel ID must be a 17 to 20 digit snowflake')
    }
    return id
}

export function isDiscordChannelId(value: string): boolean {
    try {
        normalizeDiscordChannelId(value)
        return true
    } catch {
        return false
    }
}

export function normalizeDiscordBotToken(value: string): string {
    if (value.trim().length === 0 || /\s/.test(value)) {
        throw new Error('Discord Bot token must not be blank or contain whitespace')
    }
    const token = value.trim().startsWith('Bot ') ? value.trim().slice(4) : value.trim()
    if (token.length < 32 || /\s/.test(token)) {
        throw new Error('Discord Bot token is invalid')
    }
    return token
}
