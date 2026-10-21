import type { ExternalEffectOutcome } from '@postdot/core'

import { planTelegramAlbum, readTelegramAlbumAcknowledgement, TELEGRAM_ALBUM_LIMITS } from './album'
import { telegramPollError, type TelegramPollInput } from './poll'

export const TELEGRAM_MAX_TEXT_LENGTH = 4096
export const TELEGRAM_MAX_CAPTION_LENGTH = 1024
// Conservative decimal byte ceilings within the documented 10/50 MB limits.
export const TELEGRAM_MAX_PHOTO_BYTES = 10_000_000
export const TELEGRAM_MAX_VIDEO_BYTES = 50_000_000

export type TelegramFailureCode =
    | 'invalid_input'
    | 'invalid_response'
    | 'authentication_required'
    | 'forbidden'
    | 'destination_changed'
    | 'rate_limited'
    | 'unknown_result'
    | 'metadata_unavailable'
export type TelegramFailure = Exclude<ExternalEffectOutcome, { readonly type: 'published' }> & {
    readonly code: TelegramFailureCode
}
export type TelegramPublishOutcome =
    | (Extract<ExternalEffectOutcome, { readonly type: 'published' }> & {
          readonly externalId: string
          readonly mediaId?: string
          /** The durable media identities of an album, in request order. */
          readonly mediaIds?: readonly string[]
      })
    | TelegramFailure
export type TelegramResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly outcome: TelegramFailure }
export interface TelegramChannel {
    readonly botId: string
    readonly botUsername: string
    readonly chatId: string
    readonly title: string
    readonly username: string | null
}
export interface TelegramMedia {
    readonly blob: Blob
    readonly width: number
    readonly height: number
}
export interface TelegramSendInput {
    readonly token: string
    /** Resolved numeric channel ID, never a mutable username. */
    readonly chatId: string
    readonly text: string
    readonly media?: TelegramMedia
    /**
     * An optional media album of 2 to 10 photos or videos. It is mutually
     * exclusive with `media` and `poll`, and the text becomes the caption of
     * the first album item.
     */
    readonly album?: readonly TelegramMedia[]
    /**
     * An optional native poll. When present, `text` is the poll question and
     * media is refused instead of dropped.
     */
    readonly poll?: TelegramPollInput
}
export type TelegramFetcher = (
    input: string | URL | Request,
    init?: RequestInit
) => Promise<Response>

