import { toDateTimeLocal } from '@/lib/date-time'

export type DeliveryMode = 'manual' | 'automatic'

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const calendarTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export interface PublicationTargetDraft {
    readonly id: string
    readonly channelId: string
    readonly content: string
    readonly deliveryMode: DeliveryMode
    readonly scheduledAt: string
}

export function createPublicationTarget(
    channelId = '',
    timeZone = 'UTC',
    calendarDate?: string
): PublicationTargetDraft {
    return {
        id: crypto.randomUUID(),
        channelId,
        content: '',
        deliveryMode: 'manual',
        scheduledAt:
            calendarDateTimeLocal(calendarDate) ??
            toDateTimeLocal(Date.now() + 60 * 60 * 1000, timeZone),
    }
}

export function parseCalendarDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined

    const match = calendarDatePattern.exec(value)
    if (match === null) return undefined

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (year < 1 || year > 9999 || month < 1 || month > 12) return undefined

    const candidate = new Date(0)
    candidate.setUTCFullYear(year, month - 1, day)
    candidate.setUTCHours(0, 0, 0, 0)

    return candidate.getUTCFullYear() === year &&
        candidate.getUTCMonth() === month - 1 &&
        candidate.getUTCDate() === day
        ? value
        : undefined
}

export function parseCalendarTime(value: unknown): string | undefined {
    return typeof value === 'string' && calendarTimePattern.test(value) ? value : undefined
}

export function calendarDateTimeLocal(value: unknown, time: unknown = '09:00'): string | undefined {
    const calendarDate = parseCalendarDate(value)
    const calendarTime = parseCalendarTime(time) ?? '09:00'
    return calendarDate === undefined ? undefined : `${calendarDate}T${calendarTime}`
}
