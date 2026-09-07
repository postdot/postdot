const numberFormatters = new Map<string, Intl.NumberFormat>()
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const dateOnlyFormatters = new Map<string, Intl.DateTimeFormat>()
const timeFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions) {
    if (options !== undefined) return new Intl.NumberFormat(locale, options).format(value)

    const cached = numberFormatters.get(locale)
    if (cached !== undefined) return cached.format(value)
    const formatter = new Intl.NumberFormat(locale)
    numberFormatters.set(locale, formatter)
    return formatter.format(value)
}

export function formatBytes(bytes: number, locale: string) {
    if (bytes < 1_024) {
        return new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: 'byte',
            unitDisplay: 'short',
        }).format(bytes)
    }
    if (bytes < 1_024 * 1_024) {
        return new Intl.NumberFormat(locale, {
            maximumFractionDigits: 0,
            style: 'unit',
            unit: 'kilobyte',
            unitDisplay: 'short',
        }).format(bytes / 1_024)
    }
    return new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
        style: 'unit',
        unit: 'megabyte',
        unitDisplay: 'short',
    }).format(bytes / (1_024 * 1_024))
}

export function formatDateTime(timestamp: number, timeZone: string, locale: string) {
    const key = `${locale}:${timeZone}`
    const cached = dateFormatters.get(key)
    if (cached !== undefined) return cached.format(new Date(timestamp))

    const formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
    })
    dateFormatters.set(key, formatter)
    return formatter.format(new Date(timestamp))
}

export function formatDate(timestamp: number, timeZone: string, locale: string) {
    const key = `${locale}:${timeZone}`
    const cached = dateOnlyFormatters.get(key)
    if (cached !== undefined) return cached.format(new Date(timestamp))

    const formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone,
    })
    dateOnlyFormatters.set(key, formatter)
    return formatter.format(new Date(timestamp))
}

export function formatTime(timestamp: number, timeZone: string, locale: string) {
    const key = `${locale}:${timeZone}`
    const cached = timeFormatters.get(key)
    if (cached !== undefined) return cached.format(new Date(timestamp))

    const formatter = new Intl.DateTimeFormat(locale, {
        timeStyle: 'short',
        timeZone,
    })
    timeFormatters.set(key, formatter)
    return formatter.format(new Date(timestamp))
}

export function formatDayLabel(date: Date, locale: string) {
    return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        weekday: 'long',
    }).format(date)
}
