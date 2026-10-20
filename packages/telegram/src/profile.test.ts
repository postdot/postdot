import { expect, test } from 'bun:test'

import { ChannelProfileCompiler } from '@postbot/core'

import {
    TELEGRAM_EXECUTION_REVISION,
    TELEGRAM_POLL_EXECUTION_REVISION,
    telegramChannelProfile,
    telegramChannelProfileValidationAdapter,
    telegramMessageChannelProfile,
} from './profile'

const compiler = new ChannelProfileCompiler({
    validationAdapters: [telegramChannelProfileValidationAdapter],
})

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
        { text: 'Hello', media: [{ assetId: 'one' }, { assetId: 'two' }] },
    ])
        expect(compiled.value.validate(content).ok).toBe(false)
})

test('keeps the historical message profile immutable beside the current poll profile', () => {
    expect(telegramMessageChannelProfile.id).toBe('telegram')
    expect(telegramMessageChannelProfile.version).toBe(1)
    expect(telegramMessageChannelProfile.execution).toEqual({
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_EXECUTION_REVISION,
    })
    expect(TELEGRAM_EXECUTION_REVISION).toBe('message-v1')
    expect(telegramChannelProfile.id).toBe(telegramMessageChannelProfile.id)
    expect(telegramChannelProfile.version).toBe(2)
    expect(telegramChannelProfile.execution).toEqual({
        kind: 'built_in',
        contractId: 'telegram',
        revision: TELEGRAM_POLL_EXECUTION_REVISION,
    })
    expect(TELEGRAM_POLL_EXECUTION_REVISION).toBe('message-v2')
    const historical = compiler.compile(telegramMessageChannelProfile)
    expect(historical.ok).toBe(true)
    if (!historical.ok) throw new Error('Telegram message profile failed compilation')
    expect(historical.value.validate({ text: 'Hello', media: [] }).ok).toBe(true)
    expect(
        historical.value.validate({ text: 'Hello', media: [], poll: { options: ['A'] } }).ok
    ).toBe(false)
})

test('accepts ordinary messages and native polls in the current profile', () => {
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
    ])
        expect(compiled.value.validate(content).ok).toBe(true)
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
