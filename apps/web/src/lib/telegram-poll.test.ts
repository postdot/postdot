import { describe, expect, it } from 'bun:test'

import {
    TELEGRAM_EXECUTION_REVISION,
    TELEGRAM_POLL_EXECUTION_REVISION,
    telegramChannelProfile,
} from '@postbot/telegram'
import { TELEGRAM_POLL_LIMITS } from '@postbot/telegram/poll'

import { getTargetEditorFields } from './target-editor'
import {
    TELEGRAM_POLL_DURATIONS,
    hasTelegramPoll,
    isNativeTelegramProfile,
    isTelegramPollProfile,
    telegramPollOptionLength,
    telegramPollValue,
} from './telegram-poll'
import { telegramTextLimit } from './telegram-text-constraints'

const pollProfile = {
    id: 'telegram',
    version: 2,
    origin: 'built_in',
    execution: {
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_POLL_EXECUTION_REVISION,
    },
    contentSchema: {
        type: 'object',
        properties: {
            text: { type: 'string', maxLength: 4096 },
            media: { type: 'array', maxItems: 1, items: { type: 'object' } },
            poll: {
                type: 'object',
                properties: {
                    options: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 12,
                        items: { type: 'string' },
                    },
                    multiple: { type: 'boolean' },
                    openPeriod: { type: 'integer', minimum: 5, maximum: 2628000 },
                },
                required: ['options'],
                additionalProperties: false,
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
            item: { assetIdPath: '/assetId' },
        },
    ],
    capabilities: {
        revision: 'telegram-message-v2',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text'],
                maxLength: 4096,
            },
        ],
        mediaFields: [{ bindingId: 'media', maxItems: 1 }],
        relations: [],
    },
}

const legacyProfile = {
    ...pollProfile,
    version: 1,
    execution: {
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_EXECUTION_REVISION,
    },
    contentSchema: {
        type: 'object',
        properties: {
            text: { type: 'string', maxLength: 4096 },
            media: { type: 'array', maxItems: 1, items: { type: 'object' } },
        },
        required: ['text', 'media'],
        additionalProperties: false,
    },
}

describe('Telegram poll profile gating', () => {
    it('offers the poll control only to the poll-capable built-in revision', () => {
        const fields = getTargetEditorFields(pollProfile, 'en')

        expect(fields.filter(field => field.kind === 'telegram-poll')).toEqual([
            expect.objectContaining({ path: '/poll', kind: 'telegram-poll', label: 'Poll' }),
        ])
        expect(fields.some(field => field.path.startsWith('/poll/'))).toBe(false)
    })

    it('keeps the poll control away from legacy and custom Telegram profiles', () => {
        expect(isTelegramPollProfile(legacyProfile)).toBe(false)
        expect(isTelegramPollProfile({ ...pollProfile, origin: 'custom' })).toBe(false)
        expect(
            getTargetEditorFields(legacyProfile, 'en').some(field => field.kind === 'telegram-poll')
        ).toBe(false)
        expect(
            getTargetEditorFields({ ...pollProfile, origin: 'custom' }, 'en').some(
                field => field.kind === 'telegram-poll'
            )
        ).toBe(false)
        expect(
            getTargetEditorFields(
                {
                    ...pollProfile,
                    execution: { kind: 'built_in', contractId: 'telegram', revision: 'future' },
                },
                'en'
            ).some(field => field.kind === 'telegram-poll')
        ).toBe(false)
    })

    it('recognizes native Telegram revisions without granting the poll editor', () => {
        expect(isNativeTelegramProfile(pollProfile)).toBe(true)
        expect(isNativeTelegramProfile(legacyProfile)).toBe(true)
        expect(isNativeTelegramProfile({ id: 'telegram' })).toBe(false)
        expect(
            isNativeTelegramProfile({
                execution: { kind: 'declarative_http', contractId: 'telegram' },
            })
        ).toBe(false)
    })
})

describe('Telegram poll text budget', () => {
    it('serves the published question budget while a poll is attached', () => {
        const target = { text: 'Which topic next?', media: [], poll: { options: ['A', 'B'] } }

        expect(telegramTextLimit(pollProfile, target)).toBe(TELEGRAM_POLL_LIMITS.maxQuestionLength)
        const body = getTargetEditorFields(pollProfile, 'en', target).find(
            field => field.semantic === 'primary_text'
        )
        expect(body?.maxLength).toBe(TELEGRAM_POLL_LIMITS.maxQuestionLength)
        expect(body?.textLengthUnit).toBe('utf16')
    })

    it('keeps the ordinary message budget without a poll', () => {
        expect(telegramTextLimit(pollProfile, { text: 'Hello', media: [] })).toBe(4096)
        expect(
            telegramTextLimit(pollProfile, { text: 'Hello', media: [{ assetId: 'photo' }] })
        ).toBe(1024)
        expect(telegramTextLimit(legacyProfile, { text: 'Hello', media: [] })).toBe(4096)
        expect(
            telegramTextLimit(legacyProfile, { text: 'Hello', media: [{ assetId: 'photo' }] })
        ).toBe(1024)
        expect(telegramTextLimit({ id: 'telegram' }, { text: 'Hello', media: [] })).toBeNull()
    })
})

describe('Telegram poll values', () => {
    it('writes a single-choice poll without a closing period by default', () => {
        expect(
            telegramPollValue({ options: ['A', 'B'], multiple: false, openPeriod: undefined })
        ).toEqual({ options: ['A', 'B'] })
        expect(
            telegramPollValue({ options: ['A', 'B'], multiple: true, openPeriod: 3600 })
        ).toEqual({ options: ['A', 'B'], multiple: true, openPeriod: 3600 })
    })

    it('detects an attached poll in a target', () => {
        expect(hasTelegramPoll({ poll: { options: ['A'] } })).toBe(true)
        expect(hasTelegramPoll({ text: 'Question' })).toBe(false)
        expect(hasTelegramPoll(null)).toBe(false)
    })

    it('counts poll content in UTF-16 code units', () => {
        expect(telegramPollOptionLength('abc')).toBe(3)
        expect(telegramPollOptionLength('😀')).toBe(2)
    })

    it('offers closing periods inside the published range', () => {
        for (const duration of TELEGRAM_POLL_DURATIONS) {
            expect(duration).toBeGreaterThanOrEqual(TELEGRAM_POLL_LIMITS.minOpenPeriod)
            expect(duration).toBeLessThanOrEqual(TELEGRAM_POLL_LIMITS.maxOpenPeriod)
        }
        expect([...TELEGRAM_POLL_DURATIONS]).toEqual([3600, 86400, 604800, 2592000])
    })
})

it('retains native poll controls and caption budgets on the album profile', () => {
    expect(isNativeTelegramProfile(telegramChannelProfile)).toBe(true)
    expect(isTelegramPollProfile(telegramChannelProfile)).toBe(true)
    expect(
        getTargetEditorFields(telegramChannelProfile, 'en').filter(
            field => field.kind === 'telegram-poll'
        )
    ).toHaveLength(1)
    expect(
        telegramTextLimit(telegramChannelProfile, {
            media: [{ assetId: 'photo' }, { assetId: 'video' }],
        })
    ).toBe(1024)
    expect(
        telegramTextLimit(telegramChannelProfile, { media: [], poll: { options: ['A', 'B'] } })
    ).toBe(300)
})
