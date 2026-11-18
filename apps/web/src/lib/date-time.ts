import { defaultProjectTimeZone, isValidProjectTimeZone } from '@postdot/core'

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
    // ADR-103 §7: the current year goes without saying.
    const sameYear =
        getZonedDateTimeParts(timestamp, timeZone).year ===
        getZonedDateTimeParts(Date.now(), timeZone).year
    return getDisplayFormatter(timeZone, locale, sameYear).format(date)
}

export function formatProjectDate(timestamp: number, timeZone: string, locale = 'en'): string {
    const sameYear =
        getZonedDateTimeParts(timestamp, timeZone).year ===
        getZonedDateTimeParts(Date.now(), timeZone).year
    return getDisplayFormatter(timeZone, locale, sameYear, true).format(new Date(timestamp))
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

export function detectDefaultProjectTimeZone(): string {
    const detected = getBrowserTimeZone()
    return isValidProjectTimeZone(detected) ? detected : defaultProjectTimeZone
}

export function listSupportedProjectTimeZones(currentTimeZone?: string): readonly string[] {
    const zones = new Set<string>([defaultProjectTimeZone])
    try {
        for (const zone of Intl.supportedValuesOf('timeZone')) {
            if (isValidProjectTimeZone(zone)) zones.add(zone)
        }
    } catch {
        // Fall back to UTC plus the active project timezone when Intl.supportedValuesOf is unavailable.
    }
    if (currentTimeZone !== undefined && isValidProjectTimeZone(currentTimeZone)) {
        zones.add(currentTimeZone)
    }
    return [...zones].sort((left, right) => {
        if (left === defaultProjectTimeZone) return -1
        if (right === defaultProjectTimeZone) return 1
        return left.localeCompare(right)
    })
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

function getDisplayFormatter(timeZone: string, locale: string, omitYear = false, dateOnly = false) {
    const key = `${locale}:${timeZone}:${omitYear ? 'short' : 'full'}:${dateOnly}`
    const cached = displayFormatters.get(key)
    if (cached !== undefined) return cached

    const formatter = new Intl.DateTimeFormat(
        locale,
        dateOnly
            ? { day: 'numeric', month: 'short', year: omitYear ? undefined : 'numeric', timeZone }
            : omitYear
              ? {
                    day: 'numeric',
                    hour: hourStyle(locale),
                    minute: '2-digit',
                    month: 'short',
                    timeZone,
                }
              : { dateStyle: 'medium', timeStyle: 'short', timeZone }
    )
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
    // One time format per locale (ADR-103 §7): no leading-zero hour, and the
    // current year is implied.
    return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        ...(parts.year === new Date().getUTCFullYear() ? {} : { year: 'numeric' as const }),
        hour: hourStyle(locale),
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(date)
}

// Calendar days preserve civil time; the existing parser rejects DST gaps and overlaps.
export function moveProjectSchedule(
    timestamp: number,
    amount: number,
    unit: string,
    timeZone: string
): DateTimeLocalResult {
    if (unit === '1') return timestamp + amount * 3_600_000
    const parts = getZonedDateTimeParts(timestamp, timeZone)
    const civil = new Date(toUtcTimestamp(parts))
    civil.setUTCDate(civil.getUTCDate() + amount * (unit === '168' ? 7 : 1))
    const result = parseDateTimeLocal(toDateTimeLocal(civil.getTime(), 'UTC'), timeZone)
    return typeof result === 'number' ? result + (((timestamp % 60_000) + 60_000) % 60_000) : result
}

/** "1:41 PM" on a 12-hour dial, "13:41" / "02:30" on a 24-hour one (the locale's own short time). */
function hourStyle(locale: string): 'numeric' | '2-digit' {
    return usesTwelveHourClock(locale) ? 'numeric' : '2-digit'
}

/** True when people in this locale read clock times on a 12-hour dial. */
export function usesTwelveHourClock(locale: string): boolean {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
    return cycle === 'h11' || cycle === 'h12'
}

/** Shows a canonical `HH:mm` time the way the locale writes it ("1:41 PM" or "13:41"). */
export function formatClockTime(time: string, locale: string): string {
    const match = /^(\d{2}):(\d{2})$/.exec(time)
    if (match === null || !usesTwelveHourClock(locale)) return time
    return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])))
}

/**
 * Reads a typed time as `HH:mm`. Accepts 24-hour input everywhere ("13:41",
 * "1341") and 12-hour input with a day period ("1:41 pm", "1 PM", "12am").
 */
export function parseClockTime(text: string): string | null {
    const value = text.trim().toLowerCase().replace(/\s+/g, ' ')
    const twelve = /^(\d{1,2})(?::?(\d{2}))? ?([ap])\.? ?m?\.?$/.exec(value)
    if (twelve !== null) {
        const hour = Number(twelve[1])
        const minute = Number(twelve[2] ?? '0')
        if (hour < 1 || hour > 12 || minute > 59) return null
        const hour24 = (hour % 12) + (twelve[3] === 'p' ? 12 : 0)
        return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
    const twentyFour = /^(\d{1,2}):?(\d{2})$/.exec(value)
    if (twentyFour === null) return null
    const hour = Number(twentyFour[1])
    const minute = Number(twentyFour[2])
    if (hour > 23 || minute > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
