import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { GlobeIcon } from '@solar-icons/react/bold/globe'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'
import { type Locale, locales } from '@/paraglide/runtime.js'

const languageLabels: Record<Locale, () => string> = {
    en: m.language_english,
    fr: m.language_french,
}

export function LanguageSwitcher() {
    const { locale, setLocale } = useLanguage()
    const nextLocale = locale === 'en' ? 'fr' : 'en'
    const label = m.language_switch_to({ language: languageLabels[nextLocale]() })

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        aria-label={label}
                        className="gap-1.5 px-2"
                        size="sm"
                        title={label}
                        variant="ghost"
                    />
                }>
                <GlobeIcon aria-hidden="true" />
                <span className="hidden text-xs font-semibold uppercase sm:inline">{locale}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
                <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
                    {m.language_menu_label()}
                </div>
                {locales.map(language => (
                    <DropdownMenuItem
                        key={language}
                        aria-current={locale === language ? 'true' : undefined}
                        onClick={() => {
                            if (locale !== language && isLocale(language)) {
                                void setLocale(language)
                            }
                        }}>
                        {languageLabels[language]()}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function isLocale(value: string | null): value is Locale {
    return value !== null && locales.includes(value as Locale)
}
