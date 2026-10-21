import type {
    ChannelProfileDefinition,
    ChannelProfileValidationAdapter,
    ValidationIssue,
} from '@postbot/core'

import { TELEGRAM_ALBUM_LIMITS } from './album'
import { readTelegramPoll, TELEGRAM_POLL_LIMITS, telegramPollError } from './poll'
import {
    TELEGRAM_MAX_TEXT_LENGTH,
    TELEGRAM_MAX_CAPTION_LENGTH,
    TELEGRAM_MAX_PHOTO_BYTES,
    TELEGRAM_MAX_VIDEO_BYTES,
} from './publisher'

export const TELEGRAM_EXECUTION_REVISION = 'message-v1'
export const TELEGRAM_POLL_EXECUTION_REVISION = 'message-v2'
export const TELEGRAM_ALBUM_EXECUTION_REVISION = 'message-v3'

const telegramMediaItemSchema = {
    type: 'object',
    properties: {
        assetId: { type: 'string', minLength: 1 },
        accessibilityText: { type: 'string' },
    },
    required: ['assetId'],
    additionalProperties: false,
}

/** The historical Telegram message profile, kept immutable for existing channels. */
export const telegramMessageChannelProfile: ChannelProfileDefinition = {
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
                items: telegramMediaItemSchema,
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

const telegramPollContentSchema = {
    type: 'object',
    properties: {
        options: {
            type: 'array',
            minItems: TELEGRAM_POLL_LIMITS.minOptions,
            maxItems: TELEGRAM_POLL_LIMITS.maxOptions,
            items: { type: 'string', maxLength: TELEGRAM_POLL_LIMITS.maxOptionLength },
        },
        multiple: { type: 'boolean' },
        openPeriod: {
            type: 'integer',
            minimum: TELEGRAM_POLL_LIMITS.minOpenPeriod,
            maximum: TELEGRAM_POLL_LIMITS.maxOpenPeriod,
        },
    },
    required: ['options'],
    additionalProperties: false,
}

/**
 * The Telegram poll profile.
 *
 * It keeps the message contract of `telegramMessageChannelProfile` and adds an
 * optional poll. When a poll is present the root text carries the poll
 * question, media is excluded, and only anonymous regular polls are allowed.
 * It stays immutable beside the album profile that follows it.
 */
export const telegramPollChannelProfile: ChannelProfileDefinition = {
    ...telegramMessageChannelProfile,
    version: 2,
    profileHash: 'sha256:postbot-telegram-message-v2',
    schemaHash: 'sha256:postbot-telegram-message-schema-v2',
    contentSchema: {
        ...telegramMessageChannelProfile.contentSchema,
        properties: {
            ...((telegramMessageChannelProfile.contentSchema as Readonly<Record<string, unknown>>)
                .properties as Record<string, unknown>),
            poll: telegramPollContentSchema,
        },
    },
    capabilities: {
        ...telegramMessageChannelProfile.capabilities,
        revision: 'telegram-message-v2',
    },
    execution: {
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_POLL_EXECUTION_REVISION,
    },
}

/**
 * The current Telegram profile.
 *
 * It keeps the poll contract of `telegramPollChannelProfile` and accepts a
 * media album of up to ten photos or videos. The text is the caption of the
 * album, and an optional poll still excludes every media attachment.
 */
export const telegramChannelProfile: ChannelProfileDefinition = {
    ...telegramPollChannelProfile,
    version: 3,
    profileHash: 'sha256:postbot-telegram-message-v3',
    schemaHash: 'sha256:postbot-telegram-message-schema-v3',
    contentSchema: {
        ...telegramPollChannelProfile.contentSchema,
        properties: {
            ...((telegramPollChannelProfile.contentSchema as Readonly<Record<string, unknown>>)
                .properties as Record<string, unknown>),
            media: {
                type: 'array',
                maxItems: TELEGRAM_ALBUM_LIMITS.maxItems,
                items: telegramMediaItemSchema,
            },
        },
    },
    capabilities: {
        ...telegramPollChannelProfile.capabilities,
        revision: 'telegram-message-v3',
        mediaFields: telegramPollChannelProfile.capabilities.mediaFields.map(field => ({
            ...field,
            maxItems: TELEGRAM_ALBUM_LIMITS.maxItems,
            allowMixedFamilies: true,
        })),
    },
    execution: {
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_ALBUM_EXECUTION_REVISION,
    },
}

export const telegramChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'telegram',
    validate(profile, content) {
        if (profile.execution.kind !== 'built_in') return []
        const revision = profile.execution.revision
        if (revision === TELEGRAM_EXECUTION_REVISION) return validateMessageContent(content)
        if (
            revision !== TELEGRAM_POLL_EXECUTION_REVISION &&
            revision !== TELEGRAM_ALBUM_EXECUTION_REVISION
        )
            return []
        if (content.poll === undefined) return validateMessageContent(content)
        return validatePollContent(content)
    },
}

/** The ordinary Telegram message contract: text, or media files with a caption. */
function validateMessageContent(
    content: Readonly<Record<string, unknown>>
): readonly ValidationIssue[] {
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
}

/**
 * The poll contract of the poll and album profiles.
 *
 * A poll replaces the message body: the root text is the question and media is
 * refused instead of dropped. A malformed poll never falls back to an ordinary
 * message.
 */
function validatePollContent(
    content: Readonly<Record<string, unknown>>
): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const media = content.media
    if (Array.isArray(media) && media.length > 0)
        issues.push({
            path: '/media',
            severity: 'error',
            source: 'capability',
            code: 'telegram.poll_media_conflict',
            message: 'A Telegram poll cannot carry media attachments',
        })
    const question = content.text
    if (typeof question !== 'string') {
        issues.push({
            path: '/text',
            severity: 'error',
            source: 'capability',
            code: 'telegram.poll_question_invalid',
            message: 'Enter a poll question',
        })
        return issues
    }
    const poll = readTelegramPoll(content.poll)
    const message =
        poll === null ? 'Enter a valid Telegram poll' : telegramPollError(question, poll)
    if (message !== null)
        issues.push({
            path: '/poll',
            severity: 'error',
            source: 'capability',
            code: 'telegram.poll_invalid',
            message,
        })
    return issues
}