export function createTelegramPublisher(
    options: { readonly fetcher?: TelegramFetcher; readonly timeoutMs?: number } = {}
) {
    const fetcher = options.fetcher ?? fetch
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
        throw new Error('Telegram timeout must be between 1 and 300000 milliseconds')

    async function call(
        token: string,
        method: string,
        body: Record<string, unknown> | FormData,
        sending: boolean
    ): Promise<TelegramResult<unknown>> {
        if (!validToken(token)) return failure('Telegram bot token is invalid')
        try {
            const multipart = body instanceof FormData
            const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(timeoutMs),
                headers: multipart ? undefined : { 'content-type': 'application/json' },
                body: multipart ? body : JSON.stringify(body),
            })
            const envelope: unknown = await response.json().catch(() => null)
            if (
                response.ok &&
                record(envelope) &&
                envelope.ok === true &&
                Object.hasOwn(envelope, 'result')
            )
                return { ok: true, value: envelope.result }
            // Only a matching negative API envelope is proof of a rejected request.
            if (
                record(envelope) &&
                envelope.ok === false &&
                envelope.error_code === response.status
            ) {
                if (
                    record(envelope.parameters) &&
                    envelope.parameters.migrate_to_chat_id !== undefined
                )
                    return failure(
                        'Telegram destination changed; reconnect the channel',
                        'destination_changed'
                    )
                if (response.status === 429) {
                    const retry = record(envelope.parameters)
                        ? envelope.parameters.retry_after
                        : undefined
                    if (
                        typeof retry === 'number' &&
                        Number.isSafeInteger(retry) &&
                        retry > 0 &&
                        retry <= 31_536_000
                    )
                        return {
                            ok: false,
                            outcome: {
                                type: 'deferred',
                                effectOccurred: false,
                                resumeAfterMs: retry * 1000,
                                errorMessage: 'Telegram rate limit reached',
                                code: 'rate_limited',
                            },
                        }
                    if (retry !== undefined)
                        return failure(
                            'Telegram retry delay is invalid; inspect before retrying',
                            'rate_limited'
                        )
                    return {
                        ok: false,
                        outcome: {
                            type: 'retryable_failure',
                            effectOccurred: false,
                            errorMessage: 'Telegram rate limit reached',
                            code: 'rate_limited',
                        },
                    }
                }
                if ([400, 401, 403, 404, 413, 422].includes(response.status))
                    return failure(
                        response.status === 401
                            ? 'Telegram bot authentication failed'
                            : response.status === 403
                              ? 'Telegram posting access was denied'
                              : 'Telegram rejected the request',
                        response.status === 401
                            ? 'authentication_required'
                            : response.status === 403
                              ? 'forbidden'
                              : 'invalid_input'
                    )
            }
            return unknownResult(sending)
        } catch {
            return unknownResult(sending)
        }
    }

    /**
     * Send one native poll.
     *
     * The poll replaces the message body, so the publication text is the poll
     * question and media is refused rather than dropped. The provider
     * acknowledgement must confirm the poll before the send counts as
     * published; anything else stays ambiguous because the poll may exist.
     */
    async function sendPoll(
        input: TelegramSendInput,
        poll: TelegramPollInput
    ): Promise<TelegramPublishOutcome> {
        if (input.media !== undefined)
            return failure('A Telegram poll cannot carry media attachments').outcome
        const invalid = telegramPollError(input.text, poll)
        if (invalid !== null) return failure(invalid).outcome
        const body: Record<string, unknown> = {
            chat_id: input.chatId,
            question: input.text,
            options: poll.options.map(text => ({ text })),
            is_anonymous: true,
            type: 'regular',
            allows_multiple_answers: poll.multiple ?? false,
            ...(poll.openPeriod === undefined ? {} : { open_period: poll.openPeriod }),
        }
        const sent = await call(input.token, 'sendPoll', body, true)
        if (!sent.ok) return sent.outcome
        if (
            !record(sent.value) ||
            !positiveId(sent.value.message_id) ||
            !record(sent.value.chat) ||
            String(sent.value.chat.id) !== input.chatId ||
            sent.value.chat.type !== 'channel'
        )
            return unknownResult(true).outcome
        if (!acknowledgesPoll(sent.value.poll, input.text, poll, input.token))
            return unknownResult(true).outcome
        const messageId = sent.value.message_id
        const externalUrl = username(sent.value.chat.username)
            ? `https://t.me/${sent.value.chat.username}/${messageId}`
            : undefined
        return {
            type: 'published',
            externalId: `${input.chatId}:${messageId}`,
            ...(externalUrl ? { externalUrl } : {}),
        }
    }

    /**
     * Send one media album.
     *
     * The album carries 2 to 10 photos or videos in one `sendMediaGroup`
     * request. Every item is uploaded as its own multipart field, the text is
     * the caption of the first item only, and the request is refused locally
     * when the count, the media or the caption break the contract. The
     * provider acknowledgement must prove every item of the album, otherwise
     * the send stays ambiguous because the album may exist.
     */
    async function sendAlbum(
        input: TelegramSendInput,
        album: readonly TelegramMedia[]
    ): Promise<TelegramPublishOutcome> {
        if (
            album.length < TELEGRAM_ALBUM_LIMITS.minItems ||
            album.length > TELEGRAM_ALBUM_LIMITS.maxItems
        )
            return failure('A Telegram album needs between 2 and 10 media files').outcome
        if (!Array.from(album).every(item => validAlbumItem(item)))
            return failure('Telegram media is invalid or exceeds its limits').outcome
        const plan = planTelegramAlbum(album, input.text)
        if (plan === null) return failure('Telegram media is invalid or exceeds its limits').outcome
        if (input.text.length > TELEGRAM_MAX_CAPTION_LENGTH)
            return failure('Telegram message exceeds its text or caption constraints').outcome
        const form = new FormData()
        form.set('chat_id', input.chatId)
        form.set('media', JSON.stringify(plan.media))
        for (const attachment of plan.attachments)
            form.set(attachment.field, attachment.blob, attachment.fileName)
        const sent = await call(input.token, 'sendMediaGroup', form, true)
        if (!sent.ok) return sent.outcome
        const acknowledgement = readTelegramAlbumAcknowledgement(sent.value, {
            chatId: input.chatId,
            token: input.token,
            kinds: plan.kinds,
        })
        if (acknowledgement === null) return unknownResult(true).outcome
        const firstMessageId = acknowledgement.messageIds[0]
        if (firstMessageId === undefined) return unknownResult(true).outcome
        const externalUrl = username(acknowledgement.chatUsername)
            ? `https://t.me/${acknowledgement.chatUsername}/${firstMessageId}`
            : undefined
        return {
            type: 'published',
            externalId: `${input.chatId}:${acknowledgement.messageIds.join(',')}`,
            mediaIds: acknowledgement.mediaIds,
            ...(externalUrl ? { externalUrl } : {}),
        }
    }

    return {
        async verifyChannel(
            token: string,
            reference: string
        ): Promise<TelegramResult<TelegramChannel>> {
            if (
                !validToken(token) ||
                !(isTelegramChannelId(reference) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(reference))
            )
                return failure('Telegram bot token or channel reference is invalid')
            const bot = await call(token, 'getMe', {}, false)
            if (!bot.ok) return bot
            if (
                !record(bot.value) ||
                bot.value.is_bot !== true ||
                !positiveId(bot.value.id) ||
                !username(bot.value.username)
            )
                return failure('Telegram bot metadata is invalid', 'invalid_response')
            const botId = bot.value.id
            const botUsername = bot.value.username
            const chat = await call(token, 'getChat', { chat_id: reference }, false)
            if (!chat.ok) return chat
            if (
                !record(chat.value) ||
                chat.value.type !== 'channel' ||
                !negativeId(chat.value.id) ||
                typeof chat.value.title !== 'string' ||
                !chat.value.title.trim() ||
                (chat.value.username !== undefined && !username(chat.value.username)) ||
                (reference.startsWith('-') && String(chat.value.id) !== reference) ||
                (reference.startsWith('@') &&
                    (typeof chat.value.username !== 'string' ||
                        chat.value.username.toLowerCase() !== reference.slice(1).toLowerCase()))
            )
                return failure(
                    'Telegram destination must be a valid broadcast channel',
                    'invalid_response'
                )
            const chatId = String(chat.value.id)
            const member = await call(
                token,
                'getChatMember',
                { chat_id: chatId, user_id: botId },
                false
            )
            if (!member.ok) return member
            if (
                !record(member.value) ||
                !record(member.value.user) ||
                member.value.user.id !== botId ||
                member.value.user.is_bot !== true ||
                member.value.status !== 'administrator' ||
                member.value.can_post_messages !== true
            )
                return failure(
                    'Telegram bot needs channel administrator posting rights',
                    'forbidden'
                )
            return {
                ok: true,
                value: {
                    botId: String(botId),
                    botUsername,
                    chatId,
                    title: chat.value.title
                        .replaceAll(token, '[redacted]')
                        .replaceAll(encodeURIComponent(token), '[redacted]'),
                    username: typeof chat.value.username === 'string' ? chat.value.username : null,
                },
            }
        },
        async send(input: TelegramSendInput): Promise<TelegramPublishOutcome> {
            if (
                !validToken(input.token) ||
                !isTelegramChannelId(input.chatId) ||
                typeof input.text !== 'string' ||
                (input.album !== undefined && !Array.isArray(input.album))
            )
                return failure('Telegram message input is invalid').outcome
            const media = input.media
            const album = input.album
            const poll = input.poll
            if (poll !== undefined) {
                if (album !== undefined)
                    return failure('A Telegram poll cannot carry media attachments').outcome
                return sendPoll(input, poll)
            }
            if (media !== undefined && album !== undefined)
                return failure('Telegram media and album cannot be combined').outcome
            if (album !== undefined) return sendAlbum(input, album)
            // Plain text uses a conservative UTF-16 ceiling, including astral characters.
            if (
                input.text.length >
                    (media ? TELEGRAM_MAX_CAPTION_LENGTH : TELEGRAM_MAX_TEXT_LENGTH) ||
                (!media && !input.text.trim())
            )
                return failure('Telegram message exceeds its text or caption constraints').outcome
            let body: Record<string, unknown> | FormData = {
                chat_id: input.chatId,
                text: input.text,
            }
            let method = 'sendMessage'
            if (media) {
                if (!validMedia(media))
                    return failure('Telegram media is invalid or exceeds its limits').outcome
                const photo = media.blob.type !== 'video/mp4'
                method = photo ? 'sendPhoto' : 'sendVideo'
                const form = new FormData()
                form.set('chat_id', input.chatId)
                form.set('caption', input.text)
                form.set(
                    photo ? 'photo' : 'video',
                    media.blob,
                    photo
                        ? media.blob.type === 'image/png'
                            ? 'photo.png'
                            : 'photo.jpg'
                        : 'video.mp4'
                )
                body = form
            }
            const sent = await call(input.token, method, body, true)
            if (!sent.ok) return sent.outcome
            if (
                !record(sent.value) ||
                !positiveId(sent.value.message_id) ||
                !record(sent.value.chat) ||
                String(sent.value.chat.id) !== input.chatId ||
                sent.value.chat.type !== 'channel'
            )
                return unknownResult(true).outcome
            let mediaId: string | undefined
            if (media) {
                const resultMedia =
                    media.blob.type === 'video/mp4'
                        ? sent.value.video
                        : Array.isArray(sent.value.photo)
                          ? sent.value.photo.at(-1)
                          : null
                if (
                    !record(resultMedia) ||
                    typeof resultMedia.file_id !== 'string' ||
                    !resultMedia.file_id.trim() ||
                    resultMedia.file_id.includes(input.token) ||
                    resultMedia.file_id.includes(encodeURIComponent(input.token))
                )
                    return unknownResult(true).outcome
                mediaId = resultMedia.file_id
            }
            const chatId = input.chatId
            const messageId = sent.value.message_id
            const externalUrl = username(sent.value.chat.username)
                ? `https://t.me/${sent.value.chat.username}/${messageId}`
                : undefined
            return {
                type: 'published',
                externalId: `${chatId}:${messageId}`,
                ...(mediaId ? { mediaId } : {}),
                ...(externalUrl ? { externalUrl } : {}),
            }
        },
    }
}

