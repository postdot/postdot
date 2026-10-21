import { expect, test } from 'bun:test'

import { ChannelProfileCompiler } from '@postbot/core'

import {
    TELEGRAM_ALBUM_EXECUTION_REVISION,
    TELEGRAM_EXECUTION_REVISION,
    TELEGRAM_POLL_EXECUTION_REVISION,
    telegramChannelProfile,
    telegramChannelProfileValidationAdapter,
    telegramMessageChannelProfile,
    telegramPollChannelProfile,
} from './profile'

const compiler = new ChannelProfileCompiler({
    validationAdapters: [telegramChannelProfileValidationAdapter],
})

function albumContent(count: number, text = 'Caption') {
    return {
        text,
        media: Array.from({ length: count }, (_, index) => ({ assetId: `asset-${index}` })),
    }
}

test('compiles the versioned Telegram profile and enforces text versus caption budgets', () => {
    const compiled = compiler.compile(telegramChannelProfile)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) throw new Error('Telegram profile failed compilation')
    for (const content of [
        { text: 'x'.repeat(4096), media: [] },
        { text: '', media: [{ assetId: 'image' }] },
        { text: 'x'.repeat(1024), media: [{ assetId: 'image' }] },
    ])
        expect(compiled.value.validate(content).ok).toBe(true)
    for (const content of [
        { text: '', media: [] },
        { text: 'x'.repeat(1025), media: [{ assetId: 'image' }] },
        { text: '😀'.repeat(2049), media: [] },
    ])
        expect(compiled.value.validate(content).ok).toBe(false)
})

test('keeps the historical message and poll profiles immutable beside the album profile', () => {
    expect(telegramMessageChannelProfile.id).toBe('telegram')
    expect(telegramMessageChannelProfile.version).toBe(1)
    expect(telegramMessageChannelProfile.execution).toEqual({
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_EXECUTION_REVISION,
    })
    expect(TELEGRAM_EXECUTION_REVISION).toBe('message-v1')
    expect(telegramMessageChannelProfile.profileHash).toBe('sha256:postbot-telegram-message-v1')
    expect(telegramMessageChannelProfile.schemaHash).toBe(
        'sha256:postbot-telegram-message-schema-v1'
    )
    expect(telegramPollChannelProfile.id).toBe(telegramMessageChannelProfile.id)
    expect(telegramPollChannelProfile.version).toBe(2)
    expect(telegramPollChannelProfile.profileHash).toBe('sha256:postbot-telegram-message-v2')
    expect(telegramPollChannelProfile.schemaHash).toBe('sha256:postbot-telegram-message-schema-v2')
    expect(telegramPollChannelProfile.execution).toEqual({
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_POLL_EXECUTION_REVISION,
    })
    expect(TELEGRAM_POLL_EXECUTION_REVISION).toBe('message-v2')
    expect(telegramChannelProfile.id).toBe(telegramMessageChannelProfile.id)
    expect(telegramChannelProfile.version).toBe(3)
    expect(telegramChannelProfile.execution).toEqual({
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_ALBUM_EXECUTION_REVISION,
    })
    expect(TELEGRAM_ALBUM_EXECUTION_REVISION).toBe('message-v3')
    const historical = compiler.compile(telegramMessageChannelProfile)
    expect(historical.ok).toBe(true)
    if (!historical.ok) throw new Error('Telegram message profile failed compilation')
    expect(historical.value.validate({ text: 'Hello', media: [] }).ok).toBe(true)
    expect(
        historical.value.validate({ text: 'Hello', media: [], poll: { options: ['A'] } }).ok
    ).toBe(false)
    expect(
        historical.value.validate({
            text: 'Hello',
            media: [{ assetId: 'one' }, { assetId: 'two' }],
        }).ok
    ).toBe(false)
    const poll = compiler.compile(telegramPollChannelProfile)
    expect(poll.ok).toBe(true)
    if (!poll.ok) throw new Error('Telegram poll profile failed compilation')
    expect(poll.value.validate({ text: 'Choose', media: [], poll: { options: ['A'] } }).ok).toBe(
        true
    )
    expect(
        poll.value.validate({
            text: 'Hello',
            media: [{ assetId: 'one' }, { assetId: 'two' }],
        }).ok
    ).toBe(false)
})

test('accepts ordinary messages, native polls and albums in the current profile', () => {
    const compiled = compiler.compile(telegramChannelProfile)
    if (!compiled.ok) throw new Error('Telegram profile failed compilation')
    for (const content of [
        { text: 'Hello', media: [] },
        { text: 'x'.repeat(4096), media: [] },
        { text: '', media: [{ assetId: 'image' }] },
        { text: 'Choose', media: [], poll: { options: ['First', 'Second'] } },
        { text: 'Choose', media: [], poll: { options: ['First'], multiple: true } },
        {
            text: 'Choose',
            media: [],
            poll: { options: ['First', 'Second'], multiple: false, openPeriod: 5 },
        },
        albumContent(2),
        albumContent(10),
        albumContent(2, ''),
    ])
        expect(compiled.value.validate(content).ok).toBe(true)
})

test('declares the album capacity of the current profile', () => {
    const media = telegramChannelProfile.capabilities.mediaFields[0]
    expect(media?.maxItems).toBe(10)
    expect(media?.allowMixedFamilies).toBe(true)
    expect(media?.families).toEqual(['image', 'video'])
    expect(media?.mimeTypes).toEqual(['image/jpeg', 'image/png', 'video/mp4'])
    expect(telegramChannelProfile.capabilities.revision).toBe('telegram-message-v3')
})

test('refuses oversized albums, captions over the budget, and media beside a poll', () => {
    const compiled = compiler.compile(telegramChannelProfile)
    if (!compiled.ok) throw new Error('Telegram profile failed compilation')
    for (const content of [
        albumContent(11),
        albumContent(2, 'x'.repeat(1025)),
        albumContent(2, '😀'.repeat(513)),
        { text: 'Choose', media: [{ assetId: 'image' }], poll: { options: ['First'] } },
    ])
        expect(compiled.value.validate(content).ok).toBe(false)
    expect(compiled.value.validate(albumContent(2)).ok).toBe(true)
})

test('refuses media, malformed polls, and unusable poll drafts without falling back to a message', () => {
    const compiled = compiler.compile(telegramChannelProfile)
    if (!compiled.ok) throw new Error('Telegram profile failed compilation')
    for (const content of [
        { text: 'Choose', media: [{ assetId: 'image' }], poll: { options: ['First'] } },
        { text: 'Choose', media: [], poll: { options: 'First' } },
        { text: 'Choose', media: [], poll: { options: ['First'], type: 'quiz' } },
        { text: 'Choose', media: [], poll: { options: ['First'], openPeriod: 5.5 } },
        { text: 'Choose', media: [], poll: { options: ['', 'Second'] } },
        { text: 'Choose', media: [], poll: { options: [] } },
        {
            text: 'Choose',
            media: [],
            poll: { options: Array.from({ length: 13 }, (_, i) => `O${i}`) },
        },
        { text: 'x'.repeat(301), media: [], poll: { options: ['First'] } },
    ])
        expect(compiled.value.validate(content).ok).toBe(false)
    const malformed = compiled.value.validate({
        text: 'An ordinary message',
        media: [],
        poll: { options: 'First' },
    })
    expect(malformed.ok).toBe(false)
})
