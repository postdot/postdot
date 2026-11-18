/**
 * Language tags offered when a post or a channel version declares its language. Providers
 * expect BCP 47 tags; people pick a language by name, so the tag stays out of sight.
 */
const COMMON_LANGUAGE_TAGS = [
    'en',
    'en-US',
    'en-GB',
    'fr',
    'fr-CA',
    'es',
    'es-419',
    'de',
    'it',
    'pt',
    'pt-BR',
    'nl',
    'sv',
    'da',
    'nb',
    'fi',
    'is',
    'pl',
    'cs',
    'sk',
    'sl',
    'hr',
    'sr',
    'bs',
    'hu',
    'ro',
    'bg',
    'el',
    'uk',
    'ru',
    'be',
    'lt',
    'lv',
    'et',
    'ga',
    'cy',
    'eu',
    'ca',
    'gl',
    'tr',
    'ar',
    'he',
    'fa',
    'ur',
    'hi',
    'bn',
    'pa',
    'ta',
    'te',
    'mr',
    'gu',
    'kn',
    'ml',
    'th',
    'vi',
    'id',
    'ms',
    'fil',
    'zh-Hans',
    'zh-Hant',
    'ja',
    'ko',
    'sw',
    'am',
    'yo',
    'ha',
    'zu',
    'af',
    'eo',
    'la',
] as const

export interface LanguageOption {
    /** The BCP 47 tag stored on the content. */
    readonly tag: string
    /** The language name in the interface language, for example "British English" in an English interface. */
    readonly label: string
    /** The language name in that language, for example "English (United Kingdom)". */
    readonly nativeLabel: string
}

function displayName(tag: string, inLocale: string): string | null {
    try {
        return new Intl.DisplayNames([inLocale], { type: 'language' }).of(tag) ?? null
    } catch {
        return null
    }
}

function capitalize(value: string, locale: string) {
    return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1)
}

/** A readable name for a stored tag; the raw tag when the browser cannot name it. */
export function languageLabel(tag: string, uiLocale: string): string {
    const name = displayName(tag, uiLocale)
    return name === null || name === tag ? tag : capitalize(name, uiLocale)
}

/**
 * The offered languages, sorted by name in the interface language. A stored tag that is
 * not in the common list (set through the API, for example) is kept as an option so it is
 * never silently lost.
 */
export function listLanguageOptions(uiLocale: string, current?: string): LanguageOption[] {
    const tags = new Set<string>(COMMON_LANGUAGE_TAGS)
    if (current && current.trim() !== '') tags.add(current)
    const collator = new Intl.Collator(uiLocale, { sensitivity: 'base' })
    return [...tags]
        .map(tag => ({
            tag,
            label: languageLabel(tag, uiLocale),
            nativeLabel: languageLabel(tag, tag),
        }))
        .sort((left, right) => collator.compare(left.label, right.label))
}

/** Search on the localized name, the native name and the tag itself. */
export function languageOptionMatches(option: LanguageOption, query: string): boolean {
    const needle = query
        .trim()
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
    if (needle === '') return true
    return [option.label, option.nativeLabel, option.tag].some(value =>
        value
            .toLocaleLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .includes(needle)
    )
}
