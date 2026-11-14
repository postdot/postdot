import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'
import { type Locale, locales } from '@/paraglide/runtime.js'

/** Languages are named in their own language, never by a flag and never translated (ADR-103). */
const nativeLanguageNames: Record<Locale, string> = {
    en: 'English',
    fr: 'Français',
    es: 'Español',
    de: 'Deutsch',
}

export const languageLabels: Record<Locale, () => string> = {
    en: () => nativeLanguageNames.en,
    fr: () => nativeLanguageNames.fr,
    es: () => nativeLanguageNames.es,
    de: () => nativeLanguageNames.de,
}

export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && locales.includes(value as Locale)
}

export function LanguageSelect({ id }: { readonly id?: string }) {
    const { locale, setLocale } = useLanguage()

    return (
        <Select
            value={locale}
            onValueChange={value => {
                if (isLocale(value) && value !== locale) void setLocale(value)
            }}>
            <SelectTrigger
                aria-label={m.language_menu_label()}
                className="w-44"
                data-slot="language-select"
                id={id}>
                <SelectValue>{languageLabels[locale]()}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
                {locales.map(language => (
                    <SelectItem key={language} value={language}>
                        {languageLabels[language]()}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
