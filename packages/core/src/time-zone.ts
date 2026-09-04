import { DomainInvariantError } from './invariants'

export const defaultProjectTimeZone = 'UTC'

export type ProjectTimeZone = string

const ianaTimeZonePattern = /^(?:UTC|[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+)$/

export function isValidProjectTimeZone(value: string): value is ProjectTimeZone {
    if (value.trim() !== value || !ianaTimeZonePattern.test(value)) return false

    try {
        return Intl.supportedValuesOf('timeZone').includes(value)
    } catch {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
            return true
        } catch {
            return false
        }
    }
}

export function requireProjectTimeZone(
    value: string | undefined,
    field = 'timeZone'
): ProjectTimeZone {
    const normalized = value === undefined ? defaultProjectTimeZone : value.trim()
    if (!isValidProjectTimeZone(normalized)) {
        throw new DomainInvariantError(
            'invalid_input',
            `${field} must be a valid IANA time zone identifier`
        )
    }

    return normalized
}
