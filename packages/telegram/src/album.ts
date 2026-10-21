/**
 * Telegram media album contract.
 *
 * The Bot API `sendMediaGroup` method accepts 2 to 10 photo or video items in
 * one request and answers with one Message per item. Photos and videos may be
 * mixed, but every item is uploaded: the protocol never sends a remote URL or
 * a stored file id as album input, so every item is attached to the multipart
 * request and referenced with `attach://`.
 */
export const TELEGRAM_ALBUM_LIMITS = {
    minItems: 2,
    maxItems: 10,
} as const

/** One album item: the uploaded blob and the family it belongs to. */
export interface TelegramAlbumItem {
    readonly blob: Blob
}

export type TelegramAlbumItemKind = 'photo' | 'video'

/** One `InputMedia` entry of the `sendMediaGroup` payload. */
export interface TelegramAlbumInputMedia {
    readonly type: TelegramAlbumItemKind
    /** Always an `attach://` reference to a multipart file field. */
    readonly media: string
    readonly caption?: string
}

/** One multipart file field carrying an uploaded album item. */
export interface TelegramAlbumAttachment {
    readonly field: string
    readonly blob: Blob
    readonly fileName: string
}

export interface TelegramAlbumPlan {
    readonly media: readonly TelegramAlbumInputMedia[]
    readonly attachments: readonly TelegramAlbumAttachment[]
    readonly kinds: readonly TelegramAlbumItemKind[]
}

/** The proven facts of an album acknowledgement. */
export interface TelegramAlbumAcknowledgement {
    readonly messageIds: readonly number[]
    readonly mediaIds: readonly string[]
    readonly chatUsername: string | null
}

/**
 * Read the family of an album item.
 *
 * Only the two families the album contract supports are accepted: JPEG and PNG
 * photos and MP4 videos.
 */
export function telegramAlbumItemKind(item: TelegramAlbumItem): TelegramAlbumItemKind | null {
    if (!(item.blob instanceof Blob)) return null
    if (item.blob.type === 'image/jpeg' || item.blob.type === 'image/png') return 'photo'
    if (item.blob.type === 'video/mp4') return 'video'
    return null
}

/**
 * Describe the album payload of a `sendMediaGroup` request.
 *
 * The items keep their request order, every item is uploaded as its own
 * multipart field, and only the first item carries the caption because an
 * album shows a single caption. An unsupported item family yields `null` so
 * the caller can refuse the request before contacting the provider.
 */
export function planTelegramAlbum(
    items: readonly TelegramAlbumItem[],
    caption: string
): TelegramAlbumPlan | null {
    const media: TelegramAlbumInputMedia[] = []
    const attachments: TelegramAlbumAttachment[] = []
    const kinds: TelegramAlbumItemKind[] = []
    for (const [index, item] of items.entries()) {
        const kind = telegramAlbumItemKind(item)
        if (kind === null) return null
        kinds.push(kind)
        const field = `item${index}`
        attachments.push({
            field,
            blob: item.blob,
            fileName: albumFileName(item.blob, kind, index),
        })
        media.push({
            type: kind,
            media: `attach://${field}`,
            ...(index === 0 && caption.length > 0 ? { caption } : {}),
        })
    }
    return { media, attachments, kinds }
}

/**
 * Read the provider acknowledgement of an album.
 *
 * The acknowledgement must prove the whole album: one message per uploaded
 * item in request order, every message in the requested channel, unique
 * positive message ids, one shared media group, and the media identity of the
 * expected family for each index. Anything partial, duplicated or mismatched
 * stays unproven and returns `null`.
 */
export function readTelegramAlbumAcknowledgement(
    value: unknown,
    options: {
        readonly chatId: string
        readonly token: string
        readonly kinds: readonly TelegramAlbumItemKind[]
    }
): TelegramAlbumAcknowledgement | null {
    if (!Array.isArray(value)) return null
    if (value.length !== options.kinds.length) return null
    const messageIds: number[] = []
    const mediaIds: string[] = []
    const seen = new Set<number>()
    let groupId: string | null = null
    let chatUsername: string | null = null
    for (const [index, item] of value.entries()) {
        if (!record(item)) return null
        const messageId = item.message_id
        if (!positiveId(messageId) || seen.has(messageId)) return null
        seen.add(messageId)
        const chat = item.chat
        if (!record(chat) || String(chat.id) !== options.chatId || chat.type !== 'channel')
            return null
        const mediaGroupId = item.media_group_id
        if (typeof mediaGroupId !== 'string' || !mediaGroupId.trim()) return null
        if (leaksSecret(mediaGroupId, options.token)) return null
        if (groupId === null) groupId = mediaGroupId
        else if (mediaGroupId !== groupId) return null
        const kind = options.kinds[index]
        if (kind === undefined) return null
        const fileId = mediaFileId(item, kind, options.token)
        if (fileId === null) return null
        messageIds.push(messageId)
        mediaIds.push(fileId)
        if (
            index === 0 &&
            typeof chat.username === 'string' &&
            !leaksSecret(chat.username, options.token)
        )
            chatUsername = chat.username
    }
    return { messageIds, mediaIds, chatUsername }
}

/** The durable file identity of the media family the request expected. */
function mediaFileId(
    item: Record<string, unknown>,
    kind: TelegramAlbumItemKind,
    token: string
): string | null {
    const candidate =
        kind === 'photo'
            ? Array.isArray(item.photo) && item.photo.length > 0
                ? item.photo.at(-1)
                : null
            : item.video
    if (!record(candidate)) return null
    const fileId = candidate.file_id
    if (typeof fileId !== 'string' || !fileId.trim()) return null
    if (leaksSecret(fileId, token)) return null
    return fileId
}

function albumFileName(blob: Blob, kind: TelegramAlbumItemKind, index: number): string {
    if (kind === 'video') return `video${index}.mp4`
    return blob.type === 'image/png' ? `photo${index}.png` : `photo${index}.jpg`
}

function leaksSecret(value: string, token: string): boolean {
    if (!token) return false
    return value.includes(token) || value.includes(encodeURIComponent(token))
}

function positiveId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
