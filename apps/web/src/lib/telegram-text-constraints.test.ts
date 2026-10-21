import { expect, test } from 'bun:test'

import { telegramChannelProfile } from '@postdot/telegram'

import { getComposerTextFields, countComposerText } from './composer-text-constraints'
import { getTargetEditorFields } from './target-editor'
import { telegramTextLimit } from './telegram-text-constraints'

test('Telegram execution revision controls conditional limits in the shared editor', () => {
    expect(telegramTextLimit(telegramChannelProfile)).toBe(4096)
    const target = { text: 'Caption', media: [{ assetId: 'photo' }] }
    expect(telegramTextLimit(telegramChannelProfile, target)).toBe(1024)
    const body = getComposerTextFields(telegramChannelProfile, target).body!
    expect(body.field.maxLength).toBe(1024)
    expect(countComposerText('😀'.repeat(512), body)).toMatchObject({
        characters: 1024,
        invalid: false,
    })
    expect(countComposerText('😀'.repeat(513), body)).toMatchObject({
        characters: 1026,
        invalid: true,
    })
    expect(
        getTargetEditorFields(telegramChannelProfile, 'en', target).find(
            field => field.semantic === 'primary_text'
        )?.maxLength
    ).toBe(1024)
    const restored = getComposerTextFields(telegramChannelProfile, { media: [] }).body!
    expect(restored.field.maxLength).toBe(4096)
})

test('profile names and unsupported execution revisions do not activate Telegram constraints', () => {
    for (const execution of [
        { kind: 'manual' },
        { kind: 'built_in', contractId: 'telegram', revision: 'future' },
        { kind: 'declarative_http', contractId: 'telegram', revision: 'message-v1' },
    ])
        expect(
            telegramTextLimit({ ...telegramChannelProfile, execution }, { media: [{}] })
        ).toBeNull()
})
