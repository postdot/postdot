import { expect, test } from 'bun:test'

import { ChannelProfileCompiler } from '@postbot/core'

import { telegramChannelProfile, telegramChannelProfileValidationAdapter } from './profile'

test('compiles the versioned Telegram profile and enforces text versus caption budgets', () => {
    const compiled = new ChannelProfileCompiler({
        validationAdapters: [telegramChannelProfileValidationAdapter],
    }).compile(telegramChannelProfile)
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
