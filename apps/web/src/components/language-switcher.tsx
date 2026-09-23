import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@herald/ui/components/tooltip'
import flagFr from '@iconify-icons/flag/fr-4x3'
import flagGb from '@iconify-icons/flag/gb-4x3'
import { Icon } from '@iconify/react'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'
import { type Locale, locales } from '@/paraglide/runtime.js'

const languageLabels: Record<Locale, () => string> = {
    en: m.language_english,
    fr: m.language_french,
}

const languageFlags = {
    en: flagGb,
    fr: flagFr,
} as const

export function LanguageSwitcher() {
    const { locale, setLocale } = useLanguage()
    const nextLocale = locale === 'en' ? 'fr' : 'en'
    const label = m.language_switch_to({ language: languageLabels[nextLocale]() })

    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    aria-label={label}
                                    className="px-2"
                                    data-slot="language-switcher-trigger"
                                    size="icon-sm"
                                    title={label}
                                    variant="ghost"
                                />
                            }
                        />
                    }>
                    <Icon
                        aria-hidden="true"
                        className="h-3.5 w-5 overflow-hidden rounded-[2px]"
                        icon={languageFlags[locale]}
                    />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-40">
                {locales.map(language => (
                    <DropdownMenuItem
                        key={language}
                        aria-current={locale === language ? 'true' : undefined}
                        className="gap-2"
                        onClick={() => {
                            if (locale !== language && isLocale(language)) {
                                void setLocale(language)
                            }
                        }}>
                        <Icon
                            aria-hidden="true"
                            className="h-3.5 w-5 overflow-hidden rounded-[2px]"
                            icon={languageFlags[language]}
                        />
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
