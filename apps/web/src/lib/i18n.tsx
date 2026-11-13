import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createContext, useContext } from 'react'

import { isLocaleLoaded, loadLocale } from '@/lib/i18n-store.js'
import { getLocale, getTextDirection, setLocale, type Locale } from '@/paraglide/runtime.js'

interface LanguageContextValue {
    readonly locale: Locale
    readonly setLocale: (locale: Locale) => Promise<void>
    readonly catalogVersion: number
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { readonly children: ReactNode }) {
    const [locale, setCurrentLocale] = useState<Locale>(() => getLocale())
    const [catalogVersion, setLoadedVersion] = useState(0)

    useEffect(() => {
        document.documentElement.lang = locale
        document.documentElement.dir = getTextDirection(locale)
        if (locale !== 'en' && !isLocaleLoaded(locale)) {
            void loadLocale(locale).then(() => {
                setLoadedVersion(v => v + 1)
            })
        }
    }, [locale])

    const changeLocale = useCallback(async (nextLocale: Locale) => {
        if (nextLocale !== 'en' && !isLocaleLoaded(nextLocale)) {
            await loadLocale(nextLocale)
        }
        await setLocale(nextLocale, { reload: false })
        setCurrentLocale(nextLocale)
    }, [])

    const value = useMemo<LanguageContextValue>(
        () => ({ locale, setLocale: changeLocale, catalogVersion }),
        [catalogVersion, changeLocale, locale]
    )

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
    const context = useContext(LanguageContext)
    if (context === null) {
        throw new Error('useLanguage must be used inside LanguageProvider')
    }
    return context
}
