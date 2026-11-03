export const catalogs: Record<string, Record<string, Function>> = {}

export function getLocaleTranslation(locale: string, key: string): Function | undefined {
    return catalogs[locale]?.[key]
}

export async function loadLocale(locale: string): Promise<Record<string, Function> | undefined> {
    if (locale === 'en') return undefined
    if (catalogs[locale]) return catalogs[locale]

    switch (locale) {
        case 'fr': {
            const mod = (await import('@/locales/fr.js')).default as unknown as Record<
                string,
                Function
            >
            catalogs.fr = mod
            return mod
        }
        case 'es': {
            const mod = (await import('@/locales/es.js')).default as unknown as Record<
                string,
                Function
            >
            catalogs.es = mod
            return mod
        }
        case 'de': {
            const mod = (await import('@/locales/de.js')).default as unknown as Record<
                string,
                Function
            >
            catalogs.de = mod
            return mod
        }
        default:
            return undefined
    }
}

export function isLocaleLoaded(locale: string): boolean {
    return locale === 'en' || !!catalogs[locale]
}
