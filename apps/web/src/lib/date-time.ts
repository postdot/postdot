import * as m from '@/paraglide/messages.js'

export type DateTimeLocalError = 'invalid' | 'nonexistent' | 'ambiguous' | 'past'
export type DateTimeLocalResult = number | null | DateTimeLocalError

export interface ZonedDateTimeParts {
    readonly year: number
    readonly month: number
    readonly day: number
    readonly hour: number
    readonly minute: number
}

const minuteMilliseconds = 60_000
const searchWindowMilliseconds = 36 * 60 * minuteMilliseconds
const probeStepMilliseconds = 30 * minuteMilliseconds
const partsFormatters = new Map<string, Intl.DateTimeFormat>()
const displayFormatters = new Map<string, Intl.DateTimeFormat>()

export function parseDateTimeLocal(value: string, timeZone = 'UTC'): DateTimeLocalResult {
    if (value === '') return null

    const civil = parseCivilDateTime(value)
    if (civil === null) return 'invalid'

    try {
        const naiveTimestamp = toUtcTimestamp(civil)
        const offsets = new Set<number>()

        for (
            let probe = naiveTimestamp - searchWindowMilliseconds;
            probe <= naiveTimestamp + searchWindowMilliseconds;
            probe += probeStepMilliseconds
        ) {
            const zoned = getZonedDateTimeParts(probe, timeZone)
            const reconstructed = toUtcTimestamp(zoned)
            offsets.add((reconstructed - probe) / minuteMilliseconds)
        }

        const candidates = [...offsets]
            .map(offset => naiveTimestamp - offset * minuteMilliseconds)
            .filter(candidate => sameDateTime(getZonedDateTimeParts(candidate, timeZone), civil))
            .filter((candidate, index, values) => values.indexOf(candidate) === index)
            .sort((left, right) => left - right)

        if (candidates.length === 0) return 'nonexistent'
        if (candidates.length > 1) return 'ambiguous'
        return candidates[0] ?? 'invalid'
    } catch {
        return 'invalid'
    }
}

export function toDateTimeLocal(timestamp: number | null, timeZone = 'UTC'): string {
    if (timestamp === null) return ''

    try {
        const parts = getZonedDateTimeParts(timestamp, timeZone)
        return (
            `${parts.year}`.padStart(4, '0') +
            `-${`${parts.month}`.padStart(2, '0')}` +
            `-${`${parts.day}`.padStart(2, '0')}` +
            `T${`${parts.hour}`.padStart(2, '0')}:${`${parts.minute}`.padStart(2, '0')}`
        )
    } catch {
        return ''
    }
}

export function getZonedDateTimeParts(timestamp: number, timeZone: string): ZonedDateTimeParts {
    const parts = getPartsFormatter(timeZone).formatToParts(new Date(timestamp))
    const values = new Map(parts.map(part => [part.type, part.value]))

    return {
        year: parsePart(values, 'year'),
        month: parsePart(values, 'month'),
        day: parsePart(values, 'day'),
        hour: parsePart(values, 'hour'),
        minute: parsePart(values, 'minute'),
    }
}

export function formatProjectDateTime(
    timestamp: number | null,
    timeZone: string,
    locale = 'en',
    unscheduledLabel = m.publication_unscheduled()
): string {
    if (timestamp === null || !Number.isFinite(timestamp)) return unscheduledLabel
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return unscheduledLabel
    return getDisplayFormatter(timeZone, locale).format(date)
}

export function dateTimeLocalErrorMessage(error: DateTimeLocalError): string {
    if (error === 'nonexistent') {
        return m.editor_schedule_nonexistent()
    }
    if (error === 'ambiguous') {
        return m.editor_schedule_ambiguous()
    }
    if (error === 'past') {
        return m.editor_schedule_past()
    }
    return m.editor_schedule_invalid()
}

export function getBrowserTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function getPartsFormatter(timeZone: string) {
    const cached = partsFormatters.get(timeZone)
    if (cached !== undefined) return cached

    const formatter = new Intl.DateTimeFormat('en-US', {
        calendar: 'gregory',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
        minute: '2-digit',
        month: '2-digit',
        numberingSystem: 'latn',
        timeZone,
        year: 'numeric',
    })
    partsFormatters.set(timeZone, formatter)
    return formatter
}

function getDisplayFormatter(timeZone: string, locale: string) {
    const key = `${locale}:${timeZone}`
    const cached = displayFormatters.get(key)
    if (cached !== undefined) return cached

    const formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
    })
    displayFormatters.set(key, formatter)
    return formatter
}

function parseCivilDateTime(value: string): ZonedDateTimeParts | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
    if (match === null) return null

    const parts = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
    }
    if (!isValidCivilDateTime(parts)) return null
    return parts
}

function isValidCivilDateTime(parts: ZonedDateTimeParts) {
    return (
        parts.year >= 1 &&
        parts.year <= 9999 &&
        parts.month >= 1 &&
        parts.month <= 12 &&
        parts.day >= 1 &&
        parts.day <= daysInMonth(parts.year, parts.month) &&
        parts.hour >= 0 &&
        parts.hour <= 23 &&
        parts.minute >= 0 &&
        parts.minute <= 59
    )
}

function daysInMonth(year: number, month: number) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    if (month === 2) return leapYear ? 29 : 28
    return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function toUtcTimestamp(parts: ZonedDateTimeParts) {
    const date = new Date(0)
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
    date.setUTCHours(parts.hour, parts.minute, 0, 0)
    const timestamp = date.getTime()
    if (!Number.isFinite(timestamp)) throw new Error('Date is outside the supported range')
    return timestamp
}

function sameDateTime(left: ZonedDateTimeParts, right: ZonedDateTimeParts) {
    return (
        left.year === right.year &&
        left.month === right.month &&
        left.day === right.day &&
        left.hour === right.hour &&
        left.minute === right.minute
    )
}

function parsePart(parts: Map<string, string>, name: string) {
    const value = parts.get(name)
    if (value === undefined) throw new Error(`Missing date-time part: ${name}`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid date-time part: ${name}`)
    return parsed
}

export function formatCivilSchedule(value: string, locale: string): string {
    const parts = parseCivilDateTime(value)
    if (parts === null) return ''
    const date = toUtcTimestamp(parts)
    return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(date)
}
