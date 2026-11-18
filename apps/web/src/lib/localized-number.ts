/** Reads a number typed with the locale's grouping and decimal marks. */
export function parseLocalizedNumber(text: string, locale: string): number {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
    const group = parts.find(part => part.type === 'group')?.value ?? ','
    const decimal = parts.find(part => part.type === 'decimal')?.value ?? '.'
    const normalized = text
        .trim()
        .replace(/[\s\u00a0\u202f]/g, '')
        .split(group)
        .join('')
        .replace(decimal, '.')
    if (!/^\d*(\.\d*)?$/.test(normalized) || normalized === '' || normalized === '.')
        return Number.NaN
    return Number(normalized)
}
