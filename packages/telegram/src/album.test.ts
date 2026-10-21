// cspell:words supergroup
import { expect, test } from 'bun:test'

import {
    planTelegramAlbum,
    readTelegramAlbumAcknowledgement,
    TELEGRAM_ALBUM_LIMITS,
    telegramAlbumItemKind,
} from './album'

const token = '123456:synthetic-test-token'
const chatId = '-1001234567890'

function blob(type: string, size = 3) {
    return new Blob([new Uint8Array(size)], { type })
}

function albumChat(overrides: Record<string, unknown> = {}) {
    return { id: Number(chatId), type: 'channel', username: 'example_channel', ...overrides }
}

function acknowledgement() {
    return [
        {
            message_id: 11,
            chat: albumChat(),
            media_group_id: 'group-1',
            photo: [{ file_id: 'photo-file' }],
        },
        {
            message_id: 12,
            chat: albumChat(),
            media_group_id: 'group-1',
            video: { file_id: 'video-file' },
        },
    ]
}

test('keeps the documented album bounds', () => {
    expect(TELEGRAM_ALBUM_LIMITS).toEqual({ minItems: 2, maxItems: 10 })
})

test('reads only the album item families the contract supports', () => {
    expect(telegramAlbumItemKind({ blob: blob('image/jpeg') })).toBe('photo')
    expect(telegramAlbumItemKind({ blob: blob('image/png') })).toBe('photo')
    expect(telegramAlbumItemKind({ blob: blob('video/mp4') })).toBe('video')
    expect(telegramAlbumItemKind({ blob: blob('image/gif') })).toBeNull()
    expect(telegramAlbumItemKind({ blob: blob('application/pdf') })).toBeNull()
})

test('plans an ordered mixed album that uploads every item and captions the first only', () => {
    const plan = planTelegramAlbum(
        [{ blob: blob('image/jpeg') }, { blob: blob('video/mp4') }, { blob: blob('image/png') }],
        'Album caption'
    )
    expect(plan?.kinds).toEqual(['photo', 'video', 'photo'])
    expect(plan?.media).toEqual([
        { type: 'photo', media: 'attach://item0', caption: 'Album caption' },
        { type: 'video', media: 'attach://item1' },
        { type: 'photo', media: 'attach://item2' },
    ])
    expect(plan?.attachments.map(attachment => attachment.field)).toEqual([
        'item0',
        'item1',
        'item2',
    ])
    expect(plan?.attachments.map(attachment => attachment.fileName)).toEqual([
        'photo0.jpg',
        'video1.mp4',
        'photo2.png',
    ])
})

test('refuses an unsupported album item and never attaches a caption to a later item', () => {
    expect(
        planTelegramAlbum([{ blob: blob('image/gif') }, { blob: blob('image/png') }], 'Caption')
    ).toBeNull()
    const plan = planTelegramAlbum([{ blob: blob('image/png') }, { blob: blob('image/png') }], '')
    expect(plan?.media).toEqual([
        { type: 'photo', media: 'attach://item0' },
        { type: 'photo', media: 'attach://item1' },
    ])
})

test('accepts a complete album acknowledgement in request order', () => {
    expect(
        readTelegramAlbumAcknowledgement(acknowledgement(), {
            chatId,
            token,
            kinds: ['photo', 'video'],
        })
    ).toEqual({
        messageIds: [11, 12],
        mediaIds: ['photo-file', 'video-file'],
        chatUsername: 'example_channel',
    })
})

test('refuses a partial, mismatching or duplicated album acknowledgement', () => {
    const options = { chatId, token, kinds: ['photo', 'video'] as const }
    for (const value of [
        null,
        'album',
        acknowledgement().slice(0, 1),
        [...acknowledgement(), acknowledgement()[0]!],
        [{ ...acknowledgement()[0]!, message_id: 12 }, acknowledgement()[1]!],
        [
            { ...acknowledgement()[0]!, media_group_id: 'group-1' },
            { ...acknowledgement()[1]!, media_group_id: 'group-2' },
        ],
        [{ ...acknowledgement()[0]!, media_group_id: ' ' }, acknowledgement()[1]!],
        [{ ...acknowledgement()[0]!, media_group_id: token }, acknowledgement()[1]!],
        [{ ...acknowledgement()[0]!, media_group_id: undefined }, acknowledgement()[1]!],
        [{ ...acknowledgement()[0]!, chat: albumChat({ id: -9 }) }, acknowledgement()[1]!],
        [
            { ...acknowledgement()[0]!, chat: albumChat({ type: 'supergroup' }) },
            acknowledgement()[1]!,
        ],
        [{ ...acknowledgement()[0]!, message_id: 0 }, acknowledgement()[1]!],
        [{ ...acknowledgement()[0]!, photo: undefined }, acknowledgement()[1]!],
        [{ ...acknowledgement()[0]!, photo: [{ file_id: ' ' }] }, acknowledgement()[1]!],
        [{ ...acknowledgement()[0]!, photo: [{ file_id: token }] }, acknowledgement()[1]!],
        [acknowledgement()[0]!, { ...acknowledgement()[1]!, video: undefined }],
        [acknowledgement()[0]!, { ...acknowledgement()[1]!, video: { file_id: '' } }],
        [acknowledgement()[0]!, { ...acknowledgement()[1]!, video: { file_id: token } }],
    ])
        expect(readTelegramAlbumAcknowledgement(value, options)).toBeNull()
})

test('drops a chat username that leaks the bot token', () => {
    const value = [
        { ...acknowledgement()[0]!, chat: albumChat({ username: `owner${token}` }) },
        acknowledgement()[1]!,
    ]
    expect(
        readTelegramAlbumAcknowledgement(value, { chatId, token, kinds: ['photo', 'video'] })
    ).toEqual({
        messageIds: [11, 12],
        mediaIds: ['photo-file', 'video-file'],
        chatUsername: null,
    })
})
