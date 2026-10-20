import { expect, test } from 'bun:test'

import {
    readTelegramPoll,
    TELEGRAM_POLL_LIMITS,
    telegramPollError,
    type TelegramPollInput,
} from './poll'

test('reads poll drafts while keeping editable values', () => {
    expect(readTelegramPoll({ options: ['First', 'Second'] })).toEqual({
        options: ['First', 'Second'],
    })
    expect(readTelegramPoll({ options: ['First'], multiple: true, openPeriod: 600 })).toEqual({
        options: ['First'],
        multiple: true,
        openPeriod: 600,
    })
    expect(readTelegramPoll({ options: ['', '  '] })).toEqual({ options: ['', '  '] })
})

test('refuses values that are not a poll shape', () => {
    for (const value of [
        null,
        undefined,
        'poll',
        42,
        [],
        { options: 'First' },
        { options: ['First', 2] },
        { options: [] },
        { options: Array.from({ length: 13 }, (_, index) => `Option ${index}`) },
        { options: ['First'], multiple: 'yes' },
        { options: ['First'], openPeriod: '600' },
        { options: ['First'], type: 'quiz' },
        { options: ['First'], isAnonymous: true },
    ])
        expect(readTelegramPoll(value)).toBeNull()
})

test('accepts the documented poll bounds', () => {
    const poll: TelegramPollInput = {
        options: ['x'.repeat(TELEGRAM_POLL_LIMITS.maxOptionLength)],
        multiple: false,
        openPeriod: TELEGRAM_POLL_LIMITS.minOpenPeriod,
    }
    expect(telegramPollError('q', poll)).toBeNull()
    expect(telegramPollError('q'.repeat(TELEGRAM_POLL_LIMITS.maxQuestionLength), poll)).toBeNull()
    expect(
        telegramPollError('q', {
            options: poll.options,
            openPeriod: TELEGRAM_POLL_LIMITS.maxOpenPeriod,
        })
    ).toBeNull()
    expect(
        telegramPollError('😀'.repeat(TELEGRAM_POLL_LIMITS.maxQuestionLength / 2), poll)
    ).toBeNull()
})

test('rejects blanks, invalid types, counts, flags, and durations', () => {
    expect(telegramPollError('', { options: ['First'] })).toContain('question')
    expect(telegramPollError('   ', { options: ['First'] })).toContain('question')
    expect(
        telegramPollError('q'.repeat(TELEGRAM_POLL_LIMITS.maxQuestionLength + 1), {
            options: ['First'],
        })
    ).toContain('300')
    expect(telegramPollError('q', { options: ['', 'Second'] })).toContain('blank')
    expect(
        telegramPollError('q', { options: ['x'.repeat(TELEGRAM_POLL_LIMITS.maxOptionLength + 1)] })
    ).toContain('100')
    expect(telegramPollError('q', { options: [] })).toContain('12')
    expect(
        telegramPollError('q', {
            options: Array.from({ length: 13 }, (_, index) => `Option ${index}`),
        })
    ).toContain('12')
    expect(
        telegramPollError('q', {
            options: ['First'],
            multiple: 'true',
        } as unknown as TelegramPollInput)
    ).toContain('valid Telegram poll')
    expect(telegramPollError('q', { options: ['First'], openPeriod: 5.5 })).toContain(
        'whole number'
    )
    expect(telegramPollError('q', { options: ['First'], openPeriod: 4 })).toContain('whole number')
    expect(
        telegramPollError('q', {
            options: ['First'],
            openPeriod: TELEGRAM_POLL_LIMITS.maxOpenPeriod + 1,
        })
    ).toContain('whole number')
    expect(
        telegramPollError('q', {
            options: ['First'],
            openPeriod: '600',
        } as unknown as TelegramPollInput)
    ).toContain('whole number')
    expect(telegramPollError('q', { options: 'First' } as unknown as TelegramPollInput)).toContain(
        'valid Telegram poll'
    )
    expect(
        telegramPollError('q', {
            options: ['First'],
            type: 'quiz',
        } as unknown as TelegramPollInput)
    ).toContain('valid Telegram poll')
})
