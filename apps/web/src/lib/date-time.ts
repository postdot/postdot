export function parseDateTimeLocal(value: string): number | null | 'invalid' {
    if (value === '') return null
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : 'invalid'
}

export function toDateTimeLocal(timestamp: number | null): string {
    if (timestamp === null) return ''
    const date = new Date(timestamp)
    const offset = date.getTimezoneOffset() * 60_000
    return new Date(timestamp - offset).toISOString().slice(0, 16)
}