/**
 * Confirm that the provider acknowledged the poll that was requested.
 *
 * The acknowledgement must carry the poll identity, the same question and
 * options, and the anonymity, type, and answer mode that were sent. A partial
 * or different acknowledgement leaves the poll unproven.
 */
function acknowledgesPoll(
    value: unknown,
    question: string,
    poll: TelegramPollInput,
    token: string
): boolean {
    if (!record(value)) return false
    if (typeof value.id !== 'string' || !value.id.trim()) return false
    if (value.id.includes(token) || value.id.includes(encodeURIComponent(token))) return false
    if (value.question !== question) return false
    if (value.is_anonymous !== true) return false
    if (value.type !== 'regular') return false
    if (value.allows_multiple_answers !== (poll.multiple ?? false)) return false
    if (!Array.isArray(value.options)) return false
    if (value.options.length !== poll.options.length) return false
    return value.options.every(
        (option, index) => record(option) && option.text === poll.options[index]
    )
}
function validMedia(media: TelegramMedia) {
    if (!(media.blob instanceof Blob)) return false
    const photo = ['image/jpeg', 'image/png'].includes(media.blob.type)
    return (
        (photo || media.blob.type === 'video/mp4') &&
        media.blob.size > 0 &&
        media.blob.size <= (photo ? TELEGRAM_MAX_PHOTO_BYTES : TELEGRAM_MAX_VIDEO_BYTES) &&
        Number.isSafeInteger(media.width) &&
        Number.isSafeInteger(media.height) &&
        media.width > 0 &&
        media.height > 0 &&
        (!photo ||
            (media.width + media.height <= 10000 &&
                Math.max(media.width / media.height, media.height / media.width) <= 20))
    )
}
/** Guard one album item against a caller that ignores the declared shape. */
function validAlbumItem(item: unknown): boolean {
    if (item === null || typeof item !== 'object') return false
    return validMedia(item as TelegramMedia)
}
function validToken(token: string) {
    return typeof token === 'string' && token.length <= 512 && /^\d+:[A-Za-z0-9_-]+$/.test(token)
}
function username(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)
}
function positiveId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function negativeId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value < 0
}
function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function failure(
    errorMessage: string,
    code: TelegramFailureCode = 'invalid_input'
): { readonly ok: false; readonly outcome: TelegramFailure } {
    return {
        ok: false,
        outcome: { type: 'permanent_failure', effectOccurred: false, errorMessage, code },
    }
}
function unknownResult(sending: boolean): {
    readonly ok: false
    readonly outcome: TelegramFailure
} {
    return {
        ok: false,
        outcome: sending
            ? {
                  type: 'ambiguous',
                  code: 'unknown_result',
                  errorMessage: 'Telegram send result is unknown; inspect before retrying',
              }
            : {
                  type: 'retryable_failure',
                  effectOccurred: false,
                  errorMessage: 'Telegram metadata request failed',
                  code: 'metadata_unavailable',
              },
    }
}

export function isTelegramChannelId(value: string) {
    return (
        typeof value === 'string' &&
        /^-\d+$/.test(value) &&
        negativeId(Number(value)) &&
        String(Number(value)) === value
    )
}
